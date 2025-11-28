
import { RequestHandler } from 'express';
import { generateAnalysis } from '../services/geminiService';
// FIX: Changed import path to point to the correct types file.
import { AnalysisRequest } from '../types/index';
import { jobManager } from '../services/jobManager';

export const handleAnalysisRequest: RequestHandler = async (req, res, next) => {
    const { prompt, files, jobId } = req.body as AnalysisRequest;
    
    const requestId = (req as any).id;

    if (!prompt || !files || !Array.isArray(files)) {
        console.error(`[${requestId}] Bad Request: Missing prompt or files.`);
        return res.status(400).json({ error: 'Missing prompt or files' });
    }
    
    if (!jobId) {
        console.error(`[${requestId}] Bad Request: Missing jobId.`);
        return res.status(400).json({ error: 'Missing jobId' });
    }

    const signal = jobManager.create(jobId);

    try {
        console.log(`[${requestId}] Received analysis request for job ${jobId} with ${files.length} files.`);
        const result = await generateAnalysis(prompt, files, signal);
        console.log(`[${requestId}] Analysis for job ${jobId} successful. Sending response.`);
        jobManager.complete(jobId);
        res.json(result);
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