import { Request, Response } from 'express';
import { generateAnalysis } from '../services/geminiService';
import { AnalysisRequest } from '../types';

export async function handleAnalysisRequest(req: Request, res: Response) {
    const { prompt, files } = req.body as AnalysisRequest;
    
    // @ts-ignore
    const requestId = req.id;

    if (!prompt || !files || !Array.isArray(files)) {
        console.error(`[${requestId}] Bad Request: Missing prompt or files.`);
        return res.status(400).json({ error: 'Missing prompt or files' });
    }

    try {
        console.log(`[${requestId}] Received analysis request with ${files.length} files.`);
        const result = await generateAnalysis(prompt, files);
        console.log(`[${requestId}] Analysis successful. Sending response.`);
        res.json(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${requestId}] Error in analysis endpoint:`, errorMessage);
        res.status(500).json({ error: `Failed to get analysis from AI model: ${errorMessage}` });
    }
}
