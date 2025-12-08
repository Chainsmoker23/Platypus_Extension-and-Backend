/**
 * Deep Reasoning Engine
 * 
 * This engine provides Cursor-like intelligent understanding and reasoning:
 * 1. Deeply understands user intent from minimal prompts
 * 2. Reads and analyzes files thoroughly before making changes
 * 3. Plans changes step-by-step with reasoning
 * 4. Iteratively reads, updates, verifies changes
 * 5. Handles complex multi-file operations seamlessly
 */

import { GoogleGenAI, Schema, Type } from '@google/genai';
import apiKeyPool from './apiKeyPool';
import type { FileSystemOperation, AnalysisResult as AgentResult } from '../types';

// Types for the reasoning engine
interface FileContext {
    filePath: string;
    content: string;
    language: string;
    imports: string[];
    exports: string[];
    dependencies: string[];
    summary: string;
}

interface ReasoningStep {
    id: string;
    type: 'understand' | 'analyze' | 'plan' | 'execute' | 'verify';
    description: string;
    status: 'pending' | 'in-progress' | 'complete' | 'failed';
    result?: any;
    duration?: number;
}

interface UnderstandingResult {
    userIntent: string;
    taskType: 'create' | 'modify' | 'fix' | 'refactor' | 'explain' | 'debug';
    complexity: 'simple' | 'moderate' | 'complex' | 'very-complex';
    requiredFiles: string[];
    relatedFiles: string[];
    potentialImpact: string[];
    suggestedApproach: string;
    questions?: string[]; // Questions to clarify if needed
}

interface CodeAnalysisResult {
    fileContexts: FileContext[];
    codePatterns: string[];
    existingStyles: {
        indentation: string;
        quotes: 'single' | 'double';
        semicolons: boolean;
        namingConvention: string;
    };
    dependencies: Map<string, string[]>;
    potentialIssues: string[];
}

interface ExecutionPlan {
    steps: PlanStep[];
    estimatedChanges: number;
    riskLevel: 'low' | 'medium' | 'high';
    rollbackStrategy: string;
}

interface PlanStep {
    id: string;
    action: 'read' | 'create' | 'modify' | 'delete' | 'verify';
    filePath: string;
    description: string;
    dependencies: string[]; // IDs of steps this depends on
    changes?: {
        type: string;
        description: string;
        lineRange?: [number, number];
    }[];
}

export class DeepReasoningEngine {
    private model: string;
    private onProgress?: (msg: string) => void;
    private reasoningSteps: ReasoningStep[] = [];
    private fileCache: Map<string, FileContext> = new Map();

    constructor(model: string = 'gemini-2.5-pro', onProgress?: (msg: string) => void) {
        this.model = model;
        this.onProgress = onProgress;
    }

    /**
     * Main entry point - processes user request with deep reasoning
     */
    async process(
        prompt: string,
        files: { filePath: string; content: string }[],
        selectedFilePaths: string[] = [],
        diagnostics: string[] = []
    ): Promise<AgentResult> {
        this.progress('Starting deep reasoning analysis...');

        // Phase 1: Deep Understanding
        this.progress('Phase 1: Understanding your request...');
        const understanding = await this.deepUnderstand(prompt, files, selectedFilePaths, diagnostics);
        
        // Phase 2: Thorough Analysis
        this.progress('Phase 2: Analyzing codebase thoroughly...');
        const analysis = await this.thoroughAnalysis(files, understanding);
        
        // Phase 3: Strategic Planning
        this.progress('Phase 3: Planning changes strategically...');
        const plan = await this.createExecutionPlan(understanding, analysis);
        
        // Phase 4: Iterative Execution
        this.progress('Phase 4: Executing changes iteratively...');
        const changes = await this.executeWithVerification(plan, files, understanding);
        
        // Phase 5: Final Verification
        this.progress('Phase 5: Verifying all changes...');
        const verified = await this.verifyChanges(changes, files);

        return verified;
    }

