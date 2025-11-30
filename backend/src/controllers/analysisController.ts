
import { Request, Response, NextFunction } from 'express';
// FIX: Import from the new engine orchestrator instead of the old geminiService
import { generateWorkspaceAnalysis } from '../engine/orchestrator';
import { AnalysisRequest } from '../types/index';
import { jobManager } from '../services/jobManager';

export const handleAnalysisRequest = async (req: Request, res: Response, next: NextFunction) => {
    // FIX: Cast req to any to access body
    const { prompt, files, jobId, selectedFilePaths, diagnostics } = (req as any).body as AnalysisRequest;
    
    const requestId = (req as any).id;

    if (!prompt || !files || !Array.isArray(files) || files.length === 0) {
        console.error(`[${requestId}] Bad Request: Missing prompt or files.`);
        // FIX: Cast res to any to access status
        return (res as any).status(400).json({ error: 'Missing prompt or files' });
    }
    
    if (!jobId) {
        console.error(`[${requestId}] Bad Request: Missing jobId.`);
        // FIX: Cast res to any to access status
        return (res as any).status(400).json({ error: 'Missing jobId' });
    }

    const signal = jobManager.create(jobId);

    // Set headers for NDJSON streaming
    // FIX: Cast res to any to access setHeader
    (res as any).setHeader('Content-Type', 'application/x-ndjson');
    (res as any).setHeader('Transfer-Encoding', 'chunked');

    try {
        console.log(`[${requestId}] Received workspace analysis request for job ${jobId} with ${files.length} files.`);
        
        const result = await generateWorkspaceAnalysis(prompt, files, signal, selectedFilePaths, (message) => {
            // FIX: Cast res to any to access write
            (res as any).write(JSON.stringify({ type: 'progress', message }) + '\n');
        }, diagnostics);

        console.log(`[${requestId}] Analysis for job ${jobId} successful.`);
        jobManager.complete(jobId);
        
        // FIX: Cast res to any to access write and end
        (res as any).write(JSON.stringify({ type: 'result', data: result }) + '\n');
        (res as any).end();

    } catch (error) {
        if (error instanceof Error && error.message === 'Aborted') {
            console.log(`[${requestId}] Job ${jobId} was cancelled.`);
            jobManager.cancel(jobId);
        } else {
            jobManager.fail(jobId);
        }
        
        // Since headers are already sent, we must stream the error
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // FIX: Cast res to any to access write and end
        (res as any).write(JSON.stringify({ type: 'error', error: { message: errorMessage } }) + '\n');
        (res as any).end();
    }
}
