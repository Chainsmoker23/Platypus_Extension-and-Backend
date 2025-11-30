import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';
import { calculateChecksum } from './workspaceUtils';
import { FileSystemOperation } from '../types';

async function verifyFileChecksum(filePath: string, workspaceRoot: vscode.Uri, originalChecksums: Map<string, string>): Promise<void> {
    const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, filePath));
    try {
        const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
        // FIX: Replaced Node.js 'Buffer' with 'TextDecoder' for cross-platform compatibility.
        const currentContent = new TextDecoder().decode(contentBytes);
        const currentChecksum = calculateChecksum(currentContent);
        const originalChecksum = originalChecksums.get(filePath);

        if (originalChecksum && currentChecksum !== originalChecksum) {
            throw new Error(`File ${filePath} has been modified since analysis. Please re-run the analysis.`);
        }
    } catch (error) {
        if (error instanceof vscode.FileSystemError && (error as any).code === 'FileNotFound') {
             throw new Error(`File ${filePath} was not found. It may have been moved or deleted.`);
        }
        throw error;
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

    for (const op of operationsToApply) {
        // We only verify checksums for existing files that are being modified or deleted
        if (op.type === 'modify' || op.type === 'delete') {
            await verifyFileChecksum(op.filePath, workspaceRoot, originalChecksums);
        }
    }

    for (const op of operationsToApply) {
        const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.filePath));
        switch (op.type) {
            case 'create': {
                if (typeof op.content !== 'string') {
                    throw new Error(`Invalid 'create' operation for ${op.filePath}: content is missing.`);
                }
                workspaceEdit.createFile(fileUri, { ignoreIfExists: false });
                workspaceEdit.insert(fileUri, new vscode.Position(0, 0), op.content);
                break;
            }
            case 'delete': {
                workspaceEdit.deleteFile(fileUri, { ignoreIfNotExists: true });
                break;
            }
            case 'modify': {
                if (typeof op.diff !== 'string') {
                    throw new Error(`Invalid 'modify' operation for ${op.filePath}: diff is missing.`);
                }
                const originalContentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
                // FIX: Replaced Node.js 'Buffer' with 'TextDecoder' for cross-platform compatibility.
                const originalContent = new TextDecoder().decode(originalContentBytes);

                const newContent = diff.applyPatch(originalContent, op.diff);
                if (newContent === false) {
                    throw new Error(`Failed to apply patch to ${op.filePath}. The file may have changed in a way that conflicts with the patch.`);
                }

                const doc = await vscode.workspace.openTextDocument(fileUri);
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(originalContent.length)
                );
                workspaceEdit.replace(fileUri, fullRange, newContent);
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