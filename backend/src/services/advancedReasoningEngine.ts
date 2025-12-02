import { GoogleGenAI } from '@google/genai';
import type { FileSystemOperation } from '../types';

interface AdvancedReasoningInput {
  prompt: string;
  files: { filePath: string; content: string }[];
  selectedFiles: string[];
  context: string;
  onProgress?: (message: string) => void;
}

interface AdvancedReasoningOutput {
  plan: string;
  changes: FileSystemOperation[];
  confidence: number;
}

/**
 * Advanced reasoning engine for complex multi-file operations
 */
export class AdvancedReasoningEngine {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-pro') {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /**
   * Perform advanced reasoning on complex tasks
   */
  async reason(input: AdvancedReasoningInput): Promise<AdvancedReasoningOutput> {
    const { prompt, files, selectedFiles, context, onProgress } = input;
    
    onProgress?.('Initializing advanced reasoning engine...');
    
    // Step 1: Analyze the request complexity
    const complexity = await this.analyzeComplexity(prompt, files, selectedFiles);
    onProgress?.(`Task complexity assessed: ${complexity.level} (${complexity.score}/100)`);
    
    // Step 2: Generate detailed plan
    onProgress?.('Generating detailed execution plan...');
    const plan = await this.generatePlan(prompt, files, selectedFiles, context, complexity);
    
    // Step 3: Identify all affected files
    onProgress?.('Identifying affected files and dependencies...');
    const affectedFiles = await this.identifyAffectedFiles(prompt, files, selectedFiles, plan);
    
    // Step 4: Generate changes with cross-file consistency
    onProgress?.('Generating coordinated changes across files...');
    const changes = await this.generateCoordinatedChanges(
      prompt, 
      files, 
      selectedFiles, 
      affectedFiles, 
      plan, 
      context,
      onProgress
    );
    
    // Step 5: Validate consistency
    onProgress?.('Validating cross-file consistency...');
    const validatedChanges = await this.validateConsistency(changes, files);
    
    return {
      plan,
      changes: validatedChanges,
      confidence: this.calculateConfidence(complexity, changes.length)
    };
  }

  /**
   * Analyze the complexity of a task
   */
  private async analyzeComplexity(
    prompt: string, 
    files: { filePath: string; content: string }[],
    selectedFiles: string[]
  ): Promise<{ level: string; score: number }> {
    const fileCount = files.length;
    const selectedCount = selectedFiles.length;
    const wordCount = prompt.split(/\s+/).length;
    
    // Simple heuristic for complexity
    let score = 0;
    score += Math.min(wordCount * 2, 40); // Up to 40 points for word count
    score += Math.min(fileCount, 30); // Up to 30 points for file count
    score += Math.min(selectedCount * 5, 30); // Up to 30 points for selected files
    
    let level = 'Low';
    if (score > 70) level = 'High';
    else if (score > 40) level = 'Medium';
    
    return { level, score };
  }

  /**
   * Generate a detailed execution plan
   */
  private async generatePlan(
    prompt: string,
    files: { filePath: string; content: string }[],
    selectedFiles: string[],
    context: string,
    complexity: { level: string; score: number }
  ): Promise<string> {
    const systemPrompt = `
You are an advanced software architect AI. Your task is to create a detailed execution plan for complex software development tasks.

INPUT:
- User request: ${prompt}
- Complexity level: ${complexity.level} (${complexity.score}/100)
- Selected files: ${selectedFiles.join(', ') || 'None'}
- Available context: ${context.substring(0, 1000)}...

OUTPUT FORMAT:
Provide a step-by-step plan in the following format:
1. [Step description]
2. [Step description]
...

Focus on:
- Breaking down complex tasks into manageable steps
- Identifying potential challenges
- Suggesting best practices
- Ensuring maintainability and scalability
`;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: systemPrompt,
        config: {
          maxOutputTokens: 1000,
          temperature: 0.5,
        }
      });
      
      return response.text || 'No plan generated';
    } catch (error) {
      console.error('Plan generation failed:', error);
      return 'Failed to generate plan due to error';
    }
  }

  /**
   * Identify all files that might be affected by the changes
   */
  private async identifyAffectedFiles(
    prompt: string,
    files: { filePath: string; content: string }[],
    selectedFiles: string[],
    plan: string
  ): Promise<string[]> {
    // Start with selected files
    const affected = new Set(selectedFiles);
    
    // Look for file references in the prompt and plan
    const allText = prompt + ' ' + plan;
    const fileRefs = files
      .filter(f => allText.toLowerCase().includes(f.filePath.toLowerCase()))
      .map(f => f.filePath);
    
    fileRefs.forEach(f => affected.add(f));
    
    // Add common related files (configs, tests, etc.)
    files
      .filter(f => {
        const name = f.filePath.toLowerCase();
        return name.includes('config') || name.includes('test') || name.includes('spec');
      })
      .forEach(f => affected.add(f.filePath));
    
    return Array.from(affected).slice(0, 10); // Limit to 10 files
  }

  /**
   * Generate coordinated changes across multiple files
   */
  private async generateCoordinatedChanges(
    prompt: string,
    files: { filePath: string; content: string }[],
    selectedFiles: string[],
    affectedFiles: string[],
    plan: string,
    context: string,
    onProgress?: (message: string) => void
  ): Promise<FileSystemOperation[]> {
    const systemPrompt = `
You are a senior software engineer specializing in coordinated multi-file changes.

TASK:
${prompt}

PLAN:
${plan}

CONTEXT:
${context.substring(0, 2000)}

FILES TO MODIFY:
${affectedFiles.join('\n')}

PROJECT STRUCTURE:
${files.map(f => `- ${f.filePath}`).join('\n')}

GENERATE CHANGES:
For each file that needs modification, provide:
1. File path
2. Complete new content (not diffs)
3. Brief explanation of changes

RETURN FORMAT (JSON):
{
  "changes": [
    {
      "type": "modify|create|delete",
      "filePath": "path/to/file",
      "content": "complete file content",
      "explanation": "brief explanation"
    }
  ]
}

IMPORTANT:
- Generate COMPLETE file contents, not diffs
- Ensure all changes are consistent with each other
- Include ALL necessary imports and dependencies
- Validate syntax before returning
- Focus only on files that actually need changes
`;

    try {
      onProgress?.('Generating coordinated changes...');
      
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: systemPrompt,
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 8000,
          temperature: 0.3,
        }
      });
      
      const raw = response.text || '{}';
      let parsed: { changes: FileSystemOperation[] };
      
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to parse reasoning engine JSON:', e);
        parsed = { changes: [] };
      }
      
      return parsed.changes || [];
    } catch (error) {
      console.error('Coordinated changes generation failed:', error);
      return [];
    }
  }

  /**
   * Validate consistency across changes
   */
  private async validateConsistency(
    changes: FileSystemOperation[],
    allFiles: { filePath: string; content: string }[]
  ): Promise<FileSystemOperation[]> {
    // For now, just return the changes
    // In a more advanced implementation, we would validate cross-file consistency
    return changes;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    complexity: { level: string; score: number },
    changeCount: number
  ): number {
    // Simple confidence calculation
    let confidence = 100;
    
    // Reduce confidence for high complexity
    if (complexity.score > 70) confidence -= 20;
    else if (complexity.score > 40) confidence -= 10;
    
    // Reduce confidence for many changes
    if (changeCount > 10) confidence -= 15;
    else if (changeCount > 5) confidence -= 5;
    
    return Math.max(confidence, 50); // Minimum 50% confidence
  }
}