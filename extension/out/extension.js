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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const PlatypusViewProvider_1 = require("./PlatypusViewProvider");
const changeHistory_1 = require("./utils/changeHistory");
function activate(context) {
    const provider = new PlatypusViewProvider_1.PlatypusViewProvider(vscode.Uri.file(context.extensionPath), context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('platypusAIView', provider));
    // Register New Chat command
    const newChatCommand = vscode.commands.registerCommand('platypus.newChat', () => {
        // Send new chat command to the webview
        provider['postMessage']('trigger-new-chat', {});
    });
    // Register Toggle History command
    const toggleHistoryCommand = vscode.commands.registerCommand('platypus.toggleHistory', () => {
        // Send toggle history command to the webview
        provider['postMessage']('trigger-toggle-history', {});
    });
    // Auto-index workspace when opened
    if (vscode.workspace.workspaceFolders?.length) {
        // Small delay to ensure extension is fully loaded
        setTimeout(() => {
            provider['handleGetKnowledgeStatus']();
        }, 3000);
    }
    // Register Undo Last Change command
    const undoCommand = vscode.commands.registerCommand('platypus.undoLastChange', async () => {
        await changeHistory_1.changeHistory.undoLastChange();
    });
    // Register Show Change History command
    const historyCommand = vscode.commands.registerCommand('platypus.showHistory', async () => {
        const history = changeHistory_1.changeHistory.getHistory();
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
    context.subscriptions.push(undoCommand, historyCommand, newChatCommand, toggleHistoryCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map