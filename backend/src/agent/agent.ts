import { GoogleGenAI, Schema, Type } from '@google/genai';
import type { FileSystemOperation, AnalysisResult } from '../types';
import { getContextForPrompt } from '../services/ragService';
import { routePrompt, getModelClient } from '../services/modelRouter';
import { handleConversation } from '../services/smartChat';
import { AdvancedReasoningEngine } from '../services/advancedReasoningEngine';

type AgentInput = {
  prompt: string;
  files: { filePath: string; content: string }[];
  selectedFilePaths: string[];
  diagnostics: string[];
  workspaceId?: string;
  model?: string; // Manual model override
  onProgress?: (msg: string) => void;
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
  const { prompt, files, selectedFilePaths, diagnostics, workspaceId, model, onProgress } = input;

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
      }
    } catch (e) {
      console.warn('[Agent] RAG context retrieval failed:', e);
    }
  }

  // Step 3: Analyze cross-file dependencies
  let dependencyContext = '';
  if (selectedFilePaths.length > 0) {
    onProgress?.('Analyzing cross-file dependencies...');
    dependencyContext = analyzeDependencies(selectedFilePaths, files);
    if (dependencyContext) {
      onProgress?.('Identified related files and dependencies.');
    }
  }

  // Step 3: Prepare file context (increased limit)
  const limitedFiles = files.slice(0, 100).map(f => ({
    filePath: f.filePath,
    content: f.content.slice(0, 15000),
  }));

  onProgress?.('Processing ' + limitedFiles.length + ' files from workspace...');

  const fileContext = limitedFiles
    .map(f => 'File: ' + f.filePath + '\n```\n' + f.content + '\n```')
    .join('\n\n');

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
    throw new Error('Max retries exceeded for code generation');
  }

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
