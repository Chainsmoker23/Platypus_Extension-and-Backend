import * as vscode from 'vscode';
import { FileSystemOperation } from '../types';

interface ChangeSnapshot {
    timestamp: Date;
    operations: FileSystemOperation[];
    fileSnapshots: Map<string, string>; // filePath -> original content
}

class ChangeHistoryManager {
    private history: ChangeSnapshot[] = [];
    private readonly MAX_HISTORY = 10;

    async captureSnapshot(operations: FileSystemOperation[]): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const fileSnapshots = new Map<string, string>();

        // Capture current state of all files that will be modified
        for (const op of operations) {
            if (op.type === 'modify' || op.type === 'delete') {
                try {
                    const uri = vscode.Uri.joinPath(workspaceFolder.uri, op.filePath);
                    const content = await vscode.workspace.fs.readFile(uri);
                    fileSnapshots.set(op.filePath, new TextDecoder().decode(content));
                } catch (e) {
                    // File might not exist yet, skip
                }
            }
        }

        this.history.push({
            timestamp: new Date(),
            operations,
            fileSnapshots
        });

        // Keep only last MAX_HISTORY snapshots
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
    }

    async undoLastChange(): Promise<boolean> {
        const snapshot = this.history.pop();
        if (!snapshot) {
            vscode.window.showWarningMessage('No changes to undo.');
            return false;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return false;

        const edit = new vscode.WorkspaceEdit();
        let changesCount = 0;

        try {
            // Reverse the operations
            for (const op of snapshot.operations) {
                const uri = vscode.Uri.joinPath(workspaceFolder.uri, op.filePath);

                if (op.type === 'create') {
                    // Undo create = delete the file
                    edit.deleteFile(uri, { ignoreIfNotExists: true });
                    changesCount++;
                } else if (op.type === 'delete') {
                    // Undo delete = restore the file
                    const originalContent = snapshot.fileSnapshots.get(op.filePath);
                    if (originalContent) {
                        edit.createFile(uri, { ignoreIfExists: false, overwrite: true });
                        edit.insert(uri, new vscode.Position(0, 0), originalContent);
                        changesCount++;
                    }
                } else if (op.type === 'modify') {
                    // Undo modify = restore original content
                    const originalContent = snapshot.fileSnapshots.get(op.filePath);
                    if (originalContent) {
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const fullRange = new vscode.Range(
                            doc.positionAt(0),
                            doc.positionAt(doc.getText().length)
                        );
                        edit.replace(uri, fullRange, originalContent);
                        changesCount++;
                    }
                }
            }

            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(
                    `✅ Undone ${changesCount} change(s) from ${snapshot.timestamp.toLocaleTimeString()}`
                );
                return true;
            } else {
                vscode.window.showErrorMessage('Failed to undo changes.');
                return false;
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Undo failed: ${error.message}`);
            return false;
        }
    }

    getHistoryCount(): number {
        return this.history.length;
    }

    getHistory(): Array<{timestamp: Date, operationsCount: number}> {
        return this.history.map(snapshot => ({
            timestamp: snapshot.timestamp,
            operationsCount: snapshot.operations.length
        }));
    }

    clear(): void {
        this.history = [];
    }
}

export const changeHistory = new ChangeHistoryManager();
