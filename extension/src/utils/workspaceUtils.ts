
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FileWithChecksum {
    uri: vscode.Uri;
    relativePath: string;
    content: string;
    checksum: string;
}

export function calculateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

export async function indexWorkspaceFiles(): Promise<{ files: vscode.Uri[], index: Map<string, vscode.Uri> }> {
    const fileUris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.*}/**');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return { files: [], index: new Map() };
    }

    const index = new Map<string, vscode.Uri>();
    for (const uri of fileUris) {
        const relativePath = path.relative(workspaceRoot, uri.fsPath);
        index.set(relativePath, uri);
    }
    return { files: fileUris, index };
}

const MAX_DIR_CHILDREN = 200;

export function buildFileTree(files: vscode.Uri[]): { id: string; name: string; type: 'file' | 'directory' | 'placeholder'; children?: any[], path: string, isSelected?: boolean } {
    const root: any = { id: 'root', name: vscode.workspace.name || 'root', type: 'directory', children: [], path: '' };

    if (!vscode.workspace.workspaceFolders) {
        return root;
    }

    const workspaceRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    // Sort files alphabetically
    files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    for (const fileUri of files) {
        const relativePath = path.relative(workspaceRootPath, fileUri.fsPath);
        const parts = relativePath.split(path.sep);
        let currentNode = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLastPart = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join(path.sep);

            let childNode = currentNode.children.find((child: any) => child.name === part);

            if (!childNode) {
                childNode = {
                    id: currentPath,
                    name: part,
                    path: currentPath,
                    type: isLastPart ? 'file' : 'directory',
                    isSelected: false,
                };
                if (!isLastPart) {
                    childNode.children = [];
                }

                // Implement paging for large directories
                if (currentNode.children.length < MAX_DIR_CHILDREN) {
                    currentNode.children.push(childNode);
                } else if (currentNode.children.length === MAX_DIR_CHILDREN) {
                    const remaining = '...'; // In a real scenario, you might calculate the actual number
                    currentNode.children.push({
                        id: `${currentNode.id}-placeholder`,
                        name: `... and more files`,
                        type: 'placeholder',
                        path: currentNode.path,
                    });
                }
            }
            currentNode = childNode;
        }
    }
    return root;
}