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

export async function getWorkspaceFiles(): Promise<{ files: FileWithChecksum[], checksums: Map<string, string> }> {
    const fileUris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.*}/**');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return { files: [], checksums: new Map() };
    }

    const checksums = new Map<string, string>();
    const filesWithChecksum: FileWithChecksum[] = [];

    for (const uri of fileUris) {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            const checksum = calculateChecksum(content);
            const relativePath = path.relative(workspaceRoot, uri.fsPath);
            checksums.set(relativePath, checksum);
            filesWithChecksum.push({ uri, relativePath, content, checksum });
        } catch (e) {
            console.warn(`Could not read file ${uri.fsPath}, skipping.`, e);
        }
    }

    return { files: filesWithChecksum, checksums };
}

export function buildFileTree(files: vscode.Uri[]): { id: string; name: string; type: 'file' | 'directory'; children?: any[], path: string, isSelected?: boolean } {
    const root: any = { id: 'root', name: vscode.workspace.name || 'root', type: 'directory', children: [], path: '' };

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
                currentNode.children.push(childNode);
            }
            currentNode = childNode;
        }
    }
    return root;
}
