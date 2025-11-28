
import * as vscode from 'vscode';

// FIX: Export FileData interface to be used in other files.
export interface FileData {
    filePath: string;
    content: string;
    checksum: string;
}

const BACKEND_URL = 'http://localhost:3001/api/v1';

export async function callBackend(prompt: string, files: FileData[], jobId: string) {
    console.log(`Calling backend for job ${jobId} with prompt and ${files.length} files...`);
    try {
        const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, files, jobId }),
        });

        if (!response.ok) {
            // Attempt to parse the structured error from the backend
            const errorBody = await response.json();
            console.error('Backend request failed:', response.status, errorBody);
            throw errorBody; // Throw the structured error object
        }
        return await response.json();
    } catch (error: any) {
        // If it's a network error or JSON parsing fails, create a standard error
        if (!error.code) {
             console.error("Failed to fetch from backend:", error);
             vscode.window.showErrorMessage("Could not connect to the Platypus backend service. Is it running?");
             throw {
                code: 'extension/network-error',
                message: 'Could not connect to the Platypus backend. Please ensure it is running.',
                details: error.message
             };
        }
        throw error; // Re-throw structured error
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