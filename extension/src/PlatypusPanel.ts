import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';

// --- Real Backend Service Communication ---
async function callBackend(prompt: string, files: { filePath: string; content: string }[]) {
    console.log(`Calling backend with prompt and ${files.length} files...`);
    try {
        const response = await fetch('http://localhost:3001/api/v1/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, files }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Backend request failed:', response.status, errorBody);
            throw new Error(`Backend request failed with status ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Failed to fetch from backend:", error);
        vscode.window.showErrorMessage("Could not connect to the Platypus backend service. Is it running?");
        throw error;
    }
}

// --- Real File System Reading ---
async function getWorkspaceFiles() {
    // Find all files in the workspace, excluding common ignored directories
    const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.*}/**');
    return files;
}

function buildFileTree(files: vscode.Uri[]): { id: string; name: string; type: 'file' | 'directory'; children?: any[] } {
    const root: any = { id: 'root', name: vscode.workspace.name || 'root', type: 'directory', children: [] };

    if (!vscode.workspace.workspaceFolders) {
        return root;
    }

    const workspaceRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    for (const fileUri of files) {
        const relativePath = path.relative(workspaceRootPath, fileUri.fsPath);
        const parts = relativePath.split(path.sep);
        let currentNode = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLastPart = i === parts.length - 1;

            let childNode = currentNode.children.find((child: any) => child.name === part);

            if (!childNode) {
                childNode = {
                    id: fileUri.fsPath,
                    name: part,
                    type: isLastPart ? 'file' : 'directory',
                };
                if (!isLastPart) {
                    childNode.children = [];
                }
                currentNode.children.push(childNode);
            }
            currentNode = childNode;
        }
    }
    return root;
}


export class PlatypusPanel {
    public static currentPanel: PlatypusPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (PlatypusPanel.currentPanel) {
            PlatypusPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'platypusAI',
            'Platypus AI',
            column || vscode.ViewColumn.One,
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

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'webview-ready':
                        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Scanning project files...' });
                        const allFiles = await getWorkspaceFiles();
                        const fileTree = buildFileTree(allFiles);
                        this._panel.webview.postMessage({ command: 'load-file-tree', payload: fileTree });
                        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Ready to analyze.' });
                        break;
                    case 'analyze-code':
                        this._panel.webview.postMessage({ command: 'show-loading', payload: 'Reading files and analyzing codebase...' });
                        try {
                            const workspaceFiles = await getWorkspaceFiles();
                            if (workspaceFiles.length === 0) {
                                vscode.window.showErrorMessage("No files found in the workspace to analyze.");
                                this._panel.webview.postMessage({ command: 'analysis-complete', payload: null });
                                return;
                            }

                            const filesToAnalyze = await Promise.all(
                                workspaceFiles.map(async (fileUri) => {
                                    const document = await vscode.workspace.openTextDocument(fileUri);
                                    const content = document.getText();
                                    const workspaceRoot = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath || '';
                                    return {
                                        filePath: path.relative(workspaceRoot, fileUri.fsPath),
                                        content: content
                                    };
                                })
                            );
                            
                            const result = await callBackend(message.payload.prompt, filesToAnalyze);
                            this._panel.webview.postMessage({ command: 'analysis-complete', payload: result });
                        } catch (e) {
                             vscode.window.showErrorMessage('Error analyzing code.');
                             console.error(e);
                             this._panel.webview.postMessage({ command: 'analysis-complete', payload: null });
                        }
                        break;
                    case 'apply-changes':
                        const changesToApply = message.payload;
                        if (!Array.isArray(changesToApply) || changesToApply.length === 0) {
                            return;
                        }
                        
                        const workspaceEdit = new vscode.WorkspaceEdit();
                        const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
                        if (!workspaceFolder) {
                            vscode.window.showErrorMessage("Cannot apply changes without an open workspace folder.");
                            return;
                        }

                        try {
                            for (const change of changesToApply) {
                                const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, change.filePath));
                                
                                const patches = diff.parsePatch(change.diff);
                                if (patches.length !== 1) {
                                    throw new Error(`Invalid patch format for ${change.filePath}. Expected 1 patch, got ${patches.length}.`);
                                }
                                const patch = patches[0];

                                // Iterate hunks backwards to avoid line number shifts from affecting subsequent edits in the same file.
                                for (const hunk of patch.hunks.slice().reverse()) {
                                    const startLine = hunk.oldStart - 1; // diff is 1-based, vscode is 0-based
                                    const linesToRemove = hunk.oldLines;

                                    const range = new vscode.Range(
                                        new vscode.Position(startLine, 0),
                                        // The end position is the START of the line AFTER the last line to be removed.
                                        // This selects the correct number of full lines, including their line endings.
                                        new vscode.Position(startLine + linesToRemove, 0)
                                    );
                                    
                                    const newContent = hunk.lines
                                        .filter(line => line.charAt(0) !== '-')
                                        .map(line => line.substring(1))
                                        .join('\n');
                                    
                                    // If we're replacing a block of lines (not just inserting)
                                    // the replacement content must also end with a newline to separate it
                                    // from the content that follows the patch. `join` does not add a trailing newline.
                                    const replacementText = (hunk.newLines > 0 && linesToRemove > 0) ? newContent + '\n' : newContent;
                                    
                                    workspaceEdit.replace(fileUri, range, replacementText);
                                }
                            }
                            
                            const success = await vscode.workspace.applyEdit(workspaceEdit);
                            if (success) {
                                vscode.window.showInformationMessage("Platypus AI changes applied successfully.");
                            } else {
                                vscode.window.showErrorMessage("Failed to apply some or all changes. The files may have been modified externally.");
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage("Failed to apply changes due to an error.");
                            console.error(error);
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        PlatypusPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const webUiBuildPath = path.join(this._extensionUri.fsPath, 'web-ui', 'dist');

        const scriptPathOnDisk = vscode.Uri.file(
            path.join(webUiBuildPath, 'assets', 'index.js')
        );
        const stylesPathOnDisk = vscode.Uri.file(
            path.join(webUiBuildPath, 'assets', 'index.css')
        );
        
        const scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });
        const stylesUri = stylesPathOnDisk.with({ scheme: 'vscode-resource' });
        
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src vscode-resource:; script-src 'nonce-${nonce}';">
    <title>Platypus AI Dev System</title>
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