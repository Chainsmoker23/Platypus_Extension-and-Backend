/**
 * Enhanced Progress Tracking System
 * Provides detailed, structured progress updates for long-running operations
 */

export enum ProgressPhase {
    INITIALIZING = 'initializing',
    ANALYZING = 'analyzing',
    SEARCHING = 'searching',
    GENERATING = 'generating',
    VALIDATING = 'validating',
    COMPLETING = 'completing',
    ERROR = 'error'
}

export interface ProgressUpdate {
    phase: ProgressPhase;
    message: string;
    percentage?: number;
    details?: {
        current?: number;
        total?: number;
        estimatedTimeRemaining?: number;
        subPhase?: string;
    };
    metadata?: Record<string, any>;
}

export class ProgressTracker {
    private currentPhase: ProgressPhase = ProgressPhase.INITIALIZING;
    private startTime: number;
    private phaseStartTime: number;
    private onUpdate?: (update: ProgressUpdate) => void;
    private updates: ProgressUpdate[] = [];
    private maxUpdates: number = 100;

    constructor(onUpdate?: (update: ProgressUpdate) => void) {
        this.onUpdate = onUpdate;
        this.startTime = Date.now();
        this.phaseStartTime = Date.now();
    }

    /**
     * Update progress with structured information
     */
    update(phase: ProgressPhase, message: string, options?: {
        percentage?: number;
        current?: number;
        total?: number;
        subPhase?: string;
        metadata?: Record<string, any>;
    }): void {
        // Calculate estimated time remaining if we have current/total
        let estimatedTimeRemaining: number | undefined;
        if (options?.current && options?.total && options.current > 0) {
            const elapsed = Date.now() - this.phaseStartTime;
            const perItem = elapsed / options.current;
            const remaining = options.total - options.current;
            estimatedTimeRemaining = Math.round(perItem * remaining);
        }

        const update: ProgressUpdate = {
            phase,
            message,
            percentage: options?.percentage,
            details: {
                current: options?.current,
                total: options?.total,
                estimatedTimeRemaining,
                subPhase: options?.subPhase
            },
            metadata: options?.metadata
        };

        // Track phase changes
        if (phase !== this.currentPhase) {
            this.currentPhase = phase;
            this.phaseStartTime = Date.now();
        }

        // Store update
        if (this.updates.length >= this.maxUpdates) {
            this.updates.shift();
        }
        this.updates.push(update);

        // Notify listener
        this.onUpdate?.(update);
    }

    /**
     * Quick progress update helpers
     */
    initializing(message: string, metadata?: Record<string, any>): void {
        this.update(ProgressPhase.INITIALIZING, message, { metadata });
    }

    analyzing(message: string, current?: number, total?: number, metadata?: Record<string, any>): void {
        const percentage = current && total ? Math.round((current / total) * 100) : undefined;
        this.update(ProgressPhase.ANALYZING, message, { 
            percentage, 
            current, 
            total, 
            metadata 
        });
    }

    searching(message: string, metadata?: Record<string, any>): void {
        this.update(ProgressPhase.SEARCHING, message, { metadata });
    }

    generating(message: string, percentage?: number, metadata?: Record<string, any>): void {
        this.update(ProgressPhase.GENERATING, message, { percentage, metadata });
    }

    validating(message: string, current?: number, total?: number, metadata?: Record<string, any>): void {
        const percentage = current && total ? Math.round((current / total) * 100) : undefined;
        this.update(ProgressPhase.VALIDATING, message, {
            percentage,
            current,
            total,
            metadata
        });
    }

    completing(message: string, metadata?: Record<string, any>): void {
        this.update(ProgressPhase.COMPLETING, message, { metadata });
    }

    error(message: string, metadata?: Record<string, any>): void {
        this.update(ProgressPhase.ERROR, message, { metadata });
    }

    /**
     * Get current progress status
     */
    getStatus(): {
        currentPhase: ProgressPhase;
        totalDuration: number;
        phaseDuration: number;
        latestUpdate?: ProgressUpdate;
    } {
        return {
            currentPhase: this.currentPhase,
            totalDuration: Date.now() - this.startTime,
            phaseDuration: Date.now() - this.phaseStartTime,
            latestUpdate: this.updates[this.updates.length - 1]
        };
    }

    /**
     * Get all updates
     */
    getUpdates(): ProgressUpdate[] {
        return [...this.updates];
    }

    /**
     * Format update for NDJSON streaming
     */
    static formatForStream(update: ProgressUpdate): string {
        return JSON.stringify({
            type: 'progress',
            phase: update.phase,
            message: update.message,
            percentage: update.percentage,
            details: update.details,
            metadata: update.metadata,
            timestamp: new Date().toISOString()
        }) + '\n';
    }

    /**
     * Create a progress writer for streaming responses
     */
    static createStreamWriter(writeFunc: (data: string) => void): (update: ProgressUpdate) => void {
        return (update: ProgressUpdate) => {
            writeFunc(ProgressTracker.formatForStream(update));
        };
    }
}
