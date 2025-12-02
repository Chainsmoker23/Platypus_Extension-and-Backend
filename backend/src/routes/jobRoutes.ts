
import { Router } from 'express';

const router = Router();

// Simple stub: acknowledge cancel request so the extension UI can update.
router.post('/:jobId/cancel', (req, res) => {
  const { jobId } = req.params;
  console.log(`[Jobs] Cancel requested for job ${jobId} (no-op stub).`);
  res.status(200).json({ message: `Cancel acknowledged for job ${jobId}.` });
});

export { router as jobRouter };