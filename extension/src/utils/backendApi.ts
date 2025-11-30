
import * as vscode from 'vscode';
import { AnalysisResult } from '../types';

const BACKEND_URL = 'http://localhost:3001/api/v1';

export type FileData = {
  filePath: string;
  content: string;
  checksum: string;
};

export async function callBackend(
    prompt: string, 
    files: FileData[], 
    jobId: string, 
    selectedFilePaths: string[],
    onProgress?: (message: string) => void
): Promise<AnalysisResult> {
    console.log(`Calling backend for job ${jobId} with prompt and ${files.length} file(s)...`);
    try {
        const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, files, jobId, selectedFilePaths }),
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
