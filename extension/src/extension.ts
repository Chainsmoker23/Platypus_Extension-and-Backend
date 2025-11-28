import * as vscode from 'vscode';
import { PlatypusPanel } from './PlatypusPanel';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('platypus-ai.start', () => {
            // FIX: Property 'extensionUri' does not exist on type 'ExtensionContext'.
            // Use 'extensionPath' and convert to a Uri for compatibility with older VS Code API versions.
            PlatypusPanel.createOrShow(vscode.Uri.file(context.extensionPath));
        })
    );
}

export function deactivate() {}