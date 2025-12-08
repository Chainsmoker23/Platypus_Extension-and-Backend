/**
 * Task Planner Module - The Intelligence Core
 * 
 * This module converts natural-language requests into structured, multi-step execution plans.
 * It acts as the "bridge" between user intent and actionable codebase operations.
 * 
 * Architecture:
 * 1. Intent Extractor - Understands what user really wants
 * 2. Context Analyzer - Finds all relevant files, functions, errors
 * 3. Task Synthesizer - Creates ordered execution plan
 * 4. Plan Serializer - Outputs machine-readable plan
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getContextForPrompt, searchCodebase } from './ragService';
import apiKeyPool from './apiKeyPool';

// ============ Types ============

export interface TaskStep {
  id: string;
  filePath: string;
  description: string;
  lineHints?: number[];
  codeReferences?: string[];
  actionType: 'modify' | 'create' | 'delete' | 'rename' | 'refactor' | 'inspect';
  priority: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
  dependencies?: string[]; // IDs of steps that must complete first
}

export interface TaskPlan {
  id: string;
  goal: string;
  reasoning_summary: string;
  steps: TaskStep[];
  dependencies: string[]; // Related files
  estimated_effort_seconds: number;
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  requires_verification: boolean;
  rollback_strategy?: string;
}

export interface IntentAnalysis {
  goal: string;
  taskType: 'fix_error' | 'add_feature' | 'refactor' | 'delete' | 'explain' | 'optimize' | 'test' | 'debug';
  constraints: string[];
  acceptanceCriteria: string[];
  assumptions: string[];
  affectedDomains: string[]; // e.g., ['authentication', 'database', 'UI']
}

export interface ContextAnalysis {
  relevantFiles: Array<{
    filePath: string;
    relevanceScore: number;
    reason: string;
    symbols: string[];
  }>;
  errorLocations: Array<{
    filePath: string;
    line?: number;
    errorMessage: string;
    errorType: string;
  }>;
  dependencyGraph: Map<string, string[]>; // file -> files it imports
  impactedModules: string[];
}

export interface PlannerProgress {
  phase: 'intent' | 'context' | 'synthesis' | 'serialization' | 'complete';
  message: string;
  details?: any;
}

// ============ Task Planner Module ============

export class TaskPlannerModule {
  private model: string;
  private onProgress?: (progress: PlannerProgress) => void;
  
  constructor(model: string = 'gemini-2.5-flash', onProgress?: (progress: PlannerProgress) => void) {
    this.model = model;
    this.onProgress = onProgress;
  }

  /**
   * Main entry point - Create a complete task plan from user request
   */
  async createPlan(
    userRequest: string,
    files: { filePath: string; content: string }[],
    diagnostics: string[] = [],
    workspaceId?: string,
    selectedFiles: string[] = []
  ): Promise<TaskPlan> {
    const planId = `plan-${Date.now()}`;
    
    // Phase 1: Extract Intent
    this.onProgress?.({ phase: 'intent', message: 'Understanding your request...' });
    const intent = await this.extractIntent(userRequest, diagnostics);
    
    // Phase 2: Analyze Context
    this.onProgress?.({ phase: 'context', message: 'Analyzing codebase context...' });
    const context = await this.analyzeContext(
      intent,
      files,
      diagnostics,
      workspaceId,
      selectedFiles
    );
    
    // Phase 3: Synthesize Plan
    this.onProgress?.({ phase: 'synthesis', message: 'Creating execution plan...' });
    const steps = await this.synthesizePlan(intent, context, files);
    
    // Phase 4: Serialize Plan
    this.onProgress?.({ phase: 'serialization', message: 'Finalizing plan...' });
    const plan = this.serializePlan(planId, intent, context, steps);
    
    this.onProgress?.({ 
      phase: 'complete', 
      message: `Plan created with ${plan.steps.length} steps`,
      details: plan
    });
    
    return plan;
  }

  // ============ Phase 1: Intent Extractor ============

  private async extractIntent(
    userRequest: string,
    diagnostics: string[]
  ): Promise<IntentAnalysis> {
    const client = this.getClient();
    
    const systemPrompt = `You are an expert code analyst. Your job is to deeply understand what the user wants to accomplish.

CRITICAL: Extract the TRUE intent, not just surface-level understanding.
- "fix it" → Determine WHAT needs fixing from context/errors
- "make it better" → Identify SPECIFIC improvements needed  
- "it's broken" → Find the actual cause from diagnostics
- "add feature X" → Break down into concrete requirements

You must output valid JSON with this exact structure:
{
  "goal": "Clear, actionable description of what needs to be done",
  "taskType": "fix_error|add_feature|refactor|delete|explain|optimize|test|debug",
  "constraints": ["List of constraints to maintain"],
  "acceptanceCriteria": ["How to verify the task is complete"],
  "assumptions": ["What you're assuming about the request"],
  "affectedDomains": ["authentication", "database", "UI", etc.]
}`;

    const userPrompt = `
User Request: "${userRequest}"

${diagnostics.length > 0 ? `
Current Errors/Diagnostics:
${diagnostics.map((d, i) => `${i + 1}. ${d}`).join('\n')}
` : 'No current errors reported.'}

Analyze this request and extract the complete intent.`;

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 2000,
        },
      });

      const text = response.text || '{}';
      return JSON.parse(text) as IntentAnalysis;
    } catch (e) {
      console.error('[TaskPlanner] Intent extraction failed:', e);
      // Fallback intent
      return {
        goal: userRequest,
        taskType: diagnostics.length > 0 ? 'fix_error' : 'add_feature',
        constraints: [],
        acceptanceCriteria: ['Request is fulfilled'],
        assumptions: ['User wants changes applied to their codebase'],
        affectedDomains: [],
      };
    }
  }

  // ============ Phase 2: Context Analyzer ============

  private async analyzeContext(
    intent: IntentAnalysis,
    files: { filePath: string; content: string }[],
    diagnostics: string[],
    workspaceId?: string,
    selectedFiles: string[] = []
  ): Promise<ContextAnalysis> {
    const relevantFiles: ContextAnalysis['relevantFiles'] = [];
    const errorLocations: ContextAnalysis['errorLocations'] = [];
    const dependencyGraph = new Map<string, string[]>();
    
    // 1. Parse error locations from diagnostics
    for (const diag of diagnostics) {
      const match = diag.match(/(?:^|\s)([^\s]+\.[a-zA-Z]+)(?::(\d+))?/);
      if (match) {
        errorLocations.push({
          filePath: match[1],
          line: match[2] ? parseInt(match[2]) : undefined,
          errorMessage: diag,
          errorType: this.classifyError(diag),
        });
      }
    }
    
    // 2. Add selected files as high priority
    for (const filePath of selectedFiles) {
      relevantFiles.push({
        filePath,
        relevanceScore: 1.0,
        reason: 'User-selected file',
        symbols: this.extractSymbols(files.find(f => f.filePath === filePath)?.content || ''),
      });
    }
    
    // 3. Add files from error locations
    for (const errLoc of errorLocations) {
      if (!relevantFiles.some(f => f.filePath === errLoc.filePath)) {
        const file = files.find(f => f.filePath.endsWith(errLoc.filePath));
        if (file) {
          relevantFiles.push({
            filePath: file.filePath,
            relevanceScore: 0.95,
            reason: `Contains error: ${errLoc.errorType}`,
            symbols: this.extractSymbols(file.content),
          });
        }
      }
    }
    
    // 4. Use RAG to find semantically related files
    if (workspaceId) {
      try {
        const ragContext = await searchCodebase(workspaceId, intent.goal, 15);
        for (const result of ragContext.chunks) {
          if (!relevantFiles.some(f => f.filePath === result.chunk.filePath)) {
            relevantFiles.push({
              filePath: result.chunk.filePath,
              relevanceScore: result.score,
              reason: `Semantically related to: ${intent.goal.slice(0, 50)}`,
              symbols: [result.chunk.summary || result.chunk.type],
            });
          }
        }
      } catch (e) {
        console.warn('[TaskPlanner] RAG search failed:', e);
      }
    }
    
    // 5. Build dependency graph
    for (const file of files) {
      const imports = this.extractImports(file.content, file.filePath);
      if (imports.length > 0) {
        dependencyGraph.set(file.filePath, imports);
      }
    }
    
    // 6. Find all impacted modules (files that import the relevant files)
    const impactedModules = new Set<string>();
    for (const relevantFile of relevantFiles) {
      for (const [filePath, imports] of dependencyGraph) {
        if (imports.some(imp => relevantFile.filePath.includes(imp))) {
          impactedModules.add(filePath);
        }
      }
    }
    
    // Sort by relevance
    relevantFiles.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    return {
      relevantFiles: relevantFiles.slice(0, 20), // Limit to top 20
      errorLocations,
      dependencyGraph,
      impactedModules: Array.from(impactedModules),
    };
  }

  // ============ Phase 3: Task Synthesizer ============

  private async synthesizePlan(
    intent: IntentAnalysis,
    context: ContextAnalysis,
    files: { filePath: string; content: string }[]
  ): Promise<TaskStep[]> {
    const client = this.getClient();
    
    // Prepare file summaries for the LLM
    const fileSummaries = context.relevantFiles.map(rf => {
      const file = files.find(f => f.filePath === rf.filePath);
      const preview = file?.content.slice(0, 1000) || '';
      return `
File: ${rf.filePath}
Relevance: ${rf.relevanceScore.toFixed(2)} (${rf.reason})
Symbols: ${rf.symbols.join(', ')}
Preview:
\`\`\`
${preview}${preview.length >= 1000 ? '\n... (truncated)' : ''}
\`\`\``;
    }).join('\n\n');
    
    const errorInfo = context.errorLocations.length > 0
      ? `\nError Locations:\n${context.errorLocations.map(e => 
          `- ${e.filePath}${e.line ? `:${e.line}` : ''}: ${e.errorMessage}`
        ).join('\n')}`
      : '';
    
    const impactInfo = context.impactedModules.length > 0
      ? `\nImpacted Modules (may need updates):\n${context.impactedModules.map(m => `- ${m}`).join('\n')}`
      : '';

    const systemPrompt = `You are an expert software architect creating a precise execution plan.

CRITICAL RULES:
1. Create a STEP-BY-STEP plan that can be executed INCREMENTALLY
2. Each step should modify EXACTLY ONE file
3. Order steps by dependency - foundational changes first
4. Include INSPECTION steps before modifications if needed
5. Include VERIFICATION steps after critical changes
6. Be SPECIFIC about what changes in each step

Output a JSON array of steps:
[
  {
    "id": "step_1",
    "filePath": "exact/path/to/file.ts",
    "description": "Detailed description of what to do",
    "lineHints": [42, 45],  // Optional: specific lines to modify
    "codeReferences": ["functionName", "className"],  // Symbols involved
    "actionType": "inspect|modify|create|delete|refactor",
    "priority": 1,  // Execution order
    "estimatedComplexity": "low|medium|high",
    "dependencies": []  // IDs of steps that must complete first
  }
]`;

    const userPrompt = `
GOAL: ${intent.goal}
TASK TYPE: ${intent.taskType}
CONSTRAINTS: ${intent.constraints.join(', ') || 'None'}
ACCEPTANCE CRITERIA: ${intent.acceptanceCriteria.join(', ')}

RELEVANT FILES:
${fileSummaries}
${errorInfo}
${impactInfo}

Create a detailed, ordered execution plan. Each step should be atomic and independently verifiable.
For complex tasks, include inspection steps first to understand the code before modifying.`;

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 8000,
        },
      });

      const text = response.text || '[]';
      const steps = JSON.parse(text) as TaskStep[];
      
      // Ensure valid step structure
      return steps.map((step, index) => ({
        ...step,
        id: step.id || `step_${index + 1}`,
        priority: step.priority || index + 1,
        estimatedComplexity: step.estimatedComplexity || 'medium',
        actionType: step.actionType || 'modify',
        dependencies: step.dependencies || [],
      }));
    } catch (e) {
      console.error('[TaskPlanner] Plan synthesis failed:', e);
      
      // Fallback: create simple plan from relevant files
      return context.relevantFiles.map((rf, index) => ({
        id: `step_${index + 1}`,
        filePath: rf.filePath,
        description: `${intent.taskType === 'fix_error' ? 'Fix issues in' : 'Modify'} ${rf.filePath}`,
        actionType: 'modify' as const,
        priority: index + 1,
        estimatedComplexity: 'medium' as const,
        dependencies: [],
      }));
    }
  }

  // ============ Phase 4: Plan Serializer ============

  private serializePlan(
    planId: string,
    intent: IntentAnalysis,
    context: ContextAnalysis,
    steps: TaskStep[]
  ): TaskPlan {
    // Calculate complexity based on number of steps and files
    let complexity: TaskPlan['complexity'] = 'simple';
    if (steps.length > 7) complexity = 'very_complex';
    else if (steps.length > 4) complexity = 'complex';
    else if (steps.length > 2) complexity = 'moderate';
    
    // Estimate effort (rough: 30s per low, 60s per medium, 120s per high)
    const effortMap = { low: 30, medium: 60, high: 120 };
    const estimatedEffort = steps.reduce((sum, step) => 
      sum + (effortMap[step.estimatedComplexity] || 60), 0
    );
    
    return {
      id: planId,
      goal: intent.goal,
      reasoning_summary: `Task: ${intent.taskType}. Affecting ${context.relevantFiles.length} files. ` +
        `${context.errorLocations.length} error(s) to address. ${context.impactedModules.length} modules may be impacted.`,
      steps,
      dependencies: context.relevantFiles.map(rf => rf.filePath),
      estimated_effort_seconds: estimatedEffort,
      complexity,
      requires_verification: intent.taskType === 'fix_error' || complexity !== 'simple',
      rollback_strategy: 'Git stash or manual undo of changes',
    };
  }

  // ============ Helper Methods ============

  private getClient(): GoogleGenAI {
    const apiKey = process.env.AGENT_API_KEY;
    if (!apiKey) {
      throw new Error('AGENT_API_KEY not set');
    }
    return new GoogleGenAI({ apiKey });
  }

  private classifyError(diagnostic: string): string {
    const lower = diagnostic.toLowerCase();
    if (lower.includes('type') || lower.includes('ts(')) return 'type_error';
    if (lower.includes('import') || lower.includes('module')) return 'import_error';
    if (lower.includes('undefined') || lower.includes('null')) return 'null_reference';
    if (lower.includes('syntax')) return 'syntax_error';
    if (lower.includes('not found') || lower.includes('cannot find')) return 'not_found';
    return 'unknown_error';
  }

  private extractSymbols(content: string): string[] {
    const symbols: string[] = [];
    
    // Extract function names
    const funcMatches = content.matchAll(/(?:function|const|let|var)\s+(\w+)\s*[=(]/g);
    for (const match of funcMatches) {
      symbols.push(match[1]);
    }
    
    // Extract class names
    const classMatches = content.matchAll(/class\s+(\w+)/g);
    for (const match of classMatches) {
      symbols.push(match[1]);
    }
    
    // Extract interface/type names
    const typeMatches = content.matchAll(/(?:interface|type)\s+(\w+)/g);
    for (const match of typeMatches) {
      symbols.push(match[1]);
    }
    
    return [...new Set(symbols)].slice(0, 10);
  }

  private extractImports(content: string, filePath: string): string[] {
    const imports: string[] = [];
    
    // ES6 imports
    const es6Matches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
    for (const match of es6Matches) {
      imports.push(match[1]);
    }
    
    // CommonJS requires
    const cjsMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of cjsMatches) {
      imports.push(match[1]);
    }
    
    return imports.filter(imp => !imp.startsWith('@') && !imp.includes('node_modules'));
  }
}

export default TaskPlannerModule;
