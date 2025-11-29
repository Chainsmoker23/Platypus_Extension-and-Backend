
interface Job {
    id: string;
    controller: AbortController;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    createdAt: number;
}

class JobManager {
    private jobs = new Map<string, Job>();
    private readonly JOB_TTL = 1000 * 60 * 30; // 30 minutes

    constructor() {
        setInterval(() => this.cleanup(), this.JOB_TTL / 2);
    }

    create(jobId: string): AbortSignal {
        if (this.jobs.has(jobId)) {
            // Cancel previous job if it exists and is running
            this.cancel(jobId);
        }

        const controller = new AbortController();
        const job: Job = {
            id: jobId,
            controller,
            status: 'running',
            createdAt: Date.now(),
        };
        this.jobs.set(jobId, job);
        console.log(`[JobManager] Created and started job: ${jobId}`);
        return controller.signal;
    }

    cancel(jobId: string): boolean {
        const job = this.jobs.get(jobId);
        if (job && job.status === 'running') {
            job.controller.abort();
            job.status = 'cancelled';
            console.log(`[JobManager] Cancelled job: ${jobId}`);
            return true;
        }
        console.warn(`[JobManager] Could not cancel job: ${jobId}. Not found or not running.`);
        return false;
    }

    complete(jobId: string) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = 'completed';
        }
    }

    fail(jobId: string) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = 'failed';
        }
    }

    private cleanup() {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [jobId, job] of this.jobs.entries()) {
            if (now - job.createdAt > this.JOB_TTL) {
                this.jobs.delete(jobId);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.log(`[JobManager] Cleaned up ${cleanedCount} old jobs.`);
        }
    }
}

export const jobManager = new JobManager();