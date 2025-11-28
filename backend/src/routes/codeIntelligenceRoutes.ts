import { Router } from 'express';
import { handleCodeIntelligenceRequest } from '../controllers/codeIntelligenceController';

const router = Router();

router.post('/analyze', handleCodeIntelligenceRequest);

export { router as codeIntelligenceRouter };
