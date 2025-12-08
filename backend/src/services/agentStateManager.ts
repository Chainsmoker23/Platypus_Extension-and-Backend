/**
 * Agent State Manager - Asynchronous Agent Loops
 * 
 * This implements Cursor-like background processing:
 * 1. Async job queue for long-running tasks
 * 2. Stateful agent context that persists across iterations
 * 3. Internal timers and progress tracking
 * 4. Support for 100+ iterative LLM calls
 * 5. Background worker pattern
 */

import { EventEmitter } from 'events';

// ============ Types ============

export interface AgentJob {
  id: string;
  type: 'plan' | 'execute' | 'reflect' | 'verify' | 'patch' | 'rollback';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  priority: number;
  payload: any;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  parentJobId?: string;
  childJobIds: string[];
}

export interface AgentContext {
  sessionId: string;
  workspaceId?: string;
  
  // Current state
  currentPlan?: any;
  currentStep: number;
  totalSteps: number;
  
  // File state (updated after each operation)
  fileStates: Map<string, {
    originalContent: string;
    currentContent: string;
    patches: Patch[];
    version: number;
  }>;
  
  // Conversation context
  conversationHistory: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;
  
  // Statistics
  llmCallCount: number;
  tokensUsed: number;
  startTime: number;
  
  // Error recovery
  lastError?: string;
  errorHistory: Array<{
    error: string;
    timestamp: number;
    recovered: boolean;
  }>;
}

export interface Patch {
  id: string;
  filePath: string;
  hunks: PatchHunk[];
  applied: boolean;
  verified: boolean;
  timestamp: number;
}

export interface PatchHunk {
  startLine: number;
  endLine: number;
  oldContent: string;
  newContent: string;
  context: string; // Surrounding lines for matching
}

export interface AgentEvent {
  type: 'job_started' | 'job_completed' | 'job_failed' | 'progress' | 'state_changed' | 
        'llm_call' | 'patch_applied' | 'reflection' | 'verification';
  jobId?: string;
  data: any;
  timestamp: number;
}

// ============ Agent State Manager ============

export class AgentStateManager extends EventEmitter {
  private contexts: Map<string, AgentContext> = new Map();
  private jobQueue: AgentJob[] = [];
  private runningJobs: Map<string, AgentJob> = new Map();
  private maxConcurrentJobs: number = 3;
  private isProcessing: boolean = false;
  private processingInterval?: NodeJS.Timeout;
  
  // Job handlers
  private jobHandlers: Map<string, (job: AgentJob, context: AgentContext) => Promise<any>> = new Map();

  constructor(maxConcurrentJobs: number = 3) {
    super();
    this.maxConcurrentJobs = maxConcurrentJobs;
  }

  // ============ Context Management ============

  createContext(sessionId: string, workspaceId?: string): AgentContext {
    const context: AgentContext = {
      sessionId,
      workspaceId,
      currentStep: 0,
      totalSteps: 0,
      fileStates: new Map(),
      conversationHistory: [],
      llmCallCount: 0,
      tokensUsed: 0,
      startTime: Date.now(),
      errorHistory: [],
    };
    
    this.contexts.set(sessionId, context);
    this.emitEvent('state_changed', { action: 'context_created', sessionId });
    
    return context;
  }

  getContext(sessionId: string): AgentContext | undefined {
    return this.contexts.get(sessionId);
  }

  updateContext(sessionId: string, updates: Partial<AgentContext>): AgentContext | undefined {
    const context = this.contexts.get(sessionId);
    if (!context) return undefined;
    
    Object.assign(context, updates);
    this.emitEvent('state_changed', { action: 'context_updated', sessionId, updates });
    
    return context;
  }

  // Update file state after a patch
  updateFileState(
    sessionId: string, 
    filePath: string, 
    content: string,
    patch?: Patch
  ): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    
    const existing = context.fileStates.get(filePath);
    
