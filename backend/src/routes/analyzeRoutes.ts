import { Router } from 'express';
import { handleAnalysisRequest } from '../controllers/analysisController';

const router = Router();

router.post('/', handleAnalysisRequest);

export { router as analyzeRouter };
