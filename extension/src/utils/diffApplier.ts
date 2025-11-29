import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';
import { calculateChecksum } from './workspaceUtils';
import { FileSystemOperation } from '../types';

async function verifyFileChecksum(filePath: string, workspaceRoot: vscode.Uri, originalChecksums: Map<string, string>): Promise<void> {
    const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, filePath));
    try {
        const contentBytes = await (vscode.workspace as any).fs.readFile(fileUri);
        const currentContent = Buffer.from(contentBytes).toString('utf-8');
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
        await verifyFileChecksum(op.filePath, workspaceRoot, originalChecksums);
    }

    for (const op of operationsToApply) {
        switch (op.type) {
            case 'modify': {
                const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.filePath));
                const originalContentBytes = await vscode.workspace.fs.readFile(fileUri);
                const originalContent = Buffer.from(originalContentBytes).toString('utf-8');

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