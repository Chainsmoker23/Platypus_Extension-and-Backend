import { Router } from 'express';
import { generateAnalysis } from '../services/geminiService';
import { AnalysisRequest } from '../types';

const router = Router();

router.post('/', async (req, res) => {
    const { prompt, files } = req.body as AnalysisRequest;

    if (!prompt || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Missing prompt or files' });
    }

    try {
        const result = await generateAnalysis(prompt, files);
        res.json(result);
    } catch (error) {
        console.error('Error in analysis endpoint:', error);
        res.status(500).json({ error: 'Failed to get analysis from AI model' });
    }
});

export { router as analyzeRouter };
