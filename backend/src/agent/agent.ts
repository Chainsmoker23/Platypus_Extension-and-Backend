import { GoogleGenAI, Schema, Type } from '@google/genai';
import type { FileSystemOperation, AnalysisResult, AgentProgressEvent, TaskPlanSummary, ExecutionStateSummary } from '../types';
import { getContextForPrompt } from '../services/ragService';
import { routePrompt, getModelClient } from '../services/modelRouter';
import { handleConversation } from '../services/smartChat';
import { AdvancedReasoningEngine } from '../services/advancedReasoningEngine';
import { DeepReasoningEngine } from '../services/deepReasoningEngine';
import { TaskPlannerModule, TaskPlan } from '../services/taskPlannerModule';
import { OrchestratorService, OrchestratorProgress } from '../services/orchestratorService';
import apiKeyPool from '../services/apiKeyPool';

type AgentInput = {
  prompt: string;
  files: { filePath: string; content: string }[];
  selectedFilePaths: string[];
  diagnostics: string[];
  workspaceId?: string;
  model?: string; // Manual model override
  useIntelligentPipeline?: boolean; // Enable Task Planner + Orchestrator
  onProgress?: (msg: string) => void;
  onProgressEvent?: (event: AgentProgressEvent) => void; // Enhanced progress events
};

const MAX_RETRIES = 2;

/**
 * Detect if an error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
    if (!error) return false;
    
    // Check for common rate limit indicators
    return (
        (error.status === 429) ||
        (error.code === 429) ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('rate limit')) ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('resource exhausted'))
    );
}

function getClient() {
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) {
    throw new Error('AGENT_API_KEY is not set in environment; cannot call LLM');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Validate generated code for common errors
 */
function validateGeneratedCode(content: string, filePath: string): string[] {
  const errors: string[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  // TypeScript/JavaScript validation
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
    // Check for unmatched braces
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push('Unmatched braces detected');
    }
    
    // Check for unmatched parentheses
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push('Unmatched parentheses detected');
    }
    
    // Check for incomplete statements
    if (content.includes('// TODO') || content.includes('/* TODO')) {
      errors.push('Contains TODO comments');
    }
    
    // Check for placeholder text
    if (content.includes('...') && !content.includes('...args') && !content.includes('...props')) {
      errors.push('Contains placeholder ellipsis');
    }
  }
  
  return errors;
}

/**
 * Auto-correct common code issues
 */
async function autoCorrectCode(
  client: GoogleGenAI,
  model: string,
  originalCode: string,
  filePath: string,
  errors: string[],
  onProgress?: (msg: string) => void
): Promise<string> {
  onProgress?.('Auto-correcting detected issues: ' + errors.join(', '));
  
  const correctionPrompt = [
    'Fix the following code issues:',
    errors.map(e => '- ' + e).join('\n'),
    '',
    'Original code:',
    '```',
    originalCode,
    '```',
    '',
    'Return ONLY the corrected code without any explanation or markdown.',
  ].join('\n');
  
  try {
    const response = await client.models.generateContent({
      model,
      contents: correctionPrompt,
      config: {
        maxOutputTokens: 8000,
        temperature: 0.2,
      },
    });
    
    let corrected = response.text || originalCode;
    
    // Clean up markdown if present
    corrected = corrected.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    
    return corrected;
  } catch (e) {
    console.error('[Agent] Auto-correction failed:', e);
    return originalCode;
  }
}

