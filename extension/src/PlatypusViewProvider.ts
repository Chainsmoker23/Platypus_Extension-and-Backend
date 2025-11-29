import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { calculateChecksum } from './utils/workspaceUtils';
import { callBackend, cancelBackendJob } from './utils/backendApi';
import type { FileData } from './utils/backendApi';
import { AnalysisResult, FileSystemOperation } from './types';


export class PlatypusViewProvider implements vscode.WebviewViewProvider {

	private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private _activeJobId: string | null = null;
    private readonly workspaceRoot: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'web-ui', 'dist')]
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
      
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: true,
          defaultUri: workspaceFolder.uri,
          title: "Select files/folders (only inside this project)",
        });
      
        if (uris) {
          const root = workspaceFolder.uri.fsPath + (process.platform === 'win32' ? '\\' : '/');
          const paths = uris.map(u => u.fsPath.replace(root, '').replace(/\\/g, '/')).filter(p => p);
          this._view?.webview.postMessage({ command: 'update-selected-files', payload: paths });
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
            case 'submit-prompt':
                await this.handleAnalysisRequest(message.payload);
                break;
            case 'apply-changes': {
                if (!this.workspaceRoot) {
                    vscode.window.showErrorMessage("Cannot apply changes without an open workspace.");
                    return;
                }
                const { changes } = message.payload;
                
                const applyEdit = new vscode.WorkspaceEdit();
              
                for (const change of changes as FileSystemOperation[]) {
                  const uri = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), change.filePath);
              
                  if (change.type === 'create') {
                    applyEdit.createFile(uri, { overwrite: false, ignoreIfExists: true });
                    applyEdit.replace(uri, new vscode.Range(0, 0, 0, 0), change.content || '');
                  } 
                  else if (change.type === 'modify' && change.diff) {
                    try {
                        let currentContent = '';
                        try {
                          const buffer = await vscode.workspace.fs.readFile(uri);
                          currentContent = Buffer.from(buffer).toString('utf8');
                        } catch (err) {
                          // File doesn't exist yet (common for 'create' operations) → safe to ignore
                          currentContent = '';
                        }
                        const newContent = this.applyPatch(currentContent, change.diff);
                        if (newContent !== null) {
                            const stats = await vscode.workspace.fs.stat(uri);
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

    private async handleAnalysisRequest(payload: { prompt: string; selectedFiles: string[] }) {
        if (!this._view) return;

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
                const contentBytes = await vscode.workspace.fs.readFile(fileUri);
                const content = Buffer.from(contentBytes).toString('utf-8');
                const checksum = calculateChecksum(content);
                fileDataForBackend.push({ filePath: relativePath, content, checksum });
            }
            
            const result: AnalysisResult = await callBackend(payload.prompt, fileDataForBackend, this._activeJobId, payload.selectedFiles);
            
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

	private _getHtmlForWebview(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'web-ui', 'dist', 'assets', 'index.js'));
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'web-ui', 'dist', 'assets', 'index.css'));
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