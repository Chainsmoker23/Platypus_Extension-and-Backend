import { RequestHandler } from 'express';
import { jobManager } from '../services/jobManager';

export const handleCancelJob: RequestHandler = (req, res) => {
    const { jobId } = req.params;
    const success = jobManager.cancel(jobId);
    if (success) {
        res.status(200).json({ message: `Job ${jobId} cancelled successfully.` });
    } else {
        res.status(404).json({ error: `Job ${jobId} not found or already completed.` });
    }
};
