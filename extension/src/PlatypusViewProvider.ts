import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as Diff from 'diff';
import { calculateChecksum } from './utils/workspaceUtils';
import { callBackend, cancelBackendJob, indexCodebase, getKnowledgeStatus } from './utils/backendApi';
import type { FileData, IndexingProgress } from './utils/backendApi';
import { AnalysisResult, FileSystemOperation, ChatMessage } from './types';
import { applyChanges } from './utils/diffApplier';


export class PlatypusViewProvider {

	private _view?: any;
    private _disposables: vscode.Disposable[] = [];
    private _activeJobId: string | null = null;
    private _jobChecksums = new Map<string, string>();
    private _workspaceId: string | null = null;
    private _isAutoIndexing: boolean = false;
    private _conversationHistory: ChatMessage[] = [];
    private readonly workspaceRoot: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    private readonly MAX_FILE_SIZE = 200 * 1024; // Increased to 200KB
    private _context: vscode.ExtensionContext;
    private _sessions: Map<string, { id: string; title: string; timestamp: number; messages: ChatMessage[] }> = new Map();
    private _currentSessionId: string = `session-${Date.now()}`;
    private _hasUnsavedChanges: boolean = false;

    // State management
    private static readonly CONVERSATION_HISTORY_KEY = 'platypus.conversationHistory';
    private static readonly SESSIONS_KEY = 'platypus.chatSessions';
    private static readonly CURRENT_SESSION_KEY = 'platypus.currentSession';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext
    ) { 
        this._context = context;
        // Load conversation history and sessions from global state
        this.loadConversationHistory();
        this.loadSessions();
    }

    /**
     * Load conversation history from VS Code global state
     */
    private loadConversationHistory() {
        try {
            const savedHistory = this._context.globalState.get<ChatMessage[]>(
                PlatypusViewProvider.CONVERSATION_HISTORY_KEY,
                []
            );
            this._conversationHistory = savedHistory || [];
            console.log(`[Platypus] Loaded ${this._conversationHistory.length} messages from history`);
        } catch (e) {
            console.error('Failed to load conversation history:', e);
            this._conversationHistory = [];
        }
    }

    /**
     * Load all chat sessions from VS Code global state
     */
    private loadSessions() {
        try {
            const savedSessions = this._context.globalState.get<any[]>(
                PlatypusViewProvider.SESSIONS_KEY,
                []
            );
            this._sessions = new Map(savedSessions.map((s: any) => [s.id, s]));
            
            const currentSessionId = this._context.globalState.get<string>(
                PlatypusViewProvider.CURRENT_SESSION_KEY
            );
            if (currentSessionId) {
                this._currentSessionId = currentSessionId;
            }
            
            console.log(`[Platypus] Loaded ${this._sessions.size} sessions`);
        } catch (e) {
            console.error('Failed to load sessions:', e);
            this._sessions = new Map();
        }
    }

    /**
     * Save conversation history to VS Code global state
     */
    private async saveConversationHistory() {
        try {
            await this._context.globalState.update(
                PlatypusViewProvider.CONVERSATION_HISTORY_KEY,
                this._conversationHistory
            );
            this._hasUnsavedChanges = false;
            console.log(`[Platypus] Saved ${this._conversationHistory.length} messages to history`);
        } catch (e) {
            console.error('Failed to save conversation history:', e);
        }
    }

    /**
     * Save all sessions to VS Code global state
     */
    private async saveSessions() {
        try {
            const sessionsArray = Array.from(this._sessions.values());
            await this._context.globalState.update(
                PlatypusViewProvider.SESSIONS_KEY,
                sessionsArray
            );
            await this._context.globalState.update(
                PlatypusViewProvider.CURRENT_SESSION_KEY,
                this._currentSessionId
            );
            console.log(`[Platypus] Saved ${this._sessions.size} sessions`);
        } catch (e) {
            console.error('Failed to save sessions:', e);
        }
    }

	public resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(path.join(this._extensionUri.fsPath, 'web-ui', 'dist'))]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Register message handler - connects webview to handleMessage method
        const msgDisposable = webviewView.webview.onDidReceiveMessage(async (message: any) => {
            await this.handleMessage(message);
        });

        this._disposables.push(msgDisposable);

		webviewView.onDidDispose(() => this.dispose(), null, this._disposables);
	}

    private postMessage(command: string, payload: any) {
        if (this._view) {
            this._view.webview.postMessage({ command, payload });
        }
    }

    private postChatMessage(message: ChatMessage) {
        // Add to conversation history
        this._conversationHistory = [...this._conversationHistory, message];
        this._hasUnsavedChanges = true;
        
        // Auto-save every message
        this.saveConversationHistory();
        
        // Update current session
        const currentSession = this._sessions.get(this._currentSessionId);
        if (currentSession) {
            currentSession.messages = this._conversationHistory;
            currentSession.timestamp = Date.now();
            this._sessions.set(this._currentSessionId, currentSession);
            this.saveSessions();
        } else {
            // Create new session
            const title = this._conversationHistory.find(m => m.role === 'user')?.content.slice(0, 50) || 'New Chat';
            this._sessions.set(this._currentSessionId, {
                id: this._currentSessionId,
                title,
                timestamp: Date.now(),
                messages: this._conversationHistory
            });
            this.saveSessions();
        }
        
        // Send to webview
        this.postMessage('chat-update', message);
    }

    private handleAttachFiles = async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("No workspace open");
          return;
        }

        const status = vscode.window.setStatusBarMessage("Platypus: Indexing files...");
        
        try {
            // 1. Get all files in workspace (respecting gitignore)
            const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.next,.vscode,coverage}/**');
            
            // 2. Map to QuickPick items
            const items: vscode.QuickPickItem[] = uris.map(uri => {
                const relativePath = vscode.workspace.asRelativePath(uri);
                return {
                    label: `$(file) ${path.basename(uri.fsPath)}`,
                    description: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
                    detail: relativePath // Store the full relative path to identify the file later
                };
            });

            // 3. Show QuickPick (Cmd+P style)
            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: 'Search files to add to context...',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                // 4. Send back to WebUI
                const paths = selected.map(item => item.detail || '');
                this._view?.webview.postMessage({ command: 'update-selected-files', payload: paths });
            }
        } catch (e) {
            console.error("Error attaching files:", e);
            vscode.window.showErrorMessage("Failed to load file picker.");
        } finally {
            status.dispose();
        }
    };

    private handlePickFolder = async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace open");
            return;
        }

        const status = vscode.window.setStatusBarMessage("Platypus: Indexing folders...");
        try {
            const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.next,.vscode,coverage}/**');
            
            // Extract unique directories
            const dirs = new Set<string>();
            uris.forEach(uri => {
                const relativePath = vscode.workspace.asRelativePath(uri);
                const dirname = path.dirname(relativePath);
                if (dirname !== '.') {
                    dirs.add(dirname);
                }
            });

            const items: vscode.QuickPickItem[] = Array.from(dirs).sort().map(dir => ({
                label: `$(folder) ${dir}`,
                detail: dir
            }));

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: 'Select folders to add all their files...',
                matchOnDetail: true
            });

            if (selected) {
                const selectedDirs = selected.map(s => s.detail!);
                // Find all files that start with these directories
                const filesToAdd = uris
                    .map(uri => vscode.workspace.asRelativePath(uri))
                    .filter(path => selectedDirs.some(dir => path.startsWith(dir + '/')));
                
                this.postMessage('update-selected-files', filesToAdd);
            }

        } catch (e) {
            console.error("Error picking folder:", e);
            vscode.window.showErrorMessage("Failed to load folder picker.");
        } finally {
            status.dispose();
        }
    };

    private async handleMessage(message: any) {
        if (!this._view) return;

        switch (message.command) {
            case 'webview-ready':
                // Send conversation history first
                this._conversationHistory.forEach(message => {
                    this.postMessage('chat-update', message);
                });
                
                // Send all sessions to webview
                const sessionsArray = Array.from(this._sessions.values());
                this.postMessage('load-sessions', { 
                    sessions: sessionsArray,
                    currentSessionId: this._currentSessionId 
                });
                
                // Then send welcome message if conversation is empty
                if (this._conversationHistory.length === 0) {
                    this.postChatMessage({
                        id: crypto.randomUUID(),
                        role: 'ai',
                        content: 'Welcome to Platypus AI. Describe the changes you want to make to your project.',
                    });
                }
                this.postMessage('update-status', { text: `Ready` });
                break;
            case 'attach-files': {
                this.handleAttachFiles();
                break;
            }
            case 'pick-folder': {
                this.handlePickFolder();
                break;
            }
            case 'submit-prompt':
                await this.handleAnalysisRequest(message.payload);
                break;
            case 'preview-changes': {
                if (!this.workspaceRoot) return;
                const changes = message.payload;
              
                for (const change of changes as FileSystemOperation[]) {
                  const uri = vscode.Uri.file(path.join(this.workspaceRoot, change.filePath));
              
                  if (change.type === 'create') {
                    const newUri = vscode.Uri.parse(`untitled:${change.filePath}`);
                    const doc = await vscode.workspace.openTextDocument(newUri);
                    const editor = await vscode.window.showTextDocument(doc, { preview: true });
                    await editor.edit(edit => {
                        edit.insert(new vscode.Position(0, 0), change.content || '');
                    });
                    
                    vscode.commands.executeCommand('vscode.diff', uri, newUri, `${change.filePath} (New File)`);
                  }
                  else if (change.type === 'modify' && change.diff) {
                    let currentContent = '';
                    try {
                        const buffer = await (vscode.workspace as any).fs.readFile(uri);
                        currentContent = new TextDecoder().decode(buffer);
                    } catch (e) { }

                    // Use robust Diff library instead of manual regex
                    const newContent = Diff.applyPatch(currentContent, change.diff);
                    
                    if (typeof newContent === 'string') {
                        const leftUri = uri; // Original file on disk
                        const rightUri = uri.with({ scheme: 'untitled', query: 'preview' }); // New content
                        
                        const doc = await vscode.workspace.openTextDocument(rightUri);
                        const edit = new vscode.WorkspaceEdit();
                        edit.insert(rightUri, new vscode.Position(0, 0), newContent);
                        await vscode.workspace.applyEdit(edit);
            
                        vscode.commands.executeCommand('vscode.diff', 
                            leftUri, 
                            rightUri, 
                            `${change.filePath} (Preview)`
                        );
                    } else {
                        vscode.window.showErrorMessage(`Could not preview changes for ${change.filePath}. The diff may be invalid.`);
                    }
                  }
                }
                break;
            }
            case 'apply-changes': {
                if (!this.workspaceRoot) {
                    vscode.window.showErrorMessage("Cannot apply changes without an open workspace.");
                    return;
                }
                const { changes } = message.payload;
                
                try {
                    await applyChanges(changes as FileSystemOperation[], this._jobChecksums);
                    this.postMessage('update-status', { text: 'Changes applied. Ready.' });
                    this._activeJobId = null;
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to apply changes: ${e.message}`);
                    this.postMessage('update-status', { text: 'Error applying changes.' });
                }
                break;
            }
            case 'cancel-analysis':
                await this.handleCancelRequest();
                break;
            case 'index-codebase':
                await this.handleIndexCodebase();
                break;
            case 'get-knowledge-status':
                await this.handleGetKnowledgeStatus();
                break;
            case 'close-view':
                // Check for unsaved changes
                if (this._hasUnsavedChanges || this._conversationHistory.length > 0) {
                    const choice = await vscode.window.showWarningMessage(
                        'You have unsaved conversation. Do you want to save it before closing?',
                        { modal: true },
                        'Save & Close',
                        'Close Without Saving',
                        'Stay'
                    );
                    
                    if (choice === 'Save & Close') {
                        await this.saveConversationHistory();
                        await this.saveSessions();
                        console.log('[Platypus] Conversation saved before closing');
                    } else if (choice === 'Stay') {
                        // Don't close, just return
                        return;
                    }
                    // If "Close Without Saving", continue without saving
                }
                break;
            case 'new-chat':
                // Check for unsaved changes
                if (this._hasUnsavedChanges && this._conversationHistory.length > 0) {
                    const choice = await vscode.window.showWarningMessage(
                        'You have unsaved conversation. Save before starting a new chat?',
                        { modal: true },
                        'Save & New Chat',
                        'New Chat Without Saving',
                        'Cancel'
                    );
                    
                    if (choice === 'Cancel') {
                        return;
                    }
                    
                    if (choice === 'Save & New Chat') {
                        await this.saveConversationHistory();
                        await this.saveSessions();
                    }
                }
                
                // Create new session
                this._currentSessionId = `session-${Date.now()}`;
                this._conversationHistory = [];
                this._hasUnsavedChanges = false;
                
                // Send clear message to webview
                this.postMessage('clear-conversation', {});
                
                // Send welcome message
                this.postChatMessage({
                    id: crypto.randomUUID(),
                    role: 'ai',
                    content: 'New chat started. How can I help you?',
                });
                break;
        }
    }

    private async handleIndexCodebase() {
        if (!this._view) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace open');
            return;
        }

        this.postMessage('indexing-status', { phase: 'starting', message: 'Starting codebase indexing...' });

        try {
            const allFiles = await vscode.workspace.findFiles(
                '**/*',
                '**/{node_modules,.git,dist,build,out,venv,.next,.vscode,coverage,*.lock}/**'
            );

            if (allFiles.length === 0) {
                this.postMessage('indexing-status', { phase: 'error', message: 'No files found in workspace' });
                return;
            }

            this.postMessage('indexing-status', { 
                phase: 'reading', 
                message: `Reading ${allFiles.length} files...`,
                current: 0,
                total: allFiles.length 
            });

            const filesForIndexing: { filePath: string; content: string }[] = [];
            let processed = 0;

            for (const fileUri of allFiles) {
                try {
                    const relativePath = vscode.workspace.asRelativePath(fileUri);
                    
                    // Skip binary and large files
                    if (this.shouldSkipFile(relativePath)) continue;

                    const stat = await (vscode.workspace as any).fs.stat(fileUri);
                    if (stat.size > this.MAX_FILE_SIZE) continue;

                    const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
                    const content = new TextDecoder().decode(contentBytes);
                    
                    filesForIndexing.push({ filePath: relativePath, content });
                    processed++;

                    if (processed % 50 === 0) {
                        this.postMessage('indexing-status', {
                            phase: 'reading',
                            message: `Read ${processed} files...`,
                            current: processed,
                            total: allFiles.length
                        });
                    }
                } catch (e) {
                    // Skip unreadable files
                }
            }

            if (filesForIndexing.length === 0) {
                this.postMessage('indexing-status', { phase: 'error', message: 'No valid files to index' });
                return;
            }

            // Generate workspace ID from folder name
            const workspaceName = workspaceFolder.name || 'default';
            const workspaceId = crypto.createHash('md5').update(workspaceName).digest('hex').slice(0, 16);

            this.postMessage('indexing-status', {
                phase: 'embedding',
                message: `Indexing ${filesForIndexing.length} files into vector database...`,
                current: 0,
                total: filesForIndexing.length
            });

            const result = await indexCodebase(
                filesForIndexing,
                workspaceId,
                (progress: IndexingProgress) => {
                    this.postMessage('indexing-status', {
                        phase: progress.phase,
                        message: progress.message,
                        current: progress.current,
                        total: progress.total
                    });
                }
            );

            this._workspaceId = result.workspaceId;

            this.postMessage('indexing-status', {
                phase: 'complete',
                message: `Indexed ${result.chunksIndexed} chunks from ${result.filesProcessed} files`,
                workspaceId: result.workspaceId
            });

            vscode.window.showInformationMessage(
                `Platypus Knowledge Base: Indexed ${result.filesProcessed} files (${result.chunksIndexed} chunks)`
            );

        } catch (e: any) {
            console.error('Indexing error:', e);
            this.postMessage('indexing-status', {
                phase: 'error',
                message: e.message || 'Failed to index codebase'
            });
            vscode.window.showErrorMessage(`Indexing failed: ${e.message}`);
        }
    }

    private async handleGetKnowledgeStatus() {
        if (!this._workspaceId) {
            this.postMessage('knowledge-status', { indexed: false, chunksCount: 0 });
            return;
        }

        try {
            const status = await getKnowledgeStatus(this._workspaceId);
            this.postMessage('knowledge-status', status);
        } catch (e) {
            this.postMessage('knowledge-status', { indexed: false, chunksCount: 0 });
        }
    }

    private shouldSkipFile(filePath: string): boolean {
        const skipPatterns = [
            'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
            '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
            '.woff', '.woff2', '.ttf', '.eot',
            '.zip', '.tar', '.gz', '.rar',
            '.exe', '.dll', '.so', '.dylib',
            '.min.js', '.min.css', '.map'
        ];
        return skipPatterns.some(pattern => filePath.includes(pattern));
    }

    /**
     * Check if a prompt is a simple greeting that doesn't require code processing
     */
    private isSimpleGreeting(prompt: string): boolean {
        const trimmedPrompt = prompt.trim().toLowerCase();
        const wordCount = trimmedPrompt.split(/\s+/).length;
        
        // Very short conversational messages
        const conversationalPatterns = [
            /^(hi+|hello+|hey+|hii+|sup|yo)[\s!.?]*$/i,
            /^(thanks+|thank you+|good (morning|evening|night|afternoon))[\s!.?]*$/i,
            /^(ok|okay|sure|yes|no|yep|nope|cool|great|awesome|nice)[\s!.?]*$/i,
            /^(what'?s? up|how are you|who are you|what can you do)[\s!.?]*$/i
        ];
        
        return wordCount <= 5 && conversationalPatterns.some(p => p.test(trimmedPrompt));
    }

    /**
     * Auto-index the workspace in background when first analysis is made
     */
    private async triggerAutoIndex() {
        if (this._isAutoIndexing) return;
        this._isAutoIndexing = true;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            this._isAutoIndexing = false;
            return;
        }

        try {
            // Show subtle status bar message
            const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            statusBarItem.text = '$(sync~spin) Platypus: Indexing codebase...';
            statusBarItem.show();

            const allFiles = await vscode.workspace.findFiles(
                '**/*',
                '**/{node_modules,.git,dist,build,out,venv,.next,.vscode,coverage,*.lock}/**'
            );

            const filesForIndexing: { filePath: string; content: string }[] = [];
            const MAX_AUTO_INDEX_FILES = 150; // Increased limit for auto-indexing

            for (const fileUri of allFiles) {
                if (filesForIndexing.length >= MAX_AUTO_INDEX_FILES) break;

                try {
                    const relativePath = vscode.workspace.asRelativePath(fileUri);
                    if (this.shouldSkipFile(relativePath)) continue;

                    const stat = await (vscode.workspace as any).fs.stat(fileUri);
                    if (stat.size > this.MAX_FILE_SIZE) continue;

                    const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
                    const content = new TextDecoder().decode(contentBytes);
                    filesForIndexing.push({ filePath: relativePath, content });
                } catch (e) {
                    // Skip unreadable files
                }
            }

            if (filesForIndexing.length > 0) {
                const workspaceName = workspaceFolder.name || 'default';
                const workspaceId = crypto.createHash('md5').update(workspaceName).digest('hex').slice(0, 16);

                await indexCodebase(filesForIndexing, workspaceId);
                this._workspaceId = workspaceId;

                statusBarItem.text = '$(check) Platypus: Indexed';
                setTimeout(() => statusBarItem.dispose(), 3000);
            } else {
                statusBarItem.dispose();
            }
        } catch (e) {
            console.error('Auto-indexing failed:', e);
        } finally {
            this._isAutoIndexing = false;
        }
    }

    private getWorkspaceDiagnostics(): string[] {
        const diagnostics: string[] = [];
        const allDiagnostics = vscode.languages.getDiagnostics();
        
        for (const [uri, diags] of allDiagnostics) {
             if (diags.length === 0) continue;
             
             // Only include errors and warnings (exclude info/hints to reduce noise)
             const errorsAndWarnings = diags.filter(d => 
                 d.severity === vscode.DiagnosticSeverity.Error || 
                 d.severity === vscode.DiagnosticSeverity.Warning
             );

             if (errorsAndWarnings.length === 0) continue;

             const relativePath = vscode.workspace.asRelativePath(uri);
             
             for (const diag of errorsAndWarnings) {
                 const severity = diag.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
                 const line = diag.range.start.line + 1;
                 // Format: [Severity] in [File] at line [Line]: [Message]
                 // This format is parsed by smartErrorEngine (which expects file path in the string)
                 diagnostics.push(`${severity} in ${relativePath} at line ${line}: ${diag.message}`);
             }
        }
        return diagnostics;
    }

    private async handleAnalysisRequest(payload: { prompt: string; selectedFiles: string[] }) {
        if (!this._view) return;

        // Only auto-index for non-trivial requests (not simple greetings)
        const isSimpleGreeting = this.isSimpleGreeting(payload.prompt);
        if (!isSimpleGreeting && !this._workspaceId && !this._isAutoIndexing) {
            this.triggerAutoIndex();
        }

        this.postMessage('set-loading', true);
        this.postMessage('update-status', { text: `Analyzing request...` });

        this._activeJobId = crypto.randomUUID();
        this._jobChecksums.clear();
        
        try {
            const allFiles = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.*}/**');
            
            if (allFiles.length === 0) {
                this.postMessage('error', { message: "Your workspace is empty. Please open a project folder." });
                this.postMessage('set-loading', false);
                this.postMessage('update-status', { text: `Error: No files in workspace` });
                return;
            }

            const fileDataForBackend: FileData[] = [];
            let skippedCount = 0;

            for (const fileUri of allFiles) {
                try {
                    const relativePath = vscode.workspace.asRelativePath(fileUri);
                    
                    // SAFETY 1: Skip Lock Files and common binary/large text formats
                    if (relativePath.includes('package-lock.json') || 
                        relativePath.includes('yarn.lock') || 
                        relativePath.endsWith('.svg') ||
                        relativePath.endsWith('.png') ||
                        relativePath.endsWith('.ico')) {
                        continue;
                    }

                    // SAFETY 2: Check File Size (limit to 100KB)
                    const stat = await (vscode.workspace as any).fs.stat(fileUri);
                    if (stat.size > this.MAX_FILE_SIZE) {
                        skippedCount++;
                        continue;
                    }

                    const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
                    const content = new TextDecoder().decode(contentBytes);
                    const checksum = calculateChecksum(content);
                    
                    // Checksum tracking for safe application later
                    this._jobChecksums.set(relativePath, checksum);
                    
                    fileDataForBackend.push({ filePath: relativePath, content, checksum });
                } catch (readErr) {
                    console.warn(`Failed to read file ${fileUri.fsPath}:`, readErr);
                }
            }

            if (skippedCount > 0) {
                console.log(`Skipped ${skippedCount} large files (>100KB) to prevent overload.`);
            }
            
            // Gather diagnostics to send to backend for error fixing
            const diagnostics = this.getWorkspaceDiagnostics();

            const result: AnalysisResult = await callBackend(
                payload.prompt, 
                fileDataForBackend, 
                this._activeJobId, 
                payload.selectedFiles,
                diagnostics,
                (progressMsg) => {
                    this.postMessage('progress-update', { message: progressMsg });
                }
            );
            
            this.postMessage('analysis-complete', {
                reasoning: result.reasoning,
                changes: result.changes,
                jobId: this._activeJobId,
            });
            this.postMessage('update-status', { text: `Analysis complete. Ready to apply changes.` });

        } catch (e: any) {
             console.error('Error during analysis:', e);
             this.postMessage('error', {
                code: e.code || 'extension/analysis-error',
                message: e.message || 'An unknown error occurred during analysis.',
                details: e.details
            });
            this.postMessage('update-status', { text: 'Error' });
        } finally {
            this.postMessage('set-loading', false);
            if (!this._activeJobId) { // If job was not set or already cleared
                this.postMessage('update-status', { text: `Ready` });
            }
        }
    }

    private async handleCancelRequest() {
        if (this._activeJobId) {
            try {
                await cancelBackendJob(this._activeJobId);
                this.postMessage('update-status', { text: 'Analysis cancelled.' });
            } catch (e: any) {
                console.error('Failed to send cancellation request:', e);
                 this.postMessage('error', {
                    code: e.code || 'extension/cancel-error',
                    message: e.message || 'Failed to cancel the analysis.',
                    details: e.details
                });
            } finally {
                 this.postMessage('set-loading', false);
                 this._activeJobId = null;
            }
        }
    }

    public dispose() {
        while (this._disposables.length > 0) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

	private _getHtmlForWebview(webview: any) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'web-ui', 'dist', 'assets', 'index.js')));
		const stylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'web-ui', 'dist', 'assets', 'index.css')));
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <title>Platypus AI</title>
    <link rel="stylesheet" href="${stylesUri}">
</head>
<body class="bg-gray-900 text-gray-200 font-sans">
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
