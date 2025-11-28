
import { Router } from 'express';
import { generateAnalysis } from '../services/geminiService';
// FIX: Changed import path to point to the correct types file.
import { AnalysisRequest } from '../types/index';

const router = Router();

router.post('/', async (req, res) => {
    const { prompt, files } = req.body as AnalysisRequest;

    if (!prompt || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Missing prompt or files' });
    }

    try {
        // FIX: Added missing AbortSignal argument to the generateAnalysis call.
        const result = await generateAnalysis(prompt, files, new AbortController().signal);
        res.json(result);
    } catch (error) {
        console.error('Error in analysis endpoint:', error);
        res.status(500).json({ error: 'Failed to get analysis from AI model' });
    }
});

export { router as analyzeRouter };