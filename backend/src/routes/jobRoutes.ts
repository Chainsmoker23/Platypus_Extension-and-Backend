
import { Router } from 'express';
import { handleCancelJob } from '../controllers/jobController';

const router = Router();

router.post('/:jobId/cancel', handleCancelJob);

export { router as jobRouter };