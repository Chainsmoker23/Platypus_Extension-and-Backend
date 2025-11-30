
import * as vscode from 'vscode';
import * as crypto from 'crypto';
// FIX: Added 'path' import to replace 'process.platform' for determining path separators.
import * as path from 'path';
import { calculateChecksum } from './utils/workspaceUtils';
import { callBackend, cancelBackendJob } from './utils/backendApi';
import type { FileData } from './utils/backendApi';
import { AnalysisResult, FileSystemOperation } from './types';
import { checkLocalBrain } from './services/localBrain';


export class PlatypusViewProvider {

	private _view?: any;
    private _disposables: vscode.Disposable[] = [];
    private _activeJobId: string | null = null;
    private readonly workspaceRoot: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

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

    private applyPatch(original: string, patch: string): string | null {
        try {
          const lines = original.split('\n');
          const patchLines = patch.split('\n');
          let result: string[] = [];
      
          let i = 0;
          for (const line of patchLines) {
            if (line.startsWith('@@')) {
              const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
              if (match) {
                const targetLine = parseInt(match[1]) - 1;
                while (i < targetLine && i < lines.length) {
                  result.push(lines[i++]);
                }
              }
            } else if (line.startsWith('+')) {
              result.push(line.slice(1));
            } else if (!line.startsWith('-') && !line.startsWith('\\')) {
              result.push(line);
              i++;
            }
          }
          while (i < lines.length) result.push(lines[i++]);
          return result.join('\n');
        } catch(e) {
          console.error("Error applying patch:", e);
          return null;
        }
    }

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
                    // For create, we show the new file content. 
                    // To show a "Diff", we can diff against the empty file (which technically doesn't exist on disk).
                    // Or we just open the Untitled file with content.
                    const newUri = vscode.Uri.parse(`untitled:${change.filePath}`);
                    const doc = await vscode.workspace.openTextDocument(newUri);
                    const editor = await vscode.window.showTextDocument(doc, { preview: true });
                    await editor.edit(edit => {
                        edit.insert(new vscode.Position(0, 0), change.content || '');
                    });
                    
                    // Optional: Show diff against current (non-existent) to highlight it's new
                    // But showing the file is usually enough for 'create'.
                    // The prompt asked for "beautiful native VS Code diff tabs", so let's try to trigger a diff if possible
                    // But diffing against a non-existent file on disk often just shows empty vs content.
                    vscode.commands.executeCommand('vscode.diff', uri, newUri, `${change.filePath} (New File)`);
                  }
                  else if (change.type === 'modify' && change.diff) {
                    let currentContent = '';
                    try {
                        const buffer = await (vscode.workspace as any).fs.readFile(uri);
                        currentContent = new TextDecoder().decode(buffer);
                    } catch (e) { }

                    // Apply the patch to get the "New" content
                    const newContent = this.applyPatch(currentContent, change.diff);
                    
                    if (newContent !== null) {
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
                
                const applyEdit = new vscode.WorkspaceEdit();
              
                for (const change of changes as FileSystemOperation[]) {
                  const uri = vscode.Uri.file(path.join(this.workspaceRoot, change.filePath));
              
                  if (change.type === 'create') {
                    applyEdit.createFile(uri, { overwrite: false, ignoreIfExists: true });
                    applyEdit.replace(uri, new vscode.Range(0, 0, 0, 0), change.content || '');
                  } 
                  else if (change.type === 'modify' && change.diff) {
                    try {
                        let currentContent = '';
                        try {
                          const buffer = await (vscode.workspace as any).fs.readFile(uri);
                          // FIX: Replaced Node.js 'Buffer' with 'TextDecoder' to safely convert Uint8Array to string.
                          currentContent = new TextDecoder().decode(buffer);
                        } catch (err) {
                          // File doesn't exist yet (common for 'create' operations) → safe to ignore
                          currentContent = '';
                        }
                        const newContent = this.applyPatch(currentContent, change.diff);
                        if (newContent !== null) {
                            const stats = await (vscode.workspace as any).fs.stat(uri);
                            const fullRange = new vscode.Range(0, 0, stats.size, 0); // Approximate full range
                            applyEdit.replace(uri, fullRange, newContent);
                        } else {
                            throw new Error(`Failed to apply patch for ${change.filePath}`);
                        }
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to modify file ${change.filePath}: ${e.message}`);
                    }
                  }
                  else if (change.type === 'delete') {
                    applyEdit.deleteFile(uri, { recursive: true, ignoreIfNotExists: true });
                  }
                }
              
                await vscode.workspace.applyEdit(applyEdit);
                vscode.window.showInformationMessage(`Platypus applied ${changes.length} change(s)`);
                this.postMessage('update-status', { text: 'Changes applied. Ready.' });
                this._activeJobId = null;
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
        
        try {
            const allFiles = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.*}/**');
            
            if (allFiles.length === 0) {
                this.postMessage('error', { message: "Your workspace is empty. Please open a project folder." });
                this.postMessage('set-loading', false);
                this.postMessage('update-status', { text: `Error: No files in workspace` });
                return;
            }

            const fileDataForBackend: FileData[] = [];
            for (const fileUri of allFiles) {
                const relativePath = vscode.workspace.asRelativePath(fileUri);
                const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
                // FIX: Replaced Node.js 'Buffer' with 'TextDecoder' for cross-platform compatibility when reading file content.
                const content = new TextDecoder().decode(contentBytes);
                const checksum = calculateChecksum(content);
                fileDataForBackend.push({ filePath: relativePath, content, checksum });
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