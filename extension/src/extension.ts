import * as vscode from 'vscode';
import { PlatypusViewProvider } from './PlatypusViewProvider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PlatypusViewProvider(vscode.Uri.file(context.extensionPath));

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'platypusAIView', // This ID must match the one in package.json
            provider
        )
    );
}

export function deactivate() {}