export async function runAgent(input: AgentInput): Promise<AnalysisResult> {
  const { prompt, files, selectedFilePaths, diagnostics, workspaceId, model, useIntelligentPipeline, onProgress, onProgressEvent } = input;

  // ============ NEW: Intelligent Pipeline (Cursor-like) ============
  // Check if we should use the intelligent Task Planner + Orchestrator pipeline
  const shouldUseIntelligentPipeline = 
    useIntelligentPipeline || // Explicitly requested
    model === 'intelligent' || model === 'cursor' || // Model override
    selectedFilePaths.length > 3 || // Multi-file operations
    files.length > 20 || // Large codebase
    diagnostics.length > 2 || // Multiple errors to fix
    prompt.toLowerCase().includes('fix') ||
    prompt.toLowerCase().includes('refactor') ||
    prompt.toLowerCase().includes('implement') ||
    prompt.toLowerCase().includes('add feature') ||
    prompt.toLowerCase().includes('across') || // "across all files"
    prompt.length > 200; // Complex request

  if (shouldUseIntelligentPipeline) {
    onProgress?.('🧠 Activating Intelligent Pipeline (Cursor-like processing)...');
    onProgressEvent?.({
      type: 'planning',
      message: 'Activating Intelligent Pipeline for comprehensive analysis...',
    });

    try {
      return await runIntelligentPipeline(input);
    } catch (error: any) {
      onProgress?.('Intelligent pipeline encountered an issue, falling back to standard processing...');
      console.warn('[Agent] Intelligent pipeline failed:', error);
      // Fall through to existing processing methods
    }
  }

  // Check if deep reasoning mode is requested (for complex tasks)
  const useDeepReasoning = model === 'reasoning' || model === 'deep' || 
    prompt.toLowerCase().includes('understand') ||
    prompt.toLowerCase().includes('analyze deeply') ||
    prompt.toLowerCase().includes('figure out') ||
    selectedFilePaths.length > 5 || // Complex multi-file operations
    files.length > 30; // Large codebase

  if (useDeepReasoning) {
    onProgress?.('Activating Deep Reasoning Engine for comprehensive analysis...');
    
    // Use the Deep Reasoning Engine for intelligent processing
    const deepEngine = new DeepReasoningEngine(
      model === 'reasoning' ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
      onProgress
    );
    
    try {
      return await deepEngine.process(prompt, files, selectedFilePaths, diagnostics);
    } catch (error: any) {
      onProgress?.('Deep reasoning failed, falling back to standard processing...');
      console.warn('[Agent] Deep reasoning failed:', error);
      // Fall through to standard processing
    }
  }

  // Step 1: Route to appropriate model based on complexity or manual override
  let routing;
  if (model) {
    // Manual model override
    const tier = model === 'preview' ? 'preview' : 
                 model === 'reasoning' ? 'reasoning' : 
                 model === 'flash' ? 'standard' : 
                 model === 'flash-lite' ? 'lite' : 'standard';
    routing = {
      model: model === 'preview' ? 'gemini-3.0-preview' : 
             model === 'reasoning' ? 'gemini-2.5-flash' : 
             model === 'flash' ? 'gemini-2.0-flash' : 
             model === 'flash-lite' ? 'gemini-2.0-flash-lite' : 'gemini-2.0-flash',
      tier,
      reason: `Manual override to ${model} model`
    };
  } else {
    // Auto routing
    routing = routePrompt(prompt, selectedFilePaths.length > 0);
  }
  onProgress?.('Using ' + routing.tier + ' model: ' + routing.reason);

  const { client, model: modelName } = getModelClient(routing.tier as any);

  // Step 2: Get RAG context if workspace is indexed
  let ragContext = '';
  if (workspaceId) {
    onProgress?.('Searching knowledge base for relevant context...');
    try {
      ragContext = await getContextForPrompt(workspaceId, prompt, 10);
      if (ragContext) {
        onProgress?.('Found relevant context from indexed codebase.');
      } else {
        onProgress?.('No relevant context found in knowledge base.');
      }
    } catch (e) {
      console.warn('[Agent] RAG context retrieval failed:', e);
      onProgress?.('Failed to search knowledge base.');
    }
  }

  // Step 3: Analyze cross-file dependencies
  let dependencyContext = '';
  if (selectedFilePaths.length > 0) {
    onProgress?.('Analyzing cross-file dependencies...');
    dependencyContext = analyzeDependencies(selectedFilePaths, files);
    if (dependencyContext) {
      onProgress?.('Identified related files and dependencies.');
    } else {
      onProgress?.('No cross-file dependencies found.');
    }
  }

  // Step 3: Prepare file context (increased limit)
  const limitedFiles = files.slice(0, 100).map(f => ({
    filePath: f.filePath,
    content: f.content.slice(0, 15000),
  }));

  onProgress?.('Processing ' + limitedFiles.length + ' files from workspace...');
  
  // Process files with progress updates
  let processedFiles = 0;
  const fileContextParts: string[] = [];
  
  for (const file of limitedFiles) {
    fileContextParts.push('File: ' + file.filePath + '\n```\n' + file.content + '\n```');
    processedFiles++;
    
    // Update progress every 10 files
    if (processedFiles % 10 === 0 || processedFiles === limitedFiles.length) {
      onProgress?.(`Processed ${processedFiles}/${limitedFiles.length} files`);
    }
  }
  
  const fileContext = fileContextParts.join('\n\n');

  const diagContext = diagnostics && diagnostics.length
    ? 'IMPORTANT - Current errors in workspace:\n' + diagnostics.join('\n') + '\n\nYou MUST fix these errors.\n\n'
    : '';

  const systemText = [
    'You are Platypus, a senior full-stack engineer and autonomous code agent.',
    '',
    'CRITICAL INSTRUCTIONS:',
    '1. Generate COMPLETE, WORKING code - no placeholders or TODOs',
    '2. Ensure all braces, brackets, and parentheses are properly matched',
    '3. Include ALL necessary imports at the top of files',
    '4. If fixing errors, verify your fix actually resolves the issue',
    '5. Prefer providing full file content over diffs for reliability',
    '',
    'Your job:',
    '- Understand the user\'s request and the current project.',
    '- Plan concrete code changes (create / modify / delete files).',
    '- Produce COMPLETE file contents to implement the plan.',
    '- If the user names files (e.g. Sidebar.tsx), prioritize those.',
    '',
    'You must ALWAYS return at least one change if the request is about code.',
    '',
    'Output must be strict JSON matching this schema:',
    '{',
    '  "reasoning": string,',
    '  "changes": [',
    '    {',
    '      "type": "modify" | "create" | "delete",',
    '      "filePath": string,',
    '      "content": string (REQUIRED - full file content),',
    '      "explanation": string',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const selectedInfo = selectedFilePaths.length
    ? 'User-selected focus files:\n' + selectedFilePaths.join('\n') + '\n\n'
    : '';

  const userTextParts = [
    'User request:',
    prompt,
    '',
    selectedInfo,
    diagContext,
    ragContext,
    dependencyContext, // Add dependency context
    'Project snapshot:',
    fileContext,
  ];

  const userText = userTextParts.join('\n').slice(0, 48000);

  // Step 4: Generate code changes
  onProgress?.('Generating code changes with ' + model + '...');
  
  // Retry logic with exponential backoff for rate limiting
  let attempts = 0;
  const maxAttempts = 3;
  let response: any;
  
  while (attempts < maxAttempts) {
    try {
      // More detailed progress updates during generation
      const progressCallback = setInterval(() => {
        onProgress?.('Still generating code changes...');
      }, 3000);

      response = await client.models.generateContent({
        model: modelName,
        contents: { parts: [{ text: systemText }, { text: userText }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reasoning: { type: Type.STRING } as Schema,
              changes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING } as Schema,
                    filePath: { type: Type.STRING } as Schema,
                    diff: { type: Type.STRING } as Schema,
                    content: { type: Type.STRING } as Schema,
                    explanation: { type: Type.STRING } as Schema,
                  },
                  required: ['type', 'filePath'],
                } as Schema,
              } as Schema,
            },
            required: ['reasoning', 'changes'],
          },
        },
      });
      
      clearInterval(progressCallback);
      break; // Success, exit retry loop
      
    } catch (error: any) {
      attempts++;
      if (attempts >= maxAttempts || !isRateLimitError(error)) {
        onProgress?.('Failed to generate code changes.');
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempts) * 1000;
      console.log(`[Agent] Rate limited, retrying in ${delay}ms...`);
      onProgress?.(`Rate limited, waiting ${delay/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  if (attempts >= maxAttempts) {
    onProgress?.('Max retries exceeded for code generation');
    throw new Error('Max retries exceeded for code generation');
  }
  
  onProgress?.('Code generation completed, processing response...');

  const raw = response.text || '{}';
  let parsed: AnalysisResult;

  try {
    parsed = JSON.parse(raw) as AnalysisResult;
  } catch (e) {
    console.warn('[Agent] Failed to parse LLM JSON, falling back.', e);
    parsed = {
      reasoning: 'LLM response could not be parsed. Raw: ' + raw.slice(0, 4000),
      changes: [],
    };
  }

  // Step 5: Validate and auto-correct generated code
  if (parsed.changes && parsed.changes.length > 0) {
    onProgress?.('Validating generated code...');
    
    for (let i = 0; i < parsed.changes.length; i++) {
      const change = parsed.changes[i];
      
      if (change.content && (change.type === 'create' || change.type === 'modify')) {
        const errors = validateGeneratedCode(change.content, change.filePath);
        
        if (errors.length > 0) {
          onProgress?.('Found issues in ' + change.filePath + ', auto-correcting...');
          
          const correctedContent = await autoCorrectCode(
            client,
            modelName,
            change.content,
            change.filePath,
            errors,
            onProgress
          );
          
          parsed.changes[i].content = correctedContent;
        }
      }
    }
  }

  if (!parsed.changes || parsed.changes.length === 0) {
    const fallbackContent = [
      'Platypus could not safely generate a concrete patch.',
      '',
      'Reasoning:',
      parsed.reasoning,
      '',
      'User request:',
      prompt,
    ].join('\n');

    parsed.changes = [
      {
        type: 'create',
        filePath: 'PLATYPUS_SUGGESTED_ACTIONS.md',
        content: fallbackContent,
        explanation: 'Fallback suggestion file because no safe patch was generated.',
      },
    ];
  }

  // Report individual file changes for streaming UI
  for (const change of parsed.changes) {
    const action = change.type === 'create' ? 'Creating:' 
      : change.type === 'delete' ? 'Deleting:' 
      : 'Modifying:';
    onProgress?.(action + ' ' + change.filePath);
  }

  onProgress?.('Analysis complete. Ready to apply ' + parsed.changes.length + ' change(s).');

  return parsed;
}

/**
 * Analyze cross-file dependencies to identify related files
 */
function analyzeDependencies(selectedFiles: string[], allFiles: { filePath: string; content: string }[]): string {
  if (selectedFiles.length === 0) return '';
  
  const dependencies: string[] = [];
  
  // For each selected file, look for imports/references in other files
  for (const selectedFile of selectedFiles) {
    const fileName = selectedFile.split('/').pop()?.split('.')[0] || '';
    
    for (const file of allFiles) {
      // Skip the file itself
      if (file.filePath === selectedFile) continue;
      
      // Look for references to the selected file
      const importPatterns = [
        new RegExp(`from\\s+['"].*${fileName}['"]`, 'i'),
        new RegExp(`import\\s+['"].*${fileName}['"]`, 'i'),
      ];
      
      const hasReference = importPatterns.some(pattern => pattern.test(file.content));
      
      if (hasReference) {
        dependencies.push(file.filePath);
      }
    }
  }
  
  // Deduplicate and limit results
  const uniqueDeps = [...new Set(dependencies)].slice(0, 5);
  
  if (uniqueDeps.length === 0) return '';
  
  const depsList = uniqueDeps.map(dep => `- ${dep}`).join('\n');
  
  return '\n## Cross-File Dependencies Detected\n\nThe following files are related to your selected files and may need coordinated changes:\n' + depsList + '\n\nConsider making changes to these files as well to maintain consistency.\n';
}

