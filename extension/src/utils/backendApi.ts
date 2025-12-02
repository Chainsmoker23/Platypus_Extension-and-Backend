
import * as vscode from 'vscode';
import { AnalysisResult } from '../types';

const BACKEND_URL = 'http://localhost:3001/api';

export type FileData = {
  filePath: string;
  content: string;
  checksum: string;
};

// ============ Knowledge Base / RAG Types ============

export interface IndexingProgress {
    phase: 'parsing' | 'chunking' | 'embedding' | 'storing' | 'complete';
    current: number;
    total: number;
    message: string;
}

export interface IndexResult {
    success: boolean;
    workspaceId: string;
    chunksIndexed: number;
    filesProcessed: number;
}

export interface SearchResult {
    filePath: string;
    content: string;
    startLine: number;
    endLine: number;
    type: string;
    score: number;
}

export interface KnowledgeStatus {
    indexed: boolean;
    chunksCount: number;
    status: string;
}

export async function callBackend(
    prompt: string, 
    files: FileData[], 
    jobId: string, 
    selectedFilePaths: string[],
    diagnostics: string[],
    onProgress?: (message: string) => void
): Promise<AnalysisResult> {
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
        let finalResult: AnalysisResult | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep the last partial line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'progress') {
                        if (onProgress) onProgress(msg.message);
                    } else if (msg.type === 'result') {
                        finalResult = msg.data;
                    } else if (msg.type === 'error') {
                        throw msg.error;
                    }
                } catch (e) {
                    // If JSON parse fails or it's an error object thrown
                    if (e instanceof Error && 'message' in (e as any)) {
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

    } catch (error: any) {
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

export async function cancelBackendJob(jobId: string) {
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
    } catch (error: any) {
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
export async function indexCodebase(
    files: { filePath: string; content: string }[],
    workspaceId?: string,
    onProgress?: (progress: IndexingProgress) => void
): Promise<IndexResult> {
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
        let result: IndexResult | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'progress' && onProgress) {
                        onProgress(msg.data);
                    } else if (msg.type === 'result') {
                        result = msg.data;
                    } else if (msg.type === 'error') {
                        throw new Error(msg.error?.message || 'Indexing failed');
                    }
                } catch (e) {
                    if (e instanceof SyntaxError) {
                        console.warn('Skipping invalid JSON:', line);
                    } else {
                        throw e;
                    }
                }
            }
        }

        if (!result) {
            throw new Error('No result received from indexing');
        }

        return result;

    } catch (error: any) {
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
export async function searchKnowledge(
    workspaceId: string,
    query: string,
    limit: number = 10
): Promise<{ results: SearchResult[]; summary: string }> {
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

        const data = await response.json() as { results?: SearchResult[]; summary?: string };
        return {
            results: data.results || [],
            summary: data.summary || '',
        };

    } catch (error: any) {
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
export async function getKnowledgeStatus(workspaceId: string): Promise<KnowledgeStatus> {
    try {
        const response = await fetch(`${BACKEND_URL}/knowledge/status/${workspaceId}`);
        
        if (!response.ok) {
            return { indexed: false, chunksCount: 0, status: 'error' };
        }

        const data = await response.json() as { indexed?: boolean; chunksCount?: number; status?: string };
        return {
            indexed: data.indexed || false,
            chunksCount: data.chunksCount || 0,
            status: data.status || 'unknown',
        };

    } catch (error) {
        return { indexed: false, chunksCount: 0, status: 'error' };
    }
}
