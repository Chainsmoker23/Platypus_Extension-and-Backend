import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';
import { calculateChecksum } from './workspaceUtils';

interface CodeChange {
    filePath: string;
    diff: string;
}

export async function applyChanges(changesToApply: CodeChange[], originalChecksums: Map<string, string>): Promise<void> {
    if (!Array.isArray(changesToApply) || changesToApply.length === 0) {
        return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error("Cannot apply changes without an open workspace folder.");
    }

    // --- Concurrency Check ---
    for (const change of changesToApply) {
        const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, change.filePath));
        const document = await vscode.workspace.openTextDocument(fileUri);
        const currentContent = document.getText();
        const currentChecksum = calculateChecksum(currentContent);
        const originalChecksum = originalChecksums.get(change.filePath);
        
        if (originalChecksum && currentChecksum !== originalChecksum) {
            throw new Error(`File ${change.filePath} has been modified since analysis. Please re-run the analysis.`);
        }
    }

    // --- Apply Patches ---
    for (const change of changesToApply) {
        const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, change.filePath));
        
        const patches = diff.parsePatch(change.diff);
        if (patches.length !== 1) {
            throw new Error(`Invalid patch format for ${change.filePath}. Expected 1 patch, got ${patches.length}.`);
        }
        const patch = patches[0];

        // Iterate hunks backwards to avoid line number shifts
        for (const hunk of [...patch.hunks].reverse()) {
            const startLine = hunk.oldStart - 1; 
            const linesToRemove = hunk.oldLines;

            const range = new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(startLine + linesToRemove, 0)
            );
            
            const newContent = hunk.lines
                .filter(line => line.charAt(0) !== '-')
                .map(line => line.substring(1))
                .join('\\n');
            
            const replacementText = (hunk.newLines > 0 && linesToRemove > 0) ? newContent + '\\n' : newContent;
            
            workspaceEdit.replace(fileUri, range, replacementText);
        }
    }
    
    const success = await vscode.workspace.applyEdit(workspaceEdit);
    if (success) {
        vscode.window.showInformationMessage("Platypus AI changes applied successfully.");
    } else {
        throw new Error("Failed to apply some or all changes. The files may have been modified externally.");
    }
}