/**
 * ============ INTELLIGENT PIPELINE ============
 * 
 * This is the Cursor-like intelligent processing pipeline that:
 * 1. Creates a structured task plan BEFORE making any changes
 * 2. Executes changes incrementally, one file at a time
 * 3. Verifies each change and reflects/retries on failures
 * 4. Reports detailed progress throughout the process
 */
async function runIntelligentPipeline(input: AgentInput): Promise<AnalysisResult> {
  const { prompt, files, selectedFilePaths, diagnostics, workspaceId, model, onProgress, onProgressEvent } = input;

  // Determine which model to use
  const modelName = model === 'intelligent' || model === 'cursor' 
    ? 'gemini-2.5-flash' 
    : model === 'reasoning' || model === 'preview'
      ? 'gemini-2.5-pro'
      : 'gemini-2.5-flash';

  // ============ PHASE 1: Task Planning ============
  onProgress?.('📋 Phase 1: Creating execution plan...');
  onProgressEvent?.({
    type: 'planning',
    phase: 'intent',
    message: 'Analyzing your request and understanding intent...',
  });

  const planner = new TaskPlannerModule(modelName, (progress) => {
    onProgress?.(`  → ${progress.message}`);
    onProgressEvent?.({
      type: 'planning',
      phase: progress.phase,
      message: progress.message,
    });
  });

  let plan: TaskPlan;
  try {
    plan = await planner.createPlan(
      prompt,
      files,
      diagnostics,
      workspaceId,
      selectedFilePaths
    );

    onProgress?.(`✅ Plan created: ${plan.steps.length} steps, ${plan.complexity} complexity`);
    onProgress?.(`   Goal: ${plan.goal}`);
    onProgress?.(`   Estimated time: ${Math.ceil(plan.estimated_effort_seconds / 60)} minute(s)`);
    
    // Log the plan steps
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      onProgress?.(`   Step ${i + 1}: [${step.actionType}] ${step.filePath} - ${step.description.slice(0, 60)}...`);
    }

    const planSummary: TaskPlanSummary = {
      id: plan.id,
      goal: plan.goal,
      steps: plan.steps,
      complexity: plan.complexity,
      estimatedTimeSeconds: plan.estimated_effort_seconds,
    };

    onProgressEvent?.({
      type: 'planning',
      phase: 'complete',
      message: `Plan created with ${plan.steps.length} steps`,
      plan: planSummary,
    });

  } catch (error: any) {
    console.error('[Agent] Task planning failed:', error);
    onProgress?.('❌ Failed to create execution plan, falling back to standard processing');
    throw error;
  }

  // ============ PHASE 2: Orchestrated Execution ============
  onProgress?.('\n🚀 Phase 2: Executing plan step by step...');
  onProgressEvent?.({
    type: 'step',
    message: 'Starting incremental execution...',
    currentStep: 0,
    totalSteps: plan.steps.length,
  });

  const orchestrator = new OrchestratorService(modelName, (progress: OrchestratorProgress) => {
    // Convert orchestrator progress to agent progress
    const stepInfo = progress.currentStep && progress.totalSteps
      ? `[${progress.currentStep}/${progress.totalSteps}]`
      : '';

    switch (progress.phase) {
      case 'step_start':
        onProgress?.(`\n📂 ${stepInfo} Starting: ${progress.stepDescription}`);
        break;
      case 'step_reading':
        onProgress?.(`   📖 Reading file: ${progress.message}`);
        break;
      case 'step_generating':
        onProgress?.(`   ✏️  Generating changes...`);
        break;
      case 'step_verifying':
        onProgress?.(`   🔍 Verifying changes...`);
        break;
      case 'step_complete':
        onProgress?.(`   ✅ Completed: ${progress.changes?.length || 0} change(s)`);
        break;
      case 'reflection':
        onProgress?.(`   🤔 Reflecting on issues: ${progress.message}`);
        break;
      case 'retry':
        onProgress?.(`   🔄 Retrying: ${progress.message}`);
        break;
      case 'error':
        onProgress?.(`   ❌ Error: ${progress.message}`);
        break;
      case 'complete':
        onProgress?.(`\n✅ ${progress.message}`);
        break;
    }

    // Map to AgentProgressEvent
    const eventType: AgentProgressEvent['type'] = 
      progress.phase === 'step_verifying' ? 'verification' :
      progress.phase === 'reflection' ? 'reflection' :
      progress.phase === 'error' ? 'error' :
      progress.phase === 'complete' ? 'complete' : 'step';

    const stateSummary: ExecutionStateSummary | undefined = progress.state ? {
      planId: progress.state.planId,
      currentStep: progress.state.currentStepIndex + 1,
      totalSteps: progress.state.totalSteps,
      stepResults: progress.state.stepResults.map(r => ({
        stepId: r.stepId,
        status: r.status,
        changesCount: r.changes?.length || 0,
        error: r.error,
      })),
      status: progress.state.status,
      elapsedTimeMs: progress.state.elapsedTimeMs,
      estimatedRemainingMs: progress.state.estimatedRemainingMs,
    } : undefined;

    onProgressEvent?.({
      type: eventType,
      phase: progress.phase,
      stepId: progress.stepId,
      stepDescription: progress.stepDescription,
      currentStep: progress.currentStep,
      totalSteps: progress.totalSteps,
      message: progress.message,
      changes: progress.changes,
      state: stateSummary,
    });
  });

  try {
    const result = await orchestrator.executePlan(plan, files, diagnostics);

    // Add plan info to result
    const finalResult: AnalysisResult = {
      ...result,
      plan: {
        id: plan.id,
        goal: plan.goal,
        steps: plan.steps,
        complexity: plan.complexity,
        estimatedTimeSeconds: plan.estimated_effort_seconds,
      },
    };

    // Final summary
    onProgress?.('\n' + '='.repeat(50));
    onProgress?.('📊 EXECUTION SUMMARY');
    onProgress?.('='.repeat(50));
    onProgress?.(`   Total changes: ${result.changes.length}`);
    onProgress?.(`   Files modified: ${new Set(result.changes.map(c => c.filePath)).size}`);
    
    const state = orchestrator.getState();
    if (state) {
      const completedSteps = state.stepResults.filter(r => r.status === 'completed').length;
      const failedSteps = state.stepResults.filter(r => r.status === 'failed').length;
      onProgress?.(`   Steps completed: ${completedSteps}/${state.totalSteps}`);
      if (failedSteps > 0) {
        onProgress?.(`   Steps failed: ${failedSteps}`);
      }
      onProgress?.(`   Total time: ${Math.round(state.elapsedTimeMs / 1000)}s`);
    }
    onProgress?.('='.repeat(50));

    return finalResult;

  } catch (error: any) {
    console.error('[Agent] Orchestrator execution failed:', error);
    onProgress?.('❌ Execution failed: ' + error.message);
    onProgressEvent?.({
      type: 'error',
      message: 'Execution failed: ' + error.message,
    });
    throw error;
  }
}
