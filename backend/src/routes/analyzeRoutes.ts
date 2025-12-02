
import { Router } from 'express';
import { handleAnalysisRequest } from '../controllers/analysisController';

const router = Router();

// Delegate POST /api/analyze to the full intelligent agent pipeline
router.post('/', handleAnalysisRequest as any);

export { router as analyzeRouter };