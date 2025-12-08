/**
 * Orchestrator Service - Incremental Execution Engine
 * 
 * This service takes a TaskPlan and executes it step by step:
 * 1. Execute each step individually using PATCH-BASED editing (not full rewrites)
 * 2. Verify the result after each step with REFLECTION loops
 * 3. If errors occur, reflect and create a micro-plan to fix
 * 4. Report progress and allow user intervention
 * 5. Support rollback if needed
 * 6. Run as ASYNC job queue with stateful context
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import type { TaskPlan, TaskStep } from './taskPlannerModule';
import type { FileSystemOperation, AnalysisResult } from '../types';
import { DiffAgent, FilePatch } from './diffAgent';
import { ReflectionEngine, ReflectionContext } from './reflectionEngine';
import { agentStateManager, AgentContext } from './agentStateManager';
import apiKeyPool from './apiKeyPool';

// ============ Types ============

export interface StepResult {
  stepId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  changes?: FileSystemOperation[];
  error?: string;
  retryCount: number;
  executionTimeMs: number;
  verificationResult?: VerificationResult;
}

export interface VerificationResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
}

export interface ExecutionState {
  planId: string;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: StepResult[];
  status: 'planning' | 'executing' | 'paused' | 'completed' | 'failed' | 'awaiting_confirmation';
  startTime: number;
  elapsedTimeMs: number;
  estimatedRemainingMs: number;
}

export interface OrchestratorProgress {
  phase: 'step_start' | 'step_reading' | 'step_generating' | 'step_verifying' | 'step_complete' | 
         'reflection' | 'retry' | 'awaiting_user' | 'complete' | 'error';
  stepId: string;
  stepDescription: string;
  currentStep: number;
  totalSteps: number;
  message: string;
  changes?: FileSystemOperation[];
  requiresConfirmation?: boolean;
  state: ExecutionState;
}

export interface OrchestratorConfig {
  maxRetriesPerStep: number;
  pauseAfterEachStep: boolean;
  autoVerify: boolean;
  allowParallelSteps: boolean;
  timeoutPerStepMs: number;
  usePatchBasedEditing: boolean;   // NEW
  enableReflection: boolean;       // NEW  
  maxReflectionIterations: number; // NEW
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRetriesPerStep: 3,
  pauseAfterEachStep: false,
  autoVerify: true,
  allowParallelSteps: false,
  timeoutPerStepMs: 120000, // 2 minutes per step
  usePatchBasedEditing: true,  // NEW: Use DiffAgent instead of full rewrites
  enableReflection: true,      // NEW: Enable reflection loops
  maxReflectionIterations: 5,  // NEW: Max reflection passes
};

// ============ Orchestrator Service ============

export class OrchestratorService {
  private model: string;
  private config: OrchestratorConfig;
  private onProgress?: (progress: OrchestratorProgress) => void;
  private state: ExecutionState | null = null;
  private isPaused: boolean = false;
  private shouldCancel: boolean = false;
  
  // NEW: Integrated services
  private diffAgent: DiffAgent;
  private reflectionEngine: ReflectionEngine;
  private sessionId: string;
  private agentContext: AgentContext | null = null;

  constructor(
    model: string = 'gemini-2.5-flash',
    onProgress?: (progress: OrchestratorProgress) => void,
    config: Partial<OrchestratorConfig> = {}
  ) {
    this.model = model;
    this.onProgress = onProgress;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // NEW: Initialize integrated services
    this.diffAgent = new DiffAgent(model, (msg) => onProgress?.({
      phase: 'step_generating',
      stepId: '',
      stepDescription: '',
      currentStep: 0,
      totalSteps: 0,
      message: msg,
      state: this.state!,
    }));
    
    this.reflectionEngine = new ReflectionEngine(model, (msg) => onProgress?.({
      phase: 'reflection',
      stepId: '',
      stepDescription: '',
      currentStep: 0,
      totalSteps: 0,
      message: msg,
      state: this.state!,
    }));
    
    this.sessionId = `session-${Date.now()}`;
  }

  /**
   * Execute a complete task plan
   */
  async executePlan(
    plan: TaskPlan,
    files: { filePath: string; content: string }[],
    diagnostics: string[] = []
  ): Promise<AnalysisResult> {
    // Initialize state
    this.state = {
      planId: plan.id,
      currentStepIndex: 0,
      totalSteps: plan.steps.length,
      stepResults: plan.steps.map(step => ({
        stepId: step.id,
        status: 'pending',
        retryCount: 0,
        executionTimeMs: 0,
      })),
      status: 'executing',
      startTime: Date.now(),
      elapsedTimeMs: 0,
      estimatedRemainingMs: plan.estimated_effort_seconds * 1000,
    };

    const allChanges: FileSystemOperation[] = [];
    const reasoningParts: string[] = [plan.reasoning_summary];
    
    // Create a mutable copy of files that gets updated after each step
    let currentFiles = [...files];

    // Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      if (this.shouldCancel) {
        this.state.status = 'failed';
        break;
      }

      while (this.isPaused) {
        await this.sleep(100);
      }

      const step = plan.steps[i];
      this.state.currentStepIndex = i;
      
      this.reportProgress({
        phase: 'step_start',
        stepId: step.id,
        stepDescription: step.description,
        currentStep: i + 1,
        totalSteps: plan.steps.length,
        message: `Starting step ${i + 1}/${plan.steps.length}: ${step.description}`,
      });

      // Check dependencies
      if (step.dependencies && step.dependencies.length > 0) {
        const unmetDeps = step.dependencies.filter(depId => {
          const depResult = this.state!.stepResults.find(r => r.stepId === depId);
          return !depResult || depResult.status !== 'completed';
        });

        if (unmetDeps.length > 0) {
          this.state.stepResults[i].status = 'skipped';
          this.state.stepResults[i].error = `Dependencies not met: ${unmetDeps.join(', ')}`;
          continue;
        }
      }

      // Execute the step with retries
      const stepResult = await this.executeStepWithRetry(
        step,
        currentFiles,
        diagnostics,
        plan
      );

      this.state.stepResults[i] = stepResult;

      if (stepResult.status === 'completed' && stepResult.changes) {
        allChanges.push(...stepResult.changes);
        reasoningParts.push(`Step ${i + 1}: ${step.description} - Completed`);

        // Update the file state for subsequent steps
        currentFiles = this.applyChangesToFiles(currentFiles, stepResult.changes);
        
        this.reportProgress({
          phase: 'step_complete',
          stepId: step.id,
          stepDescription: step.description,
          currentStep: i + 1,
          totalSteps: plan.steps.length,
          message: `Completed step ${i + 1}: ${stepResult.changes.length} change(s)`,
          changes: stepResult.changes,
        });
      } else if (stepResult.status === 'failed') {
        reasoningParts.push(`Step ${i + 1}: ${step.description} - Failed: ${stepResult.error}`);
        
        // For critical failures, we might want to stop
        if (step.actionType !== 'inspect') {
          this.reportProgress({
            phase: 'error',
            stepId: step.id,
            stepDescription: step.description,
            currentStep: i + 1,
            totalSteps: plan.steps.length,
            message: `Step ${i + 1} failed: ${stepResult.error}`,
          });
        }
      }

      // Update timing estimates
      this.updateTimingEstimates(i, plan.steps.length);
    }

    this.state.status = 'completed';
    this.state.elapsedTimeMs = Date.now() - this.state.startTime;

    this.reportProgress({
      phase: 'complete',
      stepId: 'final',
      stepDescription: 'Execution complete',
      currentStep: plan.steps.length,
      totalSteps: plan.steps.length,
      message: `Completed ${allChanges.length} change(s) across ${plan.steps.length} steps`,
      changes: allChanges,
    });

    return {
      reasoning: reasoningParts.join('\n\n'),
      changes: allChanges,
    };
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetry(
    step: TaskStep,
    files: { filePath: string; content: string }[],
    diagnostics: string[],
    plan: TaskPlan
  ): Promise<StepResult> {
    const startTime = Date.now();
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetriesPerStep; attempt++) {
      try {
        this.state!.stepResults.find(r => r.stepId === step.id)!.status = 'in_progress';
        this.state!.stepResults.find(r => r.stepId === step.id)!.retryCount = attempt;

        if (attempt > 0) {
          this.reportProgress({
            phase: 'retry',
            stepId: step.id,
            stepDescription: step.description,
            currentStep: this.state!.currentStepIndex + 1,
            totalSteps: this.state!.totalSteps,
            message: `Retry attempt ${attempt}/${this.config.maxRetriesPerStep}`,
          });
        }

        // Execute the step
        const changes = await this.executeStep(step, files, diagnostics, lastError);

        // Verify if configured
        let verification: VerificationResult | undefined;
        if (this.config.autoVerify && changes.length > 0) {
          this.reportProgress({
            phase: 'step_verifying',
            stepId: step.id,
            stepDescription: step.description,
            currentStep: this.state!.currentStepIndex + 1,
            totalSteps: this.state!.totalSteps,
            message: 'Verifying changes...',
          });

          verification = await this.verifyChanges(step, changes, files);
          
          if (!verification.passed) {
            // Reflect and retry
            this.reportProgress({
              phase: 'reflection',
              stepId: step.id,
              stepDescription: step.description,
              currentStep: this.state!.currentStepIndex + 1,
              totalSteps: this.state!.totalSteps,
              message: `Issues detected: ${verification.issues.join(', ')}. Reflecting...`,
            });

            lastError = verification.issues.join('; ');
            continue; // Retry with reflection
          }
        }

        return {
          stepId: step.id,
          status: 'completed',
          changes,
          retryCount: attempt,
          executionTimeMs: Date.now() - startTime,
          verificationResult: verification,
        };

      } catch (error: any) {
        lastError = error.message || String(error);
        console.error(`[Orchestrator] Step ${step.id} attempt ${attempt} failed:`, error);
        
        if (attempt === this.config.maxRetriesPerStep) {
          return {
            stepId: step.id,
            status: 'failed',
            error: lastError,
            retryCount: attempt,
            executionTimeMs: Date.now() - startTime,
          };
        }

        // Wait before retry with exponential backoff
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    return {
      stepId: step.id,
      status: 'failed',
      error: lastError || 'Unknown error',
      retryCount: this.config.maxRetriesPerStep,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a single step - uses PATCH-BASED editing (not full rewrites)
   */
  private async executeStep(
    step: TaskStep,
    files: { filePath: string; content: string }[],
    diagnostics: string[],
    previousError?: string
  ): Promise<FileSystemOperation[]> {
    // Find the target file
    const targetFile = files.find(f => 
      f.filePath === step.filePath || f.filePath.endsWith(step.filePath)
    );

    this.reportProgress({
      phase: 'step_reading',
      stepId: step.id,
      stepDescription: step.description,
      currentStep: this.state!.currentStepIndex + 1,
      totalSteps: this.state!.totalSteps,
      message: `Reading ${step.filePath}...`,
    });

    // For inspect steps, we don't generate changes
    if (step.actionType === 'inspect') {
      return [];
    }

    // For delete steps
    if (step.actionType === 'delete') {
      return [{
        type: 'delete',
        filePath: step.filePath,
        explanation: step.description,
      }];
    }

    // Track LLM call
    if (this.agentContext) {
      agentStateManager.trackLLMCall(this.sessionId);
    }

    // NEW: Use patch-based editing if enabled
    if (this.config.usePatchBasedEditing && targetFile) {
      return await this.executeStepWithPatch(step, targetFile, files, diagnostics, previousError);
    }

    // Fallback to full file rewrite (legacy mode)
    return await this.executeStepLegacy(step, targetFile, files, diagnostics, previousError);
  }

  /**
   * NEW: Execute step using patch-based editing (Cursor-like)
   */
  private async executeStepWithPatch(
    step: TaskStep,
    targetFile: { filePath: string; content: string },
    allFiles: { filePath: string; content: string }[],
    diagnostics: string[],
    previousError?: string
  ): Promise<FileSystemOperation[]> {
    this.reportProgress({
      phase: 'step_generating',
      stepId: step.id,
      stepDescription: step.description,
      currentStep: this.state!.currentStepIndex + 1,
      totalSteps: this.state!.totalSteps,
      message: `Generating patch for ${step.filePath}...`,
    });

    // Build change description with context
    let changeDescription = step.description;
    if (previousError) {
      changeDescription += `\n\nPREVIOUS ERROR TO FIX: ${previousError}`;
    }
    if (diagnostics.length > 0) {
      changeDescription += '\n\nDIAGNOSTICS:\n' + diagnostics.join('\n');
    }

    // Generate patch using DiffAgent
    const patch = await this.diffAgent.generatePatch(
      step.filePath,
      targetFile.content,
      changeDescription,
      step.lineHints,
      step.codeReferences
    );

    // Verify patch can be applied
    const verification = this.diffAgent.verifyPatch(patch, targetFile.content);
    
    if (!verification.valid) {
      console.warn(`[Orchestrator] Patch verification issues:`, verification.issues);
      // Try to apply anyway with fuzzy matching
    }

    // Apply patch to get new content
    const applyResult = this.diffAgent.applyPatch(patch, targetFile.content);
    
    if (!applyResult.success) {
      throw new Error(`Patch application failed: ${applyResult.errors.join(', ')}`);
    }

    // NEW: Run reflection if enabled
    if (this.config.enableReflection) {
      const reflectionResult = await this.runReflection(
        step,
        targetFile.content,
        applyResult.newContent,
        patch,
        allFiles
      );

      if (!reflectionResult.passed && reflectionResult.revisedPatch) {
        // Apply revised patch
        const revisedApply = this.diffAgent.applyPatch(reflectionResult.revisedPatch, targetFile.content);
        if (revisedApply.success) {
          return [{
            type: step.actionType === 'create' ? 'create' : 'modify',
            filePath: step.filePath,
            content: revisedApply.newContent,
            explanation: `${step.description} (auto-fixed after reflection)`,
          }];
        }
      } else if (!reflectionResult.passed) {
        // Reflection failed but no fix available
        throw new Error(`Reflection failed: ${reflectionResult.issues.map(i => i.message).join('; ')}`);
      }
    }

    // Store patch for potential rollback
    if (this.agentContext) {
      agentStateManager.updateFileState(
        this.sessionId, 
        step.filePath, 
        applyResult.newContent, 
        { ...patch, timestamp: Date.now() } as any
      );
    }

    return [{
      type: step.actionType === 'create' ? 'create' : 'modify',
      filePath: step.filePath,
      content: applyResult.newContent,
      explanation: step.description,
    }];
  }

  /**
   * NEW: Run reflection on generated changes
   */
  private async runReflection(
    step: TaskStep,
    originalContent: string,
    patchedContent: string,
    patch: FilePatch,
    allFiles: { filePath: string; content: string }[]
  ) {
    this.reportProgress({
      phase: 'reflection',
      stepId: step.id,
      stepDescription: step.description,
      currentStep: this.state!.currentStepIndex + 1,
      totalSteps: this.state!.totalSteps,
      message: `Running reflection checks on ${step.filePath}...`,
    });

    const context: ReflectionContext = {
      originalGoal: step.description,
      originalFile: originalContent,
      patchedFile: patchedContent,
      patch,
      filePath: step.filePath,
      allFiles: new Map(allFiles.map(f => [f.filePath, f.content])),
      allPatches: [patch],
      projectType: this.detectProjectType(step.filePath),
    };

    return await this.reflectionEngine.reflectAndFix(context, (iteration, issues) => {
      this.reportProgress({
        phase: 'reflection',
        stepId: step.id,
        stepDescription: step.description,
        currentStep: this.state!.currentStepIndex + 1,
        totalSteps: this.state!.totalSteps,
        message: `Reflection iteration ${iteration}: fixing ${issues.length} issues`,
      });
    });
  }

  /**
   * Detect project type for reflection context
   */
  private detectProjectType(filePath: string): 'typescript' | 'javascript' | 'python' | 'java' | 'other' {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.java')) return 'java';
    return 'other';
  }

  /**
   * Legacy: Execute step with full file rewrite
   */
  private async executeStepLegacy(
    step: TaskStep,
    targetFile: { filePath: string; content: string } | undefined,
    files: { filePath: string; content: string }[],
    diagnostics: string[],
    previousError?: string
  ): Promise<FileSystemOperation[]> {
    const client = this.getClient();

    // Build context for this specific step
    const lineContext = step.lineHints && targetFile
      ? this.extractLineContext(targetFile.content, step.lineHints)
      : '';

    const relatedFilesContext = files
      .filter(f => step.codeReferences?.some(ref => f.content.includes(ref)))
      .slice(0, 3)
      .map(f => `\n--- Related: ${f.filePath} ---\n${f.content.slice(0, 2000)}`)
      .join('\n');

    const systemPrompt = `You are a precise code editor. Apply ONLY the specific change described.

CRITICAL RULES:
1. Make MINIMAL changes to achieve the goal
2. Do NOT refactor or "improve" unrelated code
3. Preserve all existing functionality
4. Output COMPLETE file content (no placeholders)
5. Match the existing code style exactly
${previousError ? `\n6. PREVIOUS ATTEMPT FAILED: ${previousError}\n   Fix the issue in this attempt.` : ''}

Return JSON:
{
  "changes": [
    {
      "type": "modify|create",
      "filePath": "${step.filePath}",
      "content": "COMPLETE file content",
      "explanation": "What was changed and why"
    }
  ]
}`;

    const userPrompt = `
TASK: ${step.description}
ACTION: ${step.actionType}
FILE: ${step.filePath}
${step.codeReferences ? `SYMBOLS TO MODIFY: ${step.codeReferences.join(', ')}` : ''}

${targetFile ? `
CURRENT FILE CONTENT:
\`\`\`
${targetFile.content}
\`\`\`
` : 'File does not exist (create new)'}

${lineContext ? `
FOCUS AREA (lines ${step.lineHints?.join(', ')}):
\`\`\`
${lineContext}
\`\`\`
` : ''}

${diagnostics.length > 0 ? `
ERRORS TO FIX:
${diagnostics.join('\n')}
` : ''}

${relatedFilesContext}

Apply the change described above. Return complete, working code.`;

    this.reportProgress({
      phase: 'step_generating',
      stepId: step.id,
      stepDescription: step.description,
      currentStep: this.state!.currentStepIndex + 1,
      totalSteps: this.state!.totalSteps,
      message: `Generating changes for ${step.filePath}...`,
    });

    const response = await client.models.generateContent({
      model: this.model,
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 16000,
      },
    });

    const text = response.text || '{}';
    let parsed: { changes: FileSystemOperation[] };
    
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse LLM response as JSON');
      }
    }

    return parsed.changes || [];
  }

  /**
   * Verify the changes made in a step
   */
  private async verifyChanges(
    step: TaskStep,
    changes: FileSystemOperation[],
    originalFiles: { filePath: string; content: string }[]
  ): Promise<VerificationResult> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    for (const change of changes) {
      if (change.type !== 'delete' && change.content) {
        // Basic syntax validation
        const syntaxIssues = this.validateSyntax(change.content, change.filePath);
        issues.push(...syntaxIssues);

        // Check for incomplete code patterns
        if (change.content.includes('// TODO') || change.content.includes('...')) {
          issues.push(`Incomplete code detected in ${change.filePath}`);
        }

        // Check for proper imports
        if (!this.hasRequiredImports(change.content, originalFiles)) {
          suggestions.push(`Consider checking imports in ${change.filePath}`);
        }
      }
    }

    return {
      passed: issues.length === 0,
      issues,
      suggestions,
    };
  }

  /**
   * Apply changes to the in-memory file state
   */
  private applyChangesToFiles(
    files: { filePath: string; content: string }[],
    changes: FileSystemOperation[]
  ): { filePath: string; content: string }[] {
    const result = [...files];

    for (const change of changes) {
      const idx = result.findIndex(f => 
        f.filePath === change.filePath || f.filePath.endsWith(change.filePath)
      );

      if (change.type === 'delete') {
        if (idx !== -1) {
          result.splice(idx, 1);
        }
      } else if (change.type === 'create') {
        if (idx === -1) {
          result.push({ filePath: change.filePath, content: change.content || '' });
        } else {
          result[idx].content = change.content || '';
        }
      } else if (change.type === 'modify') {
        if (idx !== -1) {
          result[idx].content = change.content || result[idx].content;
        }
      }
    }

    return result;
  }

  // ============ Helper Methods ============

  private reportProgress(partial: Omit<OrchestratorProgress, 'state'>) {
    if (this.onProgress && this.state) {
      this.onProgress({
        ...partial,
        state: { ...this.state },
      });
    }
  }

  private getClient(): GoogleGenAI {
    const apiKey = process.env.AGENT_API_KEY;
    if (!apiKey) {
      throw new Error('AGENT_API_KEY not set');
    }
    return new GoogleGenAI({ apiKey });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private extractLineContext(content: string, lineHints: number[]): string {
    const lines = content.split('\n');
    const minLine = Math.min(...lineHints);
    const maxLine = Math.max(...lineHints);
    const contextStart = Math.max(0, minLine - 5);
    const contextEnd = Math.min(lines.length, maxLine + 5);
    return lines.slice(contextStart, contextEnd).join('\n');
  }

  private validateSyntax(content: string, filePath: string): string[] {
    const issues: string[] = [];
    const ext = filePath.split('.').pop()?.toLowerCase();

    if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        issues.push('Unmatched braces');
      }

      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        issues.push('Unmatched parentheses');
      }
    }

    return issues;
  }

  private hasRequiredImports(content: string, files: { filePath: string; content: string }[]): boolean {
    // Basic check - could be enhanced with actual import analysis
    const importStatements = content.match(/import\s+.*\s+from\s+['"].*['"]/g) || [];
    return importStatements.length > 0 || !content.includes('from ');
  }

  private updateTimingEstimates(completedSteps: number, totalSteps: number) {
    if (!this.state) return;
    
    const elapsed = Date.now() - this.state.startTime;
    const avgTimePerStep = elapsed / (completedSteps + 1);
    const remainingSteps = totalSteps - completedSteps - 1;
    
    this.state.elapsedTimeMs = elapsed;
    this.state.estimatedRemainingMs = avgTimePerStep * remainingSteps;
  }

  // ============ Public Control Methods ============

  pause() {
    this.isPaused = true;
    if (this.state) {
      this.state.status = 'paused';
    }
  }

  resume() {
    this.isPaused = false;
    if (this.state) {
      this.state.status = 'executing';
    }
  }

  cancel() {
    this.shouldCancel = true;
  }

  getState(): ExecutionState | null {
    return this.state;
  }
}

export default OrchestratorService;
