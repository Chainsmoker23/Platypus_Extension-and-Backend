
import { Request, Response } from 'express';
import { jobManager } from '../services/jobManager';

export const handleCancelJob = (req: Request, res: Response) => {
    // FIX: Cast req to any to access params
    const { jobId } = (req as any).params;
    const success = jobManager.cancel(jobId);
    if (success) {
        // FIX: Cast res to any to access status
        (res as any).status(200).json({ message: `Job ${jobId} cancelled successfully.` });
    } else {
        // FIX: Cast res to any to access status
        (res as any).status(404).json({ error: `Job ${jobId} not found or already completed.` });
    }
};
