import { Request, Response, NextFunction } from 'express';
import { generateModificationForFile } from '../services/geminiService';
// FIX: Changed import path to point to the correct types file.
import { AnalysisRequest } from '../types/index';
import { jobManager } from '../services/jobManager';

export const handleAnalysisRequest = async (req: Request, res: Response, next: NextFunction) => {
    const { prompt, files, jobId } = req.body as AnalysisRequest;
    
    const requestId = (req as any).id;

    if (!prompt || !files || !Array.isArray(files) || files.length === 0) {
        console.error(`[${requestId}] Bad Request: Missing prompt or the single file.`);
        return res.status(400).json({ error: 'Missing prompt or file' });
    }
    
    if (!jobId) {
        console.error(`[${requestId}] Bad Request: Missing jobId.`);
        return res.status(400).json({ error: 'Missing jobId' });
    }

    const singleFile = files[0];
    const signal = jobManager.create(jobId);

    try {
        console.log(`[${requestId}] Received single-file analysis request for job ${jobId} on file ${singleFile.filePath}.`);
        
        const result = await generateModificationForFile(prompt, singleFile, signal);

        console.log(`[${requestId}] Analysis for job ${jobId} successful.`);
        jobManager.complete(jobId);
        res.status(200).json(result);

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log(`[${requestId}] Job ${jobId} was cancelled.`);
            jobManager.cancel(jobId);
        } else {
            jobManager.fail(jobId);
        }
        // Forward error to the centralized error handler
        next(error);
    }
}