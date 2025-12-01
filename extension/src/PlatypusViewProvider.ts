
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as Diff from 'diff';
import { calculateChecksum } from './utils/workspaceUtils';
import { callBackend, cancelBackendJob } from './utils/backendApi';
import type { FileData } from './utils/backendApi';
import { AnalysisResult, FileSystemOperation } from './types';
import { checkLocalBrain } from './services/localBrain';
import { applyChanges } from './utils/diffApplier';


export class PlatypusViewProvider {

	private _view?: any;
    private _disposables: vscode.Disposable[] = [];
    private _activeJobId: string | null = null;
    private _jobChecksums = new Map<string, string>();
    private readonly workspaceRoot: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    private readonly MAX_FILE_SIZE = 100 * 1024; // 100KB Limit

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: any,
		context: any,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(path.join(this._extensionUri.fsPath, 'web-ui', 'dist'))]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(this.handleMessage.bind(this));
        webviewView.onDidDispose(() => this.dispose(), null, this._disposables);
	}

    private postMessage(command: string, payload: any) {
        if (this._view) {
            this._view.webview.postMessage({ command, payload });
        }
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
                this.postMessage('chat-update', {
                    id: crypto.randomUUID(),
                    role: 'ai',
                    content: 'Welcome to Platypus AI. Describe the changes you want to make to your project.',
                });
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

        // Ticket #1: Local Brain check - Instant Greeting
        const localResponse = checkLocalBrain(payload.prompt);
        if (localResponse) {
             this.postMessage('analysis-complete', {
                reasoning: localResponse.reasoning,
                changes: localResponse.changes,
                jobId: 'local-brain'
            });
            return;
        }

        this.postMessage('set-loading', true);
        this.postMessage('update-status', { text: `Indexing workspace and analyzing request...` });

        this._activeJobId = crypto.randomUUID();
        this._jobChecksums.clear(); // Reset checksums for new job
        
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
        while (this._disposables.length) {
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
