"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeHistory = void 0;
const vscode = __importStar(require("vscode"));
class ChangeHistoryManager {
    constructor() {
        this.history = [];
        this.MAX_HISTORY = 10;
    }
    async captureSnapshot(operations) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            return;
        const fileSnapshots = new Map();
        // Capture current state of all files that will be modified
        for (const op of operations) {
            if (op.type === 'modify' || op.type === 'delete') {
                try {
                    const uri = vscode.Uri.joinPath(workspaceFolder.uri, op.filePath);
                    const content = await vscode.workspace.fs.readFile(uri);
                    fileSnapshots.set(op.filePath, new TextDecoder().decode(content));
                }
                catch (e) {
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
    async undoLastChange() {
        const snapshot = this.history.pop();
        if (!snapshot) {
            vscode.window.showWarningMessage('No changes to undo.');
            return false;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            return false;
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
                }
                else if (op.type === 'delete') {
                    // Undo delete = restore the file
                    const originalContent = snapshot.fileSnapshots.get(op.filePath);
                    if (originalContent) {
                        edit.createFile(uri, { ignoreIfExists: false, overwrite: true });
                        edit.insert(uri, new vscode.Position(0, 0), originalContent);
                        changesCount++;
                    }
                }
                else if (op.type === 'modify') {
                    // Undo modify = restore original content
                    const originalContent = snapshot.fileSnapshots.get(op.filePath);
                    if (originalContent) {
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                        edit.replace(uri, fullRange, originalContent);
                        changesCount++;
                    }
                }
            }
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(`✅ Undone ${changesCount} change(s) from ${snapshot.timestamp.toLocaleTimeString()}`);
                return true;
            }
            else {
                vscode.window.showErrorMessage('Failed to undo changes.');
                return false;
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Undo failed: ${error.message}`);
            return false;
        }
    }
    getHistoryCount() {
        return this.history.length;
    }
    getHistory() {
        return this.history.map(snapshot => ({
            timestamp: snapshot.timestamp,
            operationsCount: snapshot.operations.length
        }));
    }
    clear() {
        this.history = [];
    }
}
exports.changeHistory = new ChangeHistoryManager();
//# sourceMappingURL=changeHistory.js.map