    if (existing) {
      existing.currentContent = content;
      existing.version++;
      if (patch) {
        existing.patches.push(patch);
      }
    } else {
      context.fileStates.set(filePath, {
        originalContent: content,
        currentContent: content,
        patches: patch ? [patch] : [],
        version: 1,
      });
    }
  }

  // Get current file content (after all patches applied)
  getFileContent(sessionId: string, filePath: string): string | undefined {
    const context = this.contexts.get(sessionId);
    if (!context) return undefined;
    
    const state = context.fileStates.get(filePath);
    return state?.currentContent;
  }

  // Add to conversation history
  addToConversation(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    
    context.conversationHistory.push({
      role,
      content,
      timestamp: Date.now(),
    });
  }

  // Track LLM call
  trackLLMCall(sessionId: string, tokensUsed: number = 0): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    
    context.llmCallCount++;
    context.tokensUsed += tokensUsed;
    
    this.emitEvent('llm_call', { 
      sessionId, 
      callNumber: context.llmCallCount,
      totalTokens: context.tokensUsed
    });
  }

  // ============ Job Queue Management ============

  registerJobHandler(
    jobType: string, 
    handler: (job: AgentJob, context: AgentContext) => Promise<any>
  ): void {
    this.jobHandlers.set(jobType, handler);
  }

  enqueueJob(
    sessionId: string,
    type: AgentJob['type'],
    payload: any,
    options: {
      priority?: number;
      maxRetries?: number;
      parentJobId?: string;
    } = {}
  ): string {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: AgentJob = {
      id: jobId,
      type,
      status: 'queued',
      priority: options.priority || 5,
      payload: { ...payload, sessionId },
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: options.maxRetries || 3,
      parentJobId: options.parentJobId,
      childJobIds: [],
    };
    
    // Add to parent's children list
    if (options.parentJobId) {
      const parentJob = this.findJob(options.parentJobId);
      if (parentJob) {
        parentJob.childJobIds.push(jobId);
      }
    }
    
    // Insert by priority (higher priority = earlier in queue)
    const insertIdx = this.jobQueue.findIndex(j => j.priority < job.priority);
    if (insertIdx === -1) {
      this.jobQueue.push(job);
    } else {
      this.jobQueue.splice(insertIdx, 0, job);
    }
    
    this.emitEvent('job_started', { jobId, type, status: 'queued' });
    
    // Start processing if not already
    this.startProcessing();
    
    return jobId;
  }

  private findJob(jobId: string): AgentJob | undefined {
    return this.jobQueue.find(j => j.id === jobId) || 
           this.runningJobs.get(jobId);
  }

  // ============ Background Processing ============

  private startProcessing(): void {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processNextJobs();
  }

  private async processNextJobs(): Promise<void> {
    while (this.isProcessing && this.jobQueue.length > 0) {
      // Check how many jobs we can start
      const availableSlots = this.maxConcurrentJobs - this.runningJobs.size;
      
      if (availableSlots <= 0) {
        // Wait for a slot to free up
        await this.sleep(100);
        continue;
      }
      
      // Get next jobs to run
      const jobsToRun = this.jobQueue.splice(0, availableSlots);
      
      // Start all jobs concurrently
      const promises = jobsToRun.map(job => this.executeJob(job));
      
      // Wait for at least one to complete before checking queue again
      await Promise.race(promises);
    }
    
    // Wait for all running jobs to complete
    if (this.runningJobs.size > 0) {
      await Promise.all(Array.from(this.runningJobs.values()).map(job => 
        this.waitForJob(job.id)
      ));
    }
    
    this.isProcessing = false;
  }

  private async executeJob(job: AgentJob): Promise<void> {
    const sessionId = job.payload.sessionId;
    const context = this.contexts.get(sessionId);
    
    if (!context) {
      job.status = 'failed';
      job.error = 'Session context not found';
      return;
    }
    
    job.status = 'running';
    job.startedAt = Date.now();
    this.runningJobs.set(job.id, job);
    
    this.emitEvent('job_started', { jobId: job.id, type: job.type });
    
    try {
      const handler = this.jobHandlers.get(job.type);
      
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }
      
      job.result = await handler(job, context);
      job.status = 'completed';
      job.completedAt = Date.now();
      
      this.emitEvent('job_completed', { 
        jobId: job.id, 
        type: job.type,
        duration: job.completedAt - (job.startedAt || job.createdAt),
        result: job.result
      });
      
    } catch (error: any) {
      job.retryCount++;
      
      if (job.retryCount <= job.maxRetries) {
        // Retry with exponential backoff
        job.status = 'queued';
        await this.sleep(Math.pow(2, job.retryCount) * 1000);
        this.jobQueue.unshift(job); // Add to front of queue for retry
        
        this.emitEvent('progress', { 
          jobId: job.id, 
          message: `Retrying (${job.retryCount}/${job.maxRetries})`,
          error: error.message
        });
      } else {
        job.status = 'failed';
        job.error = error.message;
        job.completedAt = Date.now();
        
        context.errorHistory.push({
          error: error.message,
          timestamp: Date.now(),
          recovered: false,
        });
        
        this.emitEvent('job_failed', { 
          jobId: job.id, 
          type: job.type,
          error: error.message,
          retries: job.retryCount
        });
      }
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private waitForJob(jobId: string): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        const job = this.findJob(jobId);
        if (!job || job.status === 'completed' || job.status === 'failed') {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // ============ Job Control ============

  pauseJob(jobId: string): boolean {
    const job = this.findJob(jobId);
    if (job && job.status === 'running') {
      job.status = 'paused';
      return true;
    }
    return false;
  }

  resumeJob(jobId: string): boolean {
    const job = this.findJob(jobId);
    if (job && job.status === 'paused') {
      job.status = 'queued';
      this.jobQueue.unshift(job);
      this.startProcessing();
      return true;
    }
    return false;
  }

  cancelJob(jobId: string): boolean {
    // Remove from queue
    const queueIdx = this.jobQueue.findIndex(j => j.id === jobId);
    if (queueIdx !== -1) {
      this.jobQueue[queueIdx].status = 'cancelled';
      this.jobQueue.splice(queueIdx, 1);
      return true;
    }
    
    // Mark running job as cancelled
    const runningJob = this.runningJobs.get(jobId);
    if (runningJob) {
      runningJob.status = 'cancelled';
      return true;
    }
    
    return false;
  }

  cancelAllJobs(sessionId: string): void {
    // Cancel queued jobs
    this.jobQueue = this.jobQueue.filter(j => {
      if (j.payload.sessionId === sessionId) {
        j.status = 'cancelled';
        return false;
      }
      return true;
    });
    
    // Cancel running jobs
    for (const [jobId, job] of this.runningJobs) {
      if (job.payload.sessionId === sessionId) {
        job.status = 'cancelled';
      }
    }
  }

  // ============ Statistics ============

  getJobStats(sessionId?: string): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    totalLLMCalls: number;
    totalTokens: number;
    elapsedTime: number;
  } {
    const context = sessionId ? this.contexts.get(sessionId) : undefined;
    
    const filterSession = (job: AgentJob) => 
      !sessionId || job.payload.sessionId === sessionId;
    
    return {
      queued: this.jobQueue.filter(filterSession).length,
      running: Array.from(this.runningJobs.values()).filter(filterSession).length,
      completed: 0, // Would need to track completed jobs
      failed: 0,
      totalLLMCalls: context?.llmCallCount || 0,
      totalTokens: context?.tokensUsed || 0,
      elapsedTime: context ? Date.now() - context.startTime : 0,
    };
  }

  // ============ Helpers ============

  private emitEvent(type: AgentEvent['type'], data: any): void {
    const event: AgentEvent = {
      type,
      data,
      timestamp: Date.now(),
    };
    this.emit('event', event);
    this.emit(type, data);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup
  destroy(): void {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.contexts.clear();
    this.jobQueue = [];
    this.runningJobs.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
export const agentStateManager = new AgentStateManager();
export default agentStateManager;
