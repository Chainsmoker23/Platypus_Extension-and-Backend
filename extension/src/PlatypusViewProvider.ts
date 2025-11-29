import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { calculateChecksum } from './utils/workspaceUtils';
import { callBackend, cancelBackendJob } from './utils/backendApi';
import type { FileData } from './utils/backendApi';
import { applyChanges } from './utils/diffApplier';
import { AnalysisResult } from './types';


export class PlatypusViewProvider implements vscode.WebviewViewProvider {

	private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private _activeJobId: string | null = null;
    private _activeAnalysisChecksums = new Map<string, string>();

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

    private async handleMessage(message: any) {
        if (!this._view) return;

        switch (message.command) {
            case 'webview-ready':
                this.postMessage('chat-update', {
                    id: crypto.randomUUID(),
                    role: 'ai',
                    content: 'Welcome to Platypus AI. Open a file and describe the changes you want to make.',
                });
                this.postMessage('update-status', { text: `Ready` });
                break;
            case 'submit-prompt':
                await this.handleAnalysisRequest(message.payload);
                break;
            case 'cancel-analysis':
                await this.handleCancelRequest();
                break;
        }
    }

    private async handleAnalysisRequest(payload: { prompt: string }) {
        if (!this._view) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.postMessage('error', { message: "Please open a file in the editor before submitting a prompt." });
            return;
        }
        
        this.postMessage('set-loading', true);
        this.postMessage('update-status', { text: `Analyzing active file...` });
        this._activeJobId = crypto.randomUUID();
        this._activeAnalysisChecksums.clear();

        try {
            const document = editor.document;
            const relativePath = vscode.workspace.asRelativePath(document.uri);
            const content = document.getText();
            const checksum = calculateChecksum(content);

            this._activeAnalysisChecksums.set(relativePath, checksum);
            
            // This is a temporary hack to satisfy both the local type and the backend type
            const fileDataForBackend: any[] = [{ filePath: relativePath, content, checksum }];
            
            const result: AnalysisResult = await callBackend(payload.prompt, fileDataForBackend, this._activeJobId);
            
            this.postMessage('chat-update', {
                id: crypto.randomUUID(),
                role: 'ai',
                content: result.reasoning,
            });

            this.postMessage('update-status', { text: `Applying changes...` });
            await applyChanges(result.changes, this._activeAnalysisChecksums);
            this.postMessage('update-status', { text: `Changes applied successfully.` });


        } catch (e: any) {
             console.error('Error during analysis and application:', e);
             this.postMessage('error', {
                code: e.code || 'extension/analysis-error',
                message: e.message || 'An unknown error occurred during analysis.',
                details: e.details
            });
            this.postMessage('update-status', { text: 'Error' });
        } finally {
            this.postMessage('set-loading', false);
            this._activeJobId = null;
            this.postMessage('update-status', { text: `Ready` });
        }
    }

    private async handleCancelRequest() {
        if (this._activeJobId) {
            try {
                await cancelBackendJob(this._activeJobId);
            } catch (e: any) {
                console.error('Failed to send cancellation request:', e);
                 this.postMessage('error', {
                    code: e.code || 'extension/cancel-error',
                    message: e.message || 'Failed to cancel the analysis.',
                    details: e.details
                });
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