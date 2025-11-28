

import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';
import { calculateChecksum } from './workspaceUtils';

// This type needs to be kept in sync with the web-ui/src/types.ts
type FileSystemOperation =
  | { operation: 'modify'; filePath: string; diff: string; }
  | { operation: 'create'; filePath: string; content: string; }
  | { operation: 'delete'; filePath: string; }
  | { operation: 'move'; oldPath: string; newPath: string; };

async function verifyFileChecksum(filePath: string, workspaceRoot: vscode.Uri, originalChecksums: Map<string, string>): Promise<void> {
    const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, filePath));
    try {
        // FIX: The installed @types/vscode seems to be outdated and is missing the 'fs' property.
        // Casting to 'any' to bypass the type check as this is the correct modern API.
        const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
        const currentContent = Buffer.from(contentBytes).toString('utf-8');
        const currentChecksum = calculateChecksum(currentContent);
        const originalChecksum = originalChecksums.get(filePath);

        if (originalChecksum && currentChecksum !== originalChecksum) {
            throw new Error(`File ${filePath} has been modified since analysis. Please re-run the analysis.`);
        }
    } catch (error) {
        // FIX: The installed @types/vscode provides a FileSystemError type that is missing the 'code' property.
        // Casting to 'any' to bypass the type check.
        if (error instanceof vscode.FileSystemError && (error as any).code === 'FileNotFound') {
             throw new Error(`File ${filePath} was not found. It may have been moved or deleted.`);
        }
        throw error; // Re-throw other errors
    }
}

export async function applyChanges(operationsToApply: FileSystemOperation[], originalChecksums: Map<string, string>): Promise<void> {
    if (!Array.isArray(operationsToApply) || operationsToApply.length === 0) {
        return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error("Cannot apply changes without an open workspace folder.");
    }
    const workspaceRoot = workspaceFolder.uri;

    // --- Concurrency & Pre-condition Checks ---
    for (const op of operationsToApply) {
        if (op.operation === 'modify' || op.operation === 'delete') {
            await verifyFileChecksum(op.filePath, workspaceRoot, originalChecksums);
        } else if (op.operation === 'move') {
            await verifyFileChecksum(op.oldPath, workspaceRoot, originalChecksums);
        }
    }

    // --- Apply Operations to WorkspaceEdit ---
    for (const op of operationsToApply) {
        switch (op.operation) {
            case 'create': {
                const newFileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.filePath));
                // Ensure directory exists - create file is not recursive
                // FIX: The installed @types/vscode seems to be outdated and is missing the 'fs' property.
                // Casting to 'any' to bypass the type check as this is the correct modern API.
                await (vscode.workspace as any).fs.createDirectory(vscode.Uri.file(path.join(newFileUri.fsPath, '..')));
                workspaceEdit.createFile(newFileUri, { ignoreIfExists: true });
                workspaceEdit.insert(newFileUri, new vscode.Position(0, 0), op.content);
                break;
            }
            case 'delete': {
                const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.filePath));
                workspaceEdit.deleteFile(fileUri, { ignoreIfNotExists: true });
                break;
            }
            case 'move': {
                const oldUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.oldPath));
                const newUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.newPath));
                workspaceEdit.renameFile(oldUri, newUri, { overwrite: false });
                break;
            }
            case 'modify': {
                const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.filePath));
                const patches = diff.parsePatch(op.diff);
                if (patches.length !== 1) {
                    throw new Error(`Invalid patch format for ${op.filePath}. Expected 1 patch, got ${patches.length}.`);
                }
                const patch = patches[0];

                for (const hunk of [...patch.hunks].reverse()) {
                    const startLine = hunk.oldStart - 1;
                    const linesToRemove = hunk.oldLines;
                    const range = new vscode.Range(
                        new vscode.Position(startLine, 0),
                        new vscode.Position(startLine + linesToRemove, 0)
                    );
                    const newContent = hunk.lines.filter(l => l[0] !== '-').map(l => l.substring(1)).join('\\n');
                    workspaceEdit.replace(fileUri, range, newContent + (linesToRemove > 0 ? '\\n' : ''));
                }
                break;
            }
        }
    }
    
    const success = await vscode.workspace.applyEdit(workspaceEdit);
    if (success) {
        vscode.window.showInformationMessage("Platypus AI changes applied successfully.");
    } else {
        throw new Error("Failed to apply some or all changes. The files may have been modified externally.");
    }
}
