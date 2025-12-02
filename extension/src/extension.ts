import * as vscode from 'vscode';
import { PlatypusViewProvider } from './PlatypusViewProvider';
import { changeHistory } from './utils/changeHistory';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PlatypusViewProvider(vscode.Uri.file(context.extensionPath));

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'platypusAIView',
            provider
        )
    );

    // Auto-index workspace when opened
    if (vscode.workspace.workspaceFolders?.length) {
        // Small delay to ensure extension is fully loaded
        setTimeout(() => {
            provider['handleGetKnowledgeStatus']();
        }, 3000);
    }

    // Register Undo Last Change command
    const undoCommand = vscode.commands.registerCommand('platypus.undoLastChange', async () => {
        await changeHistory.undoLastChange();
    });

    // Register Show Change History command
    const historyCommand = vscode.commands.registerCommand('platypus.showHistory', async () => {
        const history = changeHistory.getHistory();
        if (history.length === 0) {
            vscode.window.showInformationMessage('No change history available.');
            return;
        }

        const items = history.map((h, idx) => ({
            label: `$(history) Change #${history.length - idx}`,
            description: `${h.operationsCount} operation(s)`,
            detail: `Applied at ${h.timestamp.toLocaleString()}`
        }));

        await vscode.window.showQuickPick(items, {
            placeHolder: 'Recent Platypus AI changes',
            canPickMany: false
        });
    });

    context.subscriptions.push(undoCommand, historyCommand);
}

export function deactivate() {}

