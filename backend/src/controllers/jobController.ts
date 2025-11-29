
import { Request, Response } from 'express';
import { jobManager } from '../services/jobManager';

export const handleCancelJob = (req: Request, res: Response) => {
    const { jobId } = req.params;
    const success = jobManager.cancel(jobId);
    if (success) {
        res.status(200).json({ message: `Job ${jobId} cancelled successfully.` });
    } else {
        res.status(404).json({ error: `Job ${jobId} not found or already completed.` });
    }
};