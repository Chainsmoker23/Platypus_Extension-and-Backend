import * as vscode from 'vscode';

interface FileData {
    filePath: string;
    content: string;
    checksum: string;
}

export async function callBackend(prompt: string, files: FileData[]) {
    console.log(`Calling backend with prompt and ${files.length} files...`);
    try {
        const response = await fetch('http://localhost:3001/api/v1/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, files }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Backend request failed:', response.status, errorBody);
            throw new Error(`Backend request failed with status ${response.status}: ${errorBody}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Failed to fetch from backend:", error);
        vscode.window.showErrorMessage("Could not connect to the Platypus backend service. Is it running?");
        throw error;
    }
}
