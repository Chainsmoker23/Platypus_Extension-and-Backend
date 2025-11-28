

import * as vscode from 'vscode';
import * as path from 'path';
import { indexWorkspaceFiles, buildFileTree, calculateChecksum } from './utils/workspaceUtils';
import { callBackend, cancelBackendJob, FileData } from './utils/backendApi';
import { applyChanges } from './utils/diffApplier';

export class PlatypusPanel {
    public static currentPanel: PlatypusPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _fileIndex = new Map<string, vscode.Uri>();
    private _watcher: vscode.FileSystemWatcher | undefined;
    private _activeJobId: string | null = null;
    private _activeAnalysisChecksums = new Map<string, string>();


    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (PlatypusPanel.currentPanel) {
            PlatypusPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'platypusAI', 'Platypus AI', column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'web-ui', 'dist'))]
            }
        );

        PlatypusPanel.currentPanel = new PlatypusPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(this.handleMessage.bind(this), null, this._disposables);

        this.setupFileWatcher();
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'webview-ready':
                await this.indexAndSendFileTree();
                break;
            case 'analyze-code':
                await this.handleAnalysisRequest(message.payload);
                break;
            case 'apply-changes':
                await this.handleApplyChangesRequest(message.payload);
                break;
            case 'cancel-analysis':
                await this.handleCancelRequest();
                break;
        }
    }
    
    private setupFileWatcher() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        this._watcher = vscode.workspace.createFileSystemWatcher(
             new vscode.RelativePattern(workspaceFolder, '**/*')
        );

        const refreshTree = () => this.indexAndSendFileTree();
        this._watcher.onDidCreate(refreshTree, this, this._disposables);
        this._watcher.onDidChange(refreshTree, this, this._disposables);
        this._watcher.onDidDelete(refreshTree, this, this._disposables);
    }

    private async indexAndSendFileTree() {
        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Scanning project files...' });
        const { files, index } = await indexWorkspaceFiles();
        this._fileIndex = index;
        const fileTree = buildFileTree(files);
        this._panel.webview.postMessage({ command: 'load-file-tree', payload: fileTree });
        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Ready to analyze.' });
    }

    private async handleAnalysisRequest(payload: { prompt: string; selectedFiles: string[]; jobId: string }) {
        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Reading files and analyzing codebase...' });
        this._activeJobId = payload.jobId;
        this._activeAnalysisChecksums.clear();

        try {
            let filesToAnalyzePaths = payload.selectedFiles;
            if (!filesToAnalyzePaths || filesToAnalyzePaths.length === 0) {
                filesToAnalyzePaths = Array.from(this._fileIndex.keys());
            }
            
            if (filesToAnalyzePaths.length === 0) {
                 vscode.window.showErrorMessage("No files found in the workspace to analyze.");
                 this._panel.webview.postMessage({ command: 'analysis-complete', payload: null });
                 return;
            }

            const fileDataPromises = filesToAnalyzePaths.map(async (relativePath) => {
                const fileUri = this._fileIndex.get(relativePath);
                if (!fileUri) return null;

                const document = await vscode.workspace.openTextDocument(fileUri);
                const content = document.getText();
                const checksum = calculateChecksum(content);
                this._activeAnalysisChecksums.set(relativePath, checksum);

                return { filePath: relativePath, content, checksum };
            });

            const fileData = (await Promise.all(fileDataPromises)).filter(Boolean) as FileData[];
            
            const result = await callBackend(payload.prompt, fileData, this._activeJobId);
            this._panel.webview.postMessage({ command: 'analysis-complete', payload: result });
        } catch (e: any) {
             console.error('Error analyzing code:', e);
             this._panel.webview.postMessage({ 
                command: 'error', 
                payload: {
                    code: e.code || 'extension/analysis-error',
                    message: e.message || 'An unknown error occurred during analysis.',
                    details: e.details
                }
            });
        } finally {
            this._activeJobId = null;
        }
    }

    private async handleCancelRequest() {
        if (this._activeJobId) {
            try {
                await cancelBackendJob(this._activeJobId);
            } catch (e: any) {
                console.error('Failed to send cancellation request:', e);
                 this._panel.webview.postMessage({ 
                    command: 'error', 
                    payload: {
                        code: e.code || 'extension/cancel-error',
                        message: e.message || 'Failed to cancel the analysis.',
                        details: e.details
                    }
                });
            }
        }
    }

    private async handleApplyChangesRequest(changes: any[]) {
        try {
            await applyChanges(changes, this._activeAnalysisChecksums);
            // After applying, rescan the file tree for updated checksums
            await this.indexAndSendFileTree();
        } catch (error) {
            const message = error instanceof Error ? error.message : "An unknown error occurred.";
            vscode.window.showErrorMessage(`Failed to apply changes: ${message}`);
            console.error(error);
        }
    }

    public dispose() {
        PlatypusPanel.currentPanel = undefined;
        this._panel.dispose();
        this._watcher?.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'web-ui', 'dist', 'assets', 'index.js')));
        const stylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'web-ui', 'dist', 'assets', 'index.css')));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src vscode-resource:; script-src 'nonce-${nonce}';">
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