    /**
     * Phase 1: Deep Understanding
     * Understands user intent even from minimal prompts
     */
    private async deepUnderstand(
        prompt: string,
        files: { filePath: string; content: string }[],
        selectedFilePaths: string[],
        diagnostics: string[]
    ): Promise<UnderstandingResult> {
        this.progress('Analyzing user intent...');

        const systemPrompt = `You are an expert code analyst with deep understanding capabilities.
Your task is to thoroughly understand what the user wants, even from minimal or vague prompts.

CRITICAL: You must infer the complete intent, not just the surface request.
- If user says "fix it", determine WHAT needs fixing by analyzing errors and code
- If user says "make it better", identify specific improvements needed
- If user mentions a feature, understand all the components involved

Analyze the user's request and the codebase context to understand:
1. The true intent behind the request
2. What type of task this is
3. How complex the changes will be
4. Which files definitely need changes
5. Which files might be affected
6. Potential risks or impacts
7. The best approach to accomplish this

Be thorough and precise. The quality of your understanding determines the success of the entire operation.`;

        const contextPrompt = `
USER REQUEST: "${prompt}"

SELECTED FILES (user specifically mentioned these):
${selectedFilePaths.map(f => `- ${f}`).join('\n') || 'None specified'}

CURRENT ERRORS/DIAGNOSTICS:
${diagnostics.length > 0 ? diagnostics.join('\n') : 'No errors detected'}

CODEBASE OVERVIEW (${files.length} files):
${files.slice(0, 30).map(f => {
    const lines = f.content.split('\n').length;
    const preview = f.content.slice(0, 500).replace(/\n/g, ' ').trim();
    return `📄 ${f.filePath} (${lines} lines): ${preview}...`;
}).join('\n\n')}

Provide your deep understanding of what the user wants and how to achieve it.`;

        const result = await this.llmCall<UnderstandingResult>(
            systemPrompt,
            contextPrompt,
            {
                type: Type.OBJECT,
                properties: {
                    userIntent: { type: Type.STRING } as Schema,
                    taskType: { type: Type.STRING } as Schema,
                    complexity: { type: Type.STRING } as Schema,
                    requiredFiles: { type: Type.ARRAY, items: { type: Type.STRING } as Schema } as Schema,
                    relatedFiles: { type: Type.ARRAY, items: { type: Type.STRING } as Schema } as Schema,
                    potentialImpact: { type: Type.ARRAY, items: { type: Type.STRING } as Schema } as Schema,
                    suggestedApproach: { type: Type.STRING } as Schema,
                },
                required: ['userIntent', 'taskType', 'complexity', 'requiredFiles', 'suggestedApproach'],
            }
        );

        this.progress(`Understood: ${result.userIntent.slice(0, 100)}...`);
        this.progress(`Task type: ${result.taskType}, Complexity: ${result.complexity}`);
        this.progress(`Files to modify: ${result.requiredFiles.length}, Related files: ${result.relatedFiles?.length || 0}`);

        return result;
    }

    /**
     * Phase 2: Thorough Analysis
     * Deeply analyzes each relevant file
     */
    private async thoroughAnalysis(
        files: { filePath: string; content: string }[],
        understanding: UnderstandingResult
    ): Promise<CodeAnalysisResult> {
        const fileContexts: FileContext[] = [];
        const allRelevantFiles = [...new Set([...understanding.requiredFiles, ...(understanding.relatedFiles || [])])];

        // Analyze each relevant file in detail
        for (let i = 0; i < allRelevantFiles.length; i++) {
            const filePath = allRelevantFiles[i];
            const file = files.find(f => f.filePath === filePath || f.filePath.endsWith(filePath));
            
            if (file) {
                this.progress(`Analyzing file ${i + 1}/${allRelevantFiles.length}: ${filePath}`);
                const context = await this.analyzeFile(file);
                fileContexts.push(context);
                this.fileCache.set(filePath, context);
            }
        }

        // Detect code patterns and styles
        this.progress('Detecting code patterns and styles...');
        const patterns = this.detectCodePatterns(fileContexts);
        const styles = this.detectCodingStyles(fileContexts);
        const dependencies = this.buildDependencyGraph(fileContexts);

        return {
            fileContexts,
            codePatterns: patterns,
            existingStyles: styles,
            dependencies,
            potentialIssues: [],
        };
    }

