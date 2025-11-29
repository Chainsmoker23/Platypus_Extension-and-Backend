import * as vscode from 'vscode';
import { FileData as ImportedFileData } from '../types';
import { AnalysisResult } from '../types';

const BACKEND_URL = 'http://localhost:3001/api/v1';

export async function callBackend(prompt: string, files: ImportedFileData[], jobId: string): Promise<AnalysisResult> {
    console.log(`Calling backend for job ${jobId} with prompt and ${files.length} file(s)...`);
    try {
        const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, files, jobId }),
        });

        const responseBody = await response.json();

        if (!response.ok) {
            console.error('Backend request failed:', response.status, responseBody);
            throw responseBody;
        }

        return responseBody as AnalysisResult;

    } catch (error: any) {
        if (!error.code) {
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
export type FileData = { path: string; content: string; checksum: string };