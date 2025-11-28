import * as vscode from 'vscode';
import * as path from 'path';
import { getWorkspaceFiles, buildFileTree, FileWithChecksum } from './utils/workspaceUtils';
import { callBackend } from './utils/backendApi';
import { applyChanges } from './utils/diffApplier';

export class PlatypusPanel {
    public static currentPanel: PlatypusPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _fileChecksums: Map<string, string> = new Map();

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
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'webview-ready':
                await this.loadAndSendFileTree();
                break;
            case 'analyze-code':
                await this.handleAnalysisRequest(message.payload);
                break;
            case 'apply-changes':
                await this.handleApplyChangesRequest(message.payload);
                break;
        }
    }

    private async loadAndSendFileTree() {
        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Scanning project files...' });
        const { files, checksums } = await getWorkspaceFiles();
        this._fileChecksums = checksums;
        const fileTree = buildFileTree(files.map(f => f.uri));
        this._panel.webview.postMessage({ command: 'load-file-tree', payload: fileTree });
        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Ready to analyze.' });
    }

    private async handleAnalysisRequest(payload: { prompt: string; selectedFiles: string[] }) {
        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Reading files and analyzing codebase...' });
        try {
            const { files: allFiles, checksums } = await getWorkspaceFiles();
            this._fileChecksums = checksums;

            let filesToAnalyze: FileWithChecksum[];
            if (payload.selectedFiles && payload.selectedFiles.length > 0) {
                 filesToAnalyze = allFiles.filter(f => payload.selectedFiles.includes(f.relativePath));
            } else {
                filesToAnalyze = allFiles;
            }

            if (filesToAnalyze.length === 0) {
                vscode.window.showErrorMessage("No files selected or found in the workspace to analyze.");
                this._panel.webview.postMessage({ command: 'analysis-complete', payload: null });
                return;
            }
            
            const fileData = filesToAnalyze.map(({ relativePath, content, checksum }) => ({
                filePath: relativePath,
                content,
                checksum,
            }));

            const result = await callBackend(payload.prompt, fileData);
            this._panel.webview.postMessage({ command: 'analysis-complete', payload: result });
        } catch (e) {
             vscode.window.showErrorMessage('Error analyzing code.');
             console.error(e);
             this._panel.webview.postMessage({ command: 'analysis-complete', payload: null });
        }
    }

    private async handleApplyChangesRequest(changes: any[]) {
        try {
            await applyChanges(changes, this._fileChecksums);
            // After applying, rescan the file tree for updated checksums
            await this.loadAndSendFileTree();
        } catch (error) {
            const message = error instanceof Error ? error.message : "An unknown error occurred.";
            vscode.window.showErrorMessage(`Failed to apply changes: ${message}`);
            console.error(error);
        }
    }

    public dispose() {
        PlatypusPanel.currentPanel = undefined;
        this._panel.dispose();
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