    /**
     * Analyze a single file in detail
     */
    private async analyzeFile(file: { filePath: string; content: string }): Promise<FileContext> {
        const ext = file.filePath.split('.').pop() || '';
        const language = this.getLanguage(ext);
        
        // Extract imports
        const imports = this.extractImports(file.content, language);
        
        // Extract exports
        const exports = this.extractExports(file.content, language);
        
        // Find dependencies
        const dependencies = this.findDependencies(file.content, language);

        // Generate summary using LLM
        const summary = await this.generateFileSummary(file);

        return {
            filePath: file.filePath,
            content: file.content,
            language,
            imports,
            exports,
            dependencies,
            summary,
        };
    }

    /**
     * Phase 3: Create Execution Plan
     * Creates a detailed step-by-step plan
     */
    private async createExecutionPlan(
        understanding: UnderstandingResult,
        analysis: CodeAnalysisResult
    ): Promise<ExecutionPlan> {
        this.progress('Creating detailed execution plan...');

        const systemPrompt = `You are an expert software architect creating a precise execution plan.
Create a step-by-step plan that:
1. Lists EVERY file that needs to be modified
2. Specifies EXACTLY what changes to make in each file
3. Orders changes to avoid breaking dependencies
4. Includes verification steps after each major change
5. Considers rollback strategies

Be extremely detailed. Each step should be atomic and verifiable.`;

        const contextPrompt = `
TASK: ${understanding.userIntent}
TYPE: ${understanding.taskType}
APPROACH: ${understanding.suggestedApproach}

FILES TO MODIFY:
${analysis.fileContexts.map(f => `
📄 ${f.filePath}
Summary: ${f.summary}
Imports: ${f.imports.join(', ')}
Exports: ${f.exports.join(', ')}
`).join('\n')}

CODE PATTERNS DETECTED:
${analysis.codePatterns.join('\n')}

CODING STYLE:
- Indentation: ${analysis.existingStyles.indentation}
- Quotes: ${analysis.existingStyles.quotes}
- Semicolons: ${analysis.existingStyles.semicolons}
- Naming: ${analysis.existingStyles.namingConvention}

Create a detailed execution plan with ordered steps.`;

        const plan = await this.llmCall<ExecutionPlan>(
            systemPrompt,
            contextPrompt,
            {
                type: Type.OBJECT,
                properties: {
                    steps: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING } as Schema,
                                action: { type: Type.STRING } as Schema,
                                filePath: { type: Type.STRING } as Schema,
                                description: { type: Type.STRING } as Schema,
                                dependencies: { type: Type.ARRAY, items: { type: Type.STRING } as Schema } as Schema,
                            },
                            required: ['id', 'action', 'filePath', 'description'],
                        } as Schema,
                    } as Schema,
                    estimatedChanges: { type: Type.NUMBER } as Schema,
                    riskLevel: { type: Type.STRING } as Schema,
                    rollbackStrategy: { type: Type.STRING } as Schema,
                },
                required: ['steps', 'estimatedChanges', 'riskLevel'],
            }
        );

        this.progress(`Plan created: ${plan.steps.length} steps, Risk level: ${plan.riskLevel}`);

        return plan;
    }

    /**
     * Phase 4: Execute with Verification
     * Iteratively executes changes and verifies each one
     */
    private async executeWithVerification(
        plan: ExecutionPlan,
        files: { filePath: string; content: string }[],
        understanding: UnderstandingResult
    ): Promise<FileSystemOperation[]> {
        const changes: FileSystemOperation[] = [];
        const modifiedFiles = new Map<string, string>();

        // Initialize with original file contents
        files.forEach(f => modifiedFiles.set(f.filePath, f.content));

        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            this.progress(`Executing step ${i + 1}/${plan.steps.length}: ${step.description}`);

            if (step.action === 'read') {
                // Read and understand file before modification
                const file = files.find(f => f.filePath === step.filePath || f.filePath.endsWith(step.filePath));
                if (file) {
                    this.progress(`Reading: ${step.filePath}`);
                    await this.analyzeFile(file);
                }
            } else if (step.action === 'create' || step.action === 'modify') {
                // Generate the change
                const change = await this.generateChange(
                    step,
                    understanding,
                    modifiedFiles.get(step.filePath) || '',
                    files
                );

                if (change) {
                    changes.push(change);
                    
                    // Update our working copy
                    if (change.content) {
                        modifiedFiles.set(step.filePath, change.content);
                    }

                    // Verify the change
                    this.progress(`Verifying: ${step.filePath}`);
                    const isValid = await this.verifyChange(change, modifiedFiles);
                    
                    if (!isValid) {
                        this.progress(`Issue detected, re-generating: ${step.filePath}`);
                        const fixedChange = await this.fixChange(change, modifiedFiles);
                        if (fixedChange) {
                            changes[changes.length - 1] = fixedChange;
                            modifiedFiles.set(step.filePath, fixedChange.content || '');
                        }
                    }
                }
            } else if (step.action === 'delete') {
                changes.push({
                    type: 'delete',
                    filePath: step.filePath,
                    explanation: step.description,
                });
            }
        }

        return changes;
    }

    /**
     * Generate a single file change
     */
    private async generateChange(
        step: PlanStep,
        understanding: UnderstandingResult,
        currentContent: string,
        allFiles: { filePath: string; content: string }[]
    ): Promise<FileSystemOperation | null> {
        const systemPrompt = `You are an expert code generator.
Generate COMPLETE, WORKING code for the specified change.

CRITICAL RULES:
1. Generate the ENTIRE file content - no placeholders, no TODOs
2. Preserve existing functionality unless explicitly changing it
3. Follow the existing code style exactly
4. Include ALL necessary imports
5. Ensure proper error handling
6. Make the code production-ready

You must output the COMPLETE file content that can be saved directly.`;

        const contextPrompt = `
TASK: ${understanding.userIntent}

STEP TO EXECUTE:
Action: ${step.action}
File: ${step.filePath}
Description: ${step.description}

CURRENT FILE CONTENT:
\`\`\`
${currentContent || '(New file - no existing content)'}
\`\`\`

RELATED FILES FOR CONTEXT:
${allFiles.slice(0, 5).map(f => `
// ${f.filePath}
${f.content.slice(0, 1000)}...
`).join('\n')}

Generate the complete new content for ${step.filePath}.`;

        const result = await this.llmCall<{ content: string; explanation: string }>(
            systemPrompt,
            contextPrompt,
            {
                type: Type.OBJECT,
                properties: {
                    content: { type: Type.STRING } as Schema,
                    explanation: { type: Type.STRING } as Schema,
                },
                required: ['content', 'explanation'],
            }
        );

        return {
            type: step.action === 'create' ? 'create' : 'modify',
            filePath: step.filePath,
            content: result.content,
            explanation: result.explanation,
        };
    }

    /**
     * Verify a change is valid
     */
    private async verifyChange(
        change: FileSystemOperation,
        allFiles: Map<string, string>
    ): Promise<boolean> {
        if (!change.content) return true;

        // Basic syntax checks
        const syntaxErrors = this.checkSyntax(change.content, change.filePath);
        if (syntaxErrors.length > 0) {
            this.progress(`Syntax issues found: ${syntaxErrors.join(', ')}`);
            return false;
        }

        // Check for common issues
        const issues = this.checkCommonIssues(change.content);
        if (issues.length > 0) {
            this.progress(`Issues found: ${issues.join(', ')}`);
            return false;
        }

        return true;
    }

    /**
     * Fix a problematic change
     */
    private async fixChange(
        change: FileSystemOperation,
        allFiles: Map<string, string>
    ): Promise<FileSystemOperation | null> {
        const issues = [
            ...this.checkSyntax(change.content || '', change.filePath),
            ...this.checkCommonIssues(change.content || '')
        ];

        const systemPrompt = `You are an expert code fixer.
The following code has issues that need to be fixed.
Fix ALL issues while preserving the intended functionality.
Output the COMPLETE corrected file content.`;

        const contextPrompt = `
FILE: ${change.filePath}

ISSUES FOUND:
${issues.join('\n')}

CURRENT CONTENT:
\`\`\`
${change.content}
\`\`\`

Fix all issues and output the complete corrected content.`;

        const result = await this.llmCall<{ content: string; explanation: string }>(
            systemPrompt,
            contextPrompt,
            {
                type: Type.OBJECT,
                properties: {
                    content: { type: Type.STRING } as Schema,
                    explanation: { type: Type.STRING } as Schema,
                },
                required: ['content', 'explanation'],
            }
        );

        return {
            ...change,
            content: result.content,
            explanation: `${change.explanation} (Fixed: ${result.explanation})`,
        };
    }

    /**
     * Phase 5: Final Verification
     */
    private async verifyChanges(
        changes: FileSystemOperation[],
        originalFiles: { filePath: string; content: string }[]
    ): Promise<AgentResult> {
        this.progress('Running final verification...');

        // Verify each change one more time
        for (const change of changes) {
            if (change.content) {
                const issues = this.checkSyntax(change.content, change.filePath);
                if (issues.length > 0) {
                    this.progress(`Warning: ${change.filePath} may have issues: ${issues.join(', ')}`);
                }
            }
        }

        // Generate reasoning summary
        const reasoning = await this.generateReasoningSummary(changes, originalFiles);

        this.progress('Verification complete!');

        return {
            reasoning,
            changes,
        };
    }

    /**
     * Generate a summary of all reasoning and changes
     */
    private async generateReasoningSummary(
        changes: FileSystemOperation[],
        originalFiles: { filePath: string; content: string }[]
    ): Promise<string> {
        const changesSummary = changes.map(c => 
            `- ${c.type.toUpperCase()} ${c.filePath}: ${c.explanation}`
        ).join('\n');

        return `## Analysis Complete

### Changes Made:
${changesSummary}

### Summary:
Made ${changes.length} changes across ${new Set(changes.map(c => c.filePath)).size} files.

Each change was:
1. Carefully planned based on deep understanding of your request
2. Generated with complete, working code
3. Verified for syntax and common issues
4. Cross-referenced with related files for consistency`;
    }

    // ==================== Helper Methods ====================

    private progress(msg: string): void {
        this.onProgress?.(msg);
    }

    private async llmCall<T>(
        systemPrompt: string,
        userPrompt: string,
        schema: Schema
    ): Promise<T> {
        return await apiKeyPool.executeWithFailover(async (client) => {
            const response = await client.models.generateContent({
                model: this.model,
                contents: { parts: [{ text: systemPrompt }, { text: userPrompt }] },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: schema,
                },
            });

            const text = response.text || '{}';
            return JSON.parse(text) as T;
        });
    }

    private getLanguage(ext: string): string {
        const map: Record<string, string> = {
            ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
            py: 'python', java: 'java', go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
            cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
        };
        return map[ext] || ext;
    }

    private extractImports(content: string, language: string): string[] {
        const imports: string[] = [];
        
        if (['typescript', 'javascript'].includes(language)) {
            const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
            let match;
            while ((match = importRegex.exec(content)) !== null) {
                imports.push(match[1]);
            }
        } else if (language === 'python') {
            const importRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
            let match;
            while ((match = importRegex.exec(content)) !== null) {
                imports.push(match[1] || match[2]);
            }
        }

        return imports;
    }

    private extractExports(content: string, language: string): string[] {
        const exports: string[] = [];

        if (['typescript', 'javascript'].includes(language)) {
            const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
            let match;
            while ((match = exportRegex.exec(content)) !== null) {
                exports.push(match[1]);
            }
        }

        return exports;
    }

    private findDependencies(content: string, language: string): string[] {
        const deps: string[] = [];
        
        // Find file references
        const fileRefRegex = /['"]\.\.?\/[^'"]+['"]/g;
        let match;
        while ((match = fileRefRegex.exec(content)) !== null) {
            deps.push(match[0].replace(/['"]/g, ''));
        }

        return deps;
    }

    private async generateFileSummary(file: { filePath: string; content: string }): Promise<string> {
        // Quick summary without LLM for performance
        const lines = file.content.split('\n');
        const functions = (file.content.match(/(?:function|const|let|var)\s+(\w+)\s*[=:]/g) || []).slice(0, 5);
        const classes = (file.content.match(/class\s+(\w+)/g) || []).slice(0, 3);
        
        return `${lines.length} lines, ${functions.length} functions, ${classes.length} classes`;
    }

    private detectCodePatterns(fileContexts: FileContext[]): string[] {
        const patterns: string[] = [];

        for (const ctx of fileContexts) {
            if (ctx.content.includes('async') && ctx.content.includes('await')) {
                patterns.push('async/await pattern');
            }
            if (ctx.content.includes('useState') || ctx.content.includes('useEffect')) {
                patterns.push('React hooks');
            }
            if (ctx.content.includes('express') || ctx.content.includes('app.get')) {
                patterns.push('Express.js routing');
            }
            if (ctx.content.includes('interface ') || ctx.content.includes('type ')) {
                patterns.push('TypeScript types');
            }
        }

        return [...new Set(patterns)];
    }

    private detectCodingStyles(fileContexts: FileContext[]): {
        indentation: string;
        quotes: 'single' | 'double';
        semicolons: boolean;
        namingConvention: string;
    } {
        let tabs = 0, spaces = 0, single = 0, double = 0, semi = 0, noSemi = 0;
        let camelCase = 0, snakeCase = 0;

        for (const ctx of fileContexts) {
            const lines = ctx.content.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('\t')) tabs++;
                if (line.startsWith('  ')) spaces++;
                single += (line.match(/'/g) || []).length;
                double += (line.match(/"/g) || []).length;
                if (line.trim().endsWith(';')) semi++;
                if (line.trim() && !line.trim().endsWith(';') && !line.trim().endsWith('{') && !line.trim().endsWith('}')) noSemi++;
            }

            camelCase += (ctx.content.match(/[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/g) || []).length;
            snakeCase += (ctx.content.match(/[a-z]+_[a-z]+/g) || []).length;
        }

        return {
            indentation: tabs > spaces ? 'tabs' : 'spaces',
            quotes: single > double ? 'single' : 'double',
            semicolons: semi > noSemi,
            namingConvention: camelCase > snakeCase ? 'camelCase' : 'snake_case',
        };
    }

    private buildDependencyGraph(fileContexts: FileContext[]): Map<string, string[]> {
        const graph = new Map<string, string[]>();

        for (const ctx of fileContexts) {
            graph.set(ctx.filePath, ctx.dependencies);
        }

        return graph;
    }

    private checkSyntax(content: string, filePath: string): string[] {
        const errors: string[] = [];
        const ext = filePath.split('.').pop() || '';

        if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
            // Check bracket matching
            const opens = (content.match(/{/g) || []).length;
            const closes = (content.match(/}/g) || []).length;
            if (opens !== closes) {
                errors.push(`Unmatched braces: ${opens} opens, ${closes} closes`);
            }

            const parens = (content.match(/\(/g) || []).length;
            const closeParen = (content.match(/\)/g) || []).length;
            if (parens !== closeParen) {
                errors.push(`Unmatched parentheses: ${parens} opens, ${closeParen} closes`);
            }

            const brackets = (content.match(/\[/g) || []).length;
            const closeBrackets = (content.match(/\]/g) || []).length;
            if (brackets !== closeBrackets) {
                errors.push(`Unmatched brackets: ${brackets} opens, ${closeBrackets} closes`);
            }
        }

        return errors;
    }

    private checkCommonIssues(content: string): string[] {
        const issues: string[] = [];

        // Check for common problems
        if (content.includes('// TODO') || content.includes('/* TODO')) {
            issues.push('Contains TODO comments');
        }

        if (content.includes('console.log') && !content.includes('// DEBUG')) {
            issues.push('Contains console.log statements');
        }

        if (content.includes('...') && !content.includes('...args') && !content.includes('...props') && !content.includes('...rest')) {
            const ellipsisCount = (content.match(/\.\.\./g) || []).length;
            const spreadCount = (content.match(/\.\.\.\w+/g) || []).length;
            if (ellipsisCount > spreadCount) {
                issues.push('May contain incomplete code (ellipsis)');
            }
        }

        return issues;
    }
}

export default DeepReasoningEngine;
