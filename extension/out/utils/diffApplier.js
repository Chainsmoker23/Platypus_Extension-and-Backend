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
exports.applyChanges = applyChanges;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const diff = __importStar(require("diff"));
const workspaceUtils_1 = require("./workspaceUtils");
const changeHistory_1 = require("./changeHistory");
async function verifyFileChecksum(filePath, workspaceRoot, originalChecksums) {
    const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, filePath));
    try {
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        // FIX: Replaced Node.js 'Buffer' with 'TextDecoder' for cross-platform compatibility.
        const currentContent = new TextDecoder().decode(contentBytes);
        const currentChecksum = (0, workspaceUtils_1.calculateChecksum)(currentContent);
        const originalChecksum = originalChecksums.get(filePath);
        if (originalChecksum && currentChecksum !== originalChecksum) {
            throw new Error(`File ${filePath} has been modified since analysis. Please re-run the analysis.`);
        }
    }
    catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            throw new Error(`File ${filePath} was not found. It may have been moved or deleted.`);
        }
        throw error;
    }
}
// Decoration types for highlighting changes
const addedLineDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(0, 255, 0, 0.15)',
    isWholeLine: true,
    overviewRulerColor: 'green',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiMyMmMzNWUiLz48L3N2Zz4='),
    gutterIconSize: 'contain'
});
const modifiedLineDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 165, 0, 0.15)',
    isWholeLine: true,
    overviewRulerColor: 'orange',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiNmZmE1MDAiLz48L3N2Zz4='),
    gutterIconSize: 'contain'
});
async function applyChanges(operationsToApply, originalChecksums) {
    if (!Array.isArray(operationsToApply) || operationsToApply.length === 0) {
        return;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error("Cannot apply changes without an open workspace folder.");
    }
    const workspaceRoot = workspaceFolder.uri;
    // Capture snapshot BEFORE applying changes for undo functionality
    await changeHistory_1.changeHistory.captureSnapshot(operationsToApply);
    // Enhanced error tracking
    const errors = [];
    const changeHighlights = [];
    // Verify checksums first
    for (const op of operationsToApply) {
        if (op.type === 'modify' || op.type === 'delete') {
            try {
                await verifyFileChecksum(op.filePath, workspaceRoot, originalChecksums);
            }
            catch (error) {
                errors.push(`⚠️ ${op.filePath}: ${error.message}`);
            }
        }
    }
    // If checksum verification failed, offer to proceed anyway
    if (errors.length > 0) {
        const errorList = errors.join('\n');
        const message = `Some files have been modified since analysis:

${errorList}

Do you want to apply changes anyway? This may cause conflicts.`;
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Apply Anyway', 'Cancel');
        if (choice !== 'Apply Anyway') {
            throw new Error('User cancelled due to file modifications.');
        }
        errors.length = 0; // Clear errors if user chose to proceed
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    const filesProcessed = [];
    for (const op of operationsToApply) {
        const fileUri = vscode.Uri.file(path.join(workspaceRoot.fsPath, op.filePath));
        try {
            switch (op.type) {
                case 'create': {
                    if (typeof op.content !== 'string') {
                        errors.push(`❌ ${op.filePath}: Missing content for create operation`);
                        continue;
                    }
                    workspaceEdit.createFile(fileUri, { ignoreIfExists: false, overwrite: false });
                    workspaceEdit.insert(fileUri, new vscode.Position(0, 0), op.content);
                    filesProcessed.push(`✅ Created: ${op.filePath}`);
                    // Mark entire new file as added
                    const lineCount = op.content.split('\n').length;
                    changeHighlights.push({
                        uri: fileUri,
                        addedRanges: [new vscode.Range(0, 0, lineCount - 1, 0)],
                        modifiedRanges: []
                    });
                    break;
                }
                case 'delete': {
                    workspaceEdit.deleteFile(fileUri, { ignoreIfNotExists: true });
                    filesProcessed.push(`🗑️ Deleted: ${op.filePath}`);
                    break;
                }
                case 'modify': {
                    let originalContent;
                    try {
                        const originalContentBytes = await vscode.workspace.fs.readFile(fileUri);
                        originalContent = new TextDecoder().decode(originalContentBytes);
                    }
                    catch (e) {
                        errors.push(`❌ ${op.filePath}: File not found or cannot be read`);
                        continue;
                    }
                    // Prefer full-content replacement when provided
                    if (typeof op.content === 'string') {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                        workspaceEdit.replace(fileUri, fullRange, op.content);
                        filesProcessed.push(`✏️ Modified: ${op.filePath}`);
                        // Compute changed lines
                        const changes = diff.diffLines(originalContent, op.content);
                        const addedRanges = [];
                        const modifiedRanges = [];
                        let currentLine = 0;
                        for (const change of changes) {
                            const lineCount = change.count || 0;
                            if (change.added) {
                                addedRanges.push(new vscode.Range(currentLine, 0, currentLine + lineCount - 1, 999));
                                currentLine += lineCount;
                            }
                            else if (change.removed) {
                                // Don't increment line counter for removed lines
                            }
                            else {
                                currentLine += lineCount;
                            }
                        }
                        changeHighlights.push({ uri: fileUri, addedRanges, modifiedRanges });
                        break;
                    }
                    // Fall back to diff-based patching
                    if (typeof op.diff !== 'string') {
                        errors.push(`❌ ${op.filePath}: No content or diff available`);
                        continue;
                    }
                    const newContent = diff.applyPatch(originalContent, op.diff);
                    if (newContent === false) {
                        errors.push(`❌ ${op.filePath}: Diff patch failed to apply. File may have changed.`);
                        continue;
                    }
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                    workspaceEdit.replace(fileUri, fullRange, newContent);
                    filesProcessed.push(`✏️ Modified: ${op.filePath}`);
                    // Compute changed lines from diff
                    const changes = diff.diffLines(originalContent, newContent);
                    const addedRanges = [];
                    let currentLine = 0;
                    for (const change of changes) {
                        const lineCount = change.count || 0;
                        if (change.added) {
                            addedRanges.push(new vscode.Range(currentLine, 0, currentLine + lineCount - 1, 999));
                            currentLine += lineCount;
                        }
                        else if (!change.removed) {
                            currentLine += lineCount;
                        }
                    }
                    changeHighlights.push({ uri: fileUri, addedRanges, modifiedRanges: [] });
                    break;
                }
            }
        }
        catch (error) {
            errors.push(`❌ ${op.filePath}: ${error.message}`);
        }
    }
    const success = await vscode.workspace.applyEdit(workspaceEdit);
    if (!success) {
        const errorList = errors.join('\n');
        const errorMsg = errors.length > 0
            ? `Failed to apply changes:\n\n${errorList}`
            : "Failed to apply some or all changes. The files may be locked or modified externally.";
        throw new Error(errorMsg);
    }
    // Apply visual highlights to changed files
    setTimeout(async () => {
        for (const highlight of changeHighlights) {
            try {
                const doc = await vscode.workspace.openTextDocument(highlight.uri);
                const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                if (highlight.addedRanges.length > 0) {
                    editor.setDecorations(addedLineDecoration, highlight.addedRanges);
                }
                if (highlight.modifiedRanges.length > 0) {
                    editor.setDecorations(modifiedLineDecoration, highlight.modifiedRanges);
                }
                // Clear decorations after 10 seconds
                setTimeout(() => {
                    editor.setDecorations(addedLineDecoration, []);
                    editor.setDecorations(modifiedLineDecoration, []);
                }, 10000);
            }
            catch (e) {
                // Skip if file cannot be opened
            }
        }
    }, 300);
    // Show detailed success message
    const fileList = filesProcessed.join('\n');
    const summary = `✅ Platypus AI applied ${filesProcessed.length} change(s):\n${fileList}`;
    vscode.window.showInformationMessage(`Platypus AI: ${filesProcessed.length} file(s) changed successfully!`, 'View Details').then(choice => {
        if (choice === 'View Details') {
            vscode.window.showInformationMessage(summary, { modal: true });
        }
    });
}
//# sourceMappingURL=diffApplier.js.map