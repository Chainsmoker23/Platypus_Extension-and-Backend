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
exports.calculateChecksum = calculateChecksum;
exports.indexWorkspaceFiles = indexWorkspaceFiles;
exports.buildFileTree = buildFileTree;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
function calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}
async function indexWorkspaceFiles() {
    const fileUris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,venv,.*}/**');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return { files: [], index: new Map() };
    }
    const index = new Map();
    for (const uri of fileUris) {
        const relativePath = path.relative(workspaceRoot, uri.fsPath);
        index.set(relativePath, uri);
    }
    return { files: fileUris, index };
}
const MAX_DIR_CHILDREN = 200;
function buildFileTree(files) {
    const root = { id: 'root', name: vscode.workspace.name || 'root', type: 'directory', children: [], path: '' };
    if (!vscode.workspace.workspaceFolders) {
        return root;
    }
    const workspaceRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    // Sort files alphabetically
    files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    for (const fileUri of files) {
        const relativePath = path.relative(workspaceRootPath, fileUri.fsPath);
        const parts = relativePath.split(path.sep);
        let currentNode = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLastPart = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join(path.sep);
            let childNode = currentNode.children.find((child) => child.name === part);
            if (!childNode) {
                childNode = {
                    id: currentPath,
                    name: part,
                    path: currentPath,
                    type: isLastPart ? 'file' : 'directory',
                    isSelected: false,
                };
                if (!isLastPart) {
                    childNode.children = [];
                }
                // Implement paging for large directories
                if (currentNode.children.length < MAX_DIR_CHILDREN) {
                    currentNode.children.push(childNode);
                }
                else if (currentNode.children.length === MAX_DIR_CHILDREN) {
                    const remaining = '...'; // In a real scenario, you might calculate the actual number
                    currentNode.children.push({
                        id: `${currentNode.id}-placeholder`,
                        name: `... and more files`,
                        type: 'placeholder',
                        path: currentNode.path,
                    });
                }
            }
            currentNode = childNode;
        }
    }
    return root;
}
//# sourceMappingURL=workspaceUtils.js.map