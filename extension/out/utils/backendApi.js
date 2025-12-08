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
exports.callBackend = callBackend;
exports.cancelBackendJob = cancelBackendJob;
exports.indexCodebase = indexCodebase;
exports.searchKnowledge = searchKnowledge;
exports.getKnowledgeStatus = getKnowledgeStatus;
const vscode = __importStar(require("vscode"));
const BACKEND_URL = 'http://localhost:3001/api';
async function callBackend(prompt, files, jobId, selectedFilePaths, diagnostics, onProgress) {
    console.log(`Calling backend for job ${jobId} with prompt and ${files.length} file(s)...`);
    try {
        const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, files, jobId, selectedFilePaths, diagnostics }),
        });
        if (!response.ok) {
            const responseBody = await response.text();
            console.error('Backend request failed:', response.status, responseBody);
            throw new Error(`Backend failed with status ${response.status}: ${responseBody}`);
        }
        if (!response.body) {
            throw new Error("No response body received from backend");
        }
        // Handle streaming response (NDJSON)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep the last partial line in the buffer
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'progress') {
                        if (onProgress)
                            onProgress(msg.message);
                    }
                    else if (msg.type === 'progress-detailed') {
                        // Handle enhanced progress updates
                        if (onProgress)
                            onProgress(msg.data.message);
                    }
                    else if (msg.type === 'result') {
                        finalResult = msg.data;
                    }
                    else if (msg.type === 'error') {
                        throw msg.error;
                    }
                }
                catch (e) {
                    // If JSON parse fails or it's an error object thrown
                    if (e instanceof Error && 'message' in e) {
                        throw e;
                    }
                    console.warn("Skipping invalid JSON line:", line);
                }
            }
        }
        if (!finalResult) {
            throw new Error("Stream ended without returning a result");
        }
        return finalResult;
    }
    catch (error) {
        if (!error.code && !error.message?.includes('Backend failed')) {
            console.error("Failed to fetch from backend:", error);
            vscode.window.showErrorMessage("Could not connect to the Platypus backend service. Is it running?");
            throw {
                code: 'extension/network-error',
                message: 'Could not connect to the Platypus backend. Please ensure it is running.',
                details: error.message
            };
        }
        throw error;
    }
}
async function cancelBackendJob(jobId) {
    console.log(`Sending cancellation for job ${jobId}...`);
    try {
        const response = await fetch(`${BACKEND_URL}/jobs/${jobId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            const errorBody = await response.json();
            throw errorBody;
        }
        return await response.json();
    }
    catch (error) {
        if (!error.code) {
            console.error("Failed to send cancellation to backend:", error);
            throw {
                code: 'extension/network-error',
                message: 'Could not send cancellation request to the backend.',
                details: error.message
            };
        }
        throw error;
    }
}
// ============ Knowledge Base / RAG API ============
/**
 * Index the codebase into the vector database
 */
async function indexCodebase(files, workspaceId, onProgress) {
    console.log(`Indexing ${files.length} files...`);
    try {
        const response = await fetch(`${BACKEND_URL}/knowledge/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, workspaceId }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Indexing failed: ${errorBody}`);
        }
        if (!response.body) {
            throw new Error('No response body');
        }
        // Stream response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'progress' && onProgress) {
                        onProgress(msg.data);
                    }
                    else if (msg.type === 'result') {
                        result = msg.data;
                    }
                    else if (msg.type === 'error') {
                        throw new Error(msg.error?.message || 'Indexing failed');
                    }
                }
                catch (e) {
                    if (e instanceof SyntaxError) {
                        console.warn('Skipping invalid JSON:', line);
                    }
                    else {
                        throw e;
                    }
                }
            }
        }
        if (!result) {
            throw new Error('No result received from indexing');
        }
        return result;
    }
    catch (error) {
        console.error('Indexing error:', error);
        throw {
            code: 'extension/indexing-error',
            message: error.message || 'Failed to index codebase',
            details: error,
        };
    }
}
/**
 * Search the indexed codebase
 */
async function searchKnowledge(workspaceId, query, limit = 10) {
    try {
        const response = await fetch(`${BACKEND_URL}/knowledge/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, query, limit }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Search failed: ${errorBody}`);
        }
        const data = await response.json();
        return {
            results: data.results || [],
            summary: data.summary || '',
        };
    }
    catch (error) {
        console.error('Search error:', error);
        throw {
            code: 'extension/search-error',
            message: error.message || 'Failed to search codebase',
        };
    }
}
/**
 * Get knowledge base status
 */
async function getKnowledgeStatus(workspaceId) {
    try {
        const response = await fetch(`${BACKEND_URL}/knowledge/status/${workspaceId}`);
        if (!response.ok) {
            return { indexed: false, chunksCount: 0, status: 'error' };
        }
        const data = await response.json();
        return {
            indexed: data.indexed || false,
            chunksCount: data.chunksCount || 0,
            status: data.status || 'unknown',
        };
    }
    catch (error) {
        return { indexed: false, chunksCount: 0, status: 'error' };
    }
}
//# sourceMappingURL=backendApi.js.map