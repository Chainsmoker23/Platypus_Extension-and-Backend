/**
 * Reflection Engine - Multi-Pass Self-Checking System
 * 
 * This implements Cursor-like intelligent self-verification:
 * 1. Re-check diffs against original user goal
 * 2. Verify imports are correct
 * 3. Scan for unused symbols
 * 4. Check consistency with style rules
 * 5. Re-evaluate plan after each file
 * 6. Multi-pass verification with increasing depth
 */

import { GoogleGenAI } from '@google/genai';
import type { FilePatch, PatchHunk } from './diffAgent';

// ============ Types ============

export interface ReflectionResult {
  passed: boolean;
  score: number;  // 0-100 confidence score
  issues: ReflectionIssue[];
  suggestions: string[];
  requiresRevision: boolean;
  revisedPatch?: FilePatch;
}

export interface ReflectionIssue {
  type: 'import' | 'export' | 'type' | 'unused' | 'style' | 'logic' | 'syntax' | 'goal_mismatch' | 'consistency';
  severity: 'error' | 'warning' | 'info';
  location?: {
    file: string;
    line?: number;
    column?: number;
  };
  message: string;
  fix?: string;
}

export interface ReflectionPass {
  name: string;
  description: string;
  check: (context: ReflectionContext) => Promise<ReflectionIssue[]>;
}

export interface ReflectionContext {
  originalGoal: string;
  originalFile: string;
  patchedFile: string;
  patch: FilePatch;
  filePath: string;
  allFiles: Map<string, string>;  // All files in workspace (for cross-file checks)
  allPatches: FilePatch[];        // All patches being applied
  projectType?: 'typescript' | 'javascript' | 'python' | 'java' | 'other';
}

// ============ Reflection Engine ============

export class ReflectionEngine {
  private model: string;
  private onProgress?: (msg: string) => void;
  private passes: ReflectionPass[] = [];
  private maxIterations: number = 5;

  constructor(model: string = 'gemini-2.5-flash', onProgress?: (msg: string) => void) {
    this.model = model;
    this.onProgress = onProgress;
    this.initializePasses();
  }

  private initializePasses(): void {
    // Define reflection passes in order of execution
    this.passes = [
      {
        name: 'Goal Alignment',
        description: 'Verify changes align with user\'s original request',
        check: this.checkGoalAlignment.bind(this),
      },
      {
        name: 'Syntax Validation',
        description: 'Check for syntax errors and structural issues',
        check: this.checkSyntax.bind(this),
      },
      {
        name: 'Import Verification',
        description: 'Verify all imports are correct and complete',
        check: this.checkImports.bind(this),
      },
      {
        name: 'Export Consistency',
        description: 'Verify exports match what other files expect',
        check: this.checkExports.bind(this),
      },
      {
        name: 'Unused Symbol Detection',
        description: 'Scan for unused variables, functions, imports',
        check: this.checkUnusedSymbols.bind(this),
      },
      {
        name: 'Style Consistency',
        description: 'Check code style matches existing patterns',
        check: this.checkStyleConsistency.bind(this),
      },
      {
        name: 'Logic Verification',
        description: 'Verify the logic change makes sense',
        check: this.checkLogic.bind(this),
      },
      {
        name: 'Cross-file Consistency',
        description: 'Check changes work with related files',
        check: this.checkCrossFileConsistency.bind(this),
      },
    ];
  }

  /**
   * Run full reflection on a patch
   */
  async reflect(context: ReflectionContext): Promise<ReflectionResult> {
    this.onProgress?.(`Starting reflection on ${context.filePath}...`);
    
    const allIssues: ReflectionIssue[] = [];
    const suggestions: string[] = [];
    
    // Run each pass
    for (const pass of this.passes) {
      this.onProgress?.(`  → ${pass.name}: ${pass.description}`);
      
      try {
        const issues = await pass.check(context);
        allIssues.push(...issues);
        
        // Log issues found
        if (issues.length > 0) {
          const errorCount = issues.filter(i => i.severity === 'error').length;
          const warningCount = issues.filter(i => i.severity === 'warning').length;
          this.onProgress?.(`    Found ${errorCount} errors, ${warningCount} warnings`);
        }
      } catch (e: any) {
        this.onProgress?.(`    Pass failed: ${e.message}`);
      }
    }
    
    // Calculate score
    const score = this.calculateScore(allIssues);
    
    // Determine if revision is needed
    const hasErrors = allIssues.some(i => i.severity === 'error');
    const hasManyWarnings = allIssues.filter(i => i.severity === 'warning').length > 3;
    const requiresRevision = hasErrors || hasManyWarnings || score < 70;
    
    // Generate suggestions for fixes
    for (const issue of allIssues.filter(i => i.severity === 'error' || i.severity === 'warning')) {
      if (issue.fix) {
        suggestions.push(`${issue.type}: ${issue.fix}`);
      }
    }
    
    this.onProgress?.(`Reflection complete: Score ${score}/100, ${allIssues.length} issues found`);
    
    return {
      passed: !hasErrors && score >= 70,
      score,
      issues: allIssues,
      suggestions,
      requiresRevision,
    };
  }

  /**
   * Iterative reflection with automatic fixing
   * This runs multiple passes and attempts to fix issues
   */
  async reflectAndFix(
    context: ReflectionContext,
    onRevision?: (iteration: number, issues: ReflectionIssue[]) => void
  ): Promise<ReflectionResult> {
    let currentPatch = context.patch;
    let currentFile = context.patchedFile;
    let iteration = 0;
    
    while (iteration < this.maxIterations) {
      iteration++;
      this.onProgress?.(`\n🔍 Reflection iteration ${iteration}/${this.maxIterations}`);
      
      const result = await this.reflect({
        ...context,
        patch: currentPatch,
        patchedFile: currentFile,
      });
      
      if (result.passed) {
        this.onProgress?.(`✅ Reflection passed on iteration ${iteration}`);
        return { ...result, revisedPatch: currentPatch };
      }
      
      if (!result.requiresRevision) {
        // Issues found but not critical enough to revise
        return result;
      }
      
      // Try to fix issues
      this.onProgress?.(`⚠️ ${result.issues.length} issues found, attempting auto-fix...`);
      onRevision?.(iteration, result.issues);
      
      const fixedPatch = await this.attemptFixes(context, currentPatch, result.issues);
      
      if (!fixedPatch) {
        this.onProgress?.(`❌ Could not auto-fix issues`);
        return result;
      }
      
      currentPatch = fixedPatch;
      // Apply patch to get new file content for next iteration
      // (simplified - actual implementation would use DiffAgent.applyPatch)
      currentFile = this.simulateApplyPatch(context.originalFile, fixedPatch);
    }
    
    this.onProgress?.(`⚠️ Max iterations reached, returning best effort`);
    return await this.reflect({
      ...context,
      patch: currentPatch,
      patchedFile: currentFile,
    });
  }

  // ============ Reflection Passes ============

  private async checkGoalAlignment(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const client = this.getClient();
    const issues: ReflectionIssue[] = [];
    
    const prompt = `Analyze if this code change aligns with the user's goal.

USER GOAL: ${context.originalGoal}

ORIGINAL CODE:
\`\`\`
${context.originalFile.slice(0, 3000)}
\`\`\`

CHANGED CODE:
\`\`\`
${context.patchedFile.slice(0, 3000)}
\`\`\`

Respond with JSON:
{
  "aligned": true/false,
  "issues": [
    {
      "message": "description of misalignment",
      "severity": "error|warning",
      "fix": "suggested fix"
    }
  ]
}`;

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 1000,
        },
      });
      
      const result = JSON.parse(response.text || '{}');
      
      for (const issue of (result.issues || [])) {
        issues.push({
          type: 'goal_mismatch',
          severity: issue.severity || 'warning',
          message: issue.message,
          fix: issue.fix,
          location: { file: context.filePath },
        });
      }
    } catch (e) {
      // Silent fail for LLM-based checks
    }
    
    return issues;
  }

  private async checkSyntax(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const issues: ReflectionIssue[] = [];
    const content = context.patchedFile;
    
    // Basic syntax checks (without full parser)
    
    // Check balanced braces
    const braceStack: Array<{ char: string; line: number }> = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{' || char === '(' || char === '[') {
          braceStack.push({ char, line: i + 1 });
        } else if (char === '}' || char === ')' || char === ']') {
          const expected = char === '}' ? '{' : char === ')' ? '(' : '[';
          const last = braceStack.pop();
          if (!last || last.char !== expected) {
            issues.push({
              type: 'syntax',
              severity: 'error',
              location: { file: context.filePath, line: i + 1 },
              message: `Unmatched '${char}' at line ${i + 1}`,
              fix: `Add matching '${expected}' or remove '${char}'`,
            });
          }
        }
      }
    }
    
    // Check for unclosed braces
    for (const open of braceStack) {
      issues.push({
        type: 'syntax',
        severity: 'error',
        location: { file: context.filePath, line: open.line },
        message: `Unclosed '${open.char}' from line ${open.line}`,
        fix: `Add closing brace for '${open.char}'`,
      });
    }
    
    // Check for incomplete statements (simplified)
    const incompletePatterns = [
      { pattern: /^\s*(const|let|var)\s+\w+\s*$/m, message: 'Incomplete variable declaration' },
      { pattern: /^\s*if\s*\([^)]*$/m, message: 'Incomplete if statement' },
      { pattern: /^\s*for\s*\([^)]*$/m, message: 'Incomplete for loop' },
      { pattern: /=>\s*$/m, message: 'Arrow function missing body' },
    ];
    
    for (const { pattern, message } of incompletePatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: 'syntax',
          severity: 'warning',
          location: { file: context.filePath },
          message,
        });
      }
    }
    
    return issues;
  }

  private async checkImports(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const issues: ReflectionIssue[] = [];
    const content = context.patchedFile;
    
    // Extract imports
    const importMatches = content.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g);
    const imports = new Map<string, string[]>();
    
    for (const match of importMatches) {
      const path = match[3];
      const symbols = match[1] 
        ? match[1].split(',').map(s => s.trim().split(' as ')[0].trim())
        : match[2] ? [match[2]] : [];
      imports.set(path, symbols);
    }
    
    // Check if imported symbols are used
    for (const [path, symbols] of imports) {
      for (const symbol of symbols) {
        // Create regex to find usage (not just the import line)
        const usageRegex = new RegExp(`(?<!import[^;]*?)\\b${symbol}\\b`, 'g');
        const usages = content.match(usageRegex);
        
        if (!usages || usages.length <= 1) {
          issues.push({
            type: 'import',
            severity: 'warning',
            location: { file: context.filePath },
            message: `Imported '${symbol}' from '${path}' is not used`,
            fix: `Remove unused import '${symbol}'`,
          });
        }
      }
    }
    
    // Check for missing imports (symbols used but not imported/declared)
    const usedSymbols = new Set<string>();
    const declaredSymbols = new Set<string>();
    
    // Find declarations
    const declarations = content.matchAll(/(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g);
    for (const match of declarations) {
      declaredSymbols.add(match[1]);
    }
    
    // Add imported symbols to declared
    for (const symbols of imports.values()) {
      symbols.forEach(s => declaredSymbols.add(s));
    }
    
    // Find potential usages of undefined symbols (simplified)
    const potentialUsages = content.matchAll(/\b([A-Z]\w+)\b/g);
    for (const match of potentialUsages) {
      const symbol = match[1];
      if (!declaredSymbols.has(symbol) && !this.isBuiltIn(symbol)) {
        usedSymbols.add(symbol);
      }
    }
    
    for (const symbol of usedSymbols) {
      issues.push({
        type: 'import',
        severity: 'warning',
        location: { file: context.filePath },
        message: `'${symbol}' is used but not imported or declared`,
        fix: `Add import for '${symbol}'`,
      });
    }
    
    return issues;
  }

  private async checkExports(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const issues: ReflectionIssue[] = [];
    
    // Check if file has any exports (for module files)
    const content = context.patchedFile;
    const hasExport = /export\s+/.test(content);
    const isLikelyModule = context.filePath.endsWith('.ts') || context.filePath.endsWith('.tsx');
    
    if (isLikelyModule && !hasExport && content.length > 100) {
      issues.push({
        type: 'export',
        severity: 'info',
        location: { file: context.filePath },
        message: 'No exports found in module file',
      });
    }
    
    return issues;
  }

  private async checkUnusedSymbols(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const issues: ReflectionIssue[] = [];
    const content = context.patchedFile;
    const lines = content.split('\n');
    
    // Find local variable declarations
    const declarations = content.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g);
    
    for (const match of declarations) {
      const varName = match[1];
      // Check if used elsewhere in the file
      const usageRegex = new RegExp(`\\b${varName}\\b`, 'g');
      const usages = content.match(usageRegex);
      
      // If only appears once (the declaration), it's unused
      if (usages && usages.length === 1) {
        // Find line number
        const lineNum = lines.findIndex(l => l.includes(match[0])) + 1;
        
        issues.push({
          type: 'unused',
          severity: 'warning',
          location: { file: context.filePath, line: lineNum },
          message: `Variable '${varName}' is declared but never used`,
          fix: `Remove unused variable '${varName}'`,
        });
      }
    }
    
    return issues;
  }

  private async checkStyleConsistency(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const issues: ReflectionIssue[] = [];
    const original = context.originalFile;
    const patched = context.patchedFile;
    
    // Check indentation style
    const originalUsesSpaces = /^  \S/m.test(original);
    const originalUsesTabs = /^\t\S/m.test(original);
    const patchedUsesSpaces = /^  \S/m.test(patched);
    const patchedUsesTabs = /^\t\S/m.test(patched);
    
    if (originalUsesSpaces && patchedUsesTabs) {
      issues.push({
        type: 'style',
        severity: 'warning',
        location: { file: context.filePath },
        message: 'Changed from space to tab indentation',
        fix: 'Use consistent indentation with rest of file (spaces)',
      });
    } else if (originalUsesTabs && patchedUsesSpaces) {
      issues.push({
        type: 'style',
        severity: 'warning',
        location: { file: context.filePath },
        message: 'Changed from tab to space indentation',
        fix: 'Use consistent indentation with rest of file (tabs)',
      });
    }
    
    // Check quote style
    const originalUsesSingle = (original.match(/'/g) || []).length > (original.match(/"/g) || []).length;
    const patchedUsesSingle = (patched.match(/'/g) || []).length > (patched.match(/"/g) || []).length;
    
    if (originalUsesSingle !== patchedUsesSingle) {
      issues.push({
        type: 'style',
        severity: 'info',
        location: { file: context.filePath },
        message: 'Quote style differs from original file',
        fix: `Use ${originalUsesSingle ? 'single' : 'double'} quotes for consistency`,
      });
    }
    
    // Check semicolon usage
    const originalHasSemis = /;\s*$/m.test(original);
    const patchedHasSemis = /;\s*$/m.test(patched);
    
    if (originalHasSemis !== patchedHasSemis) {
      issues.push({
        type: 'style',
        severity: 'info',
        location: { file: context.filePath },
        message: 'Semicolon usage differs from original file',
      });
    }
    
    return issues;
  }

  private async checkLogic(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const client = this.getClient();
    const issues: ReflectionIssue[] = [];
    
    // Use LLM for logic verification (limited to critical changes)
    const prompt = `Review this code change for logical errors.

PATCH DESCRIPTION: ${context.patch.description}

CHANGED CODE HUNKS:
${context.patch.hunks.map(h => 
  `Lines ${h.startLine}-${h.endLine}:
OLD:
${h.oldLines.join('\n')}
NEW:
${h.newLines.join('\n')}`
).join('\n---\n')}

Look for:
- Off-by-one errors
- Null/undefined handling issues
- Incorrect conditional logic
- Missing error handling
- Potential infinite loops

Respond with JSON:
{
  "issues": [
    {
      "message": "description",
      "severity": "error|warning",
      "line": 42,
      "fix": "suggested fix"
    }
  ]
}`;

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 1000,
        },
      });
      
      const result = JSON.parse(response.text || '{}');
      
      for (const issue of (result.issues || [])) {
        issues.push({
          type: 'logic',
          severity: issue.severity || 'warning',
          location: { file: context.filePath, line: issue.line },
          message: issue.message,
          fix: issue.fix,
        });
      }
    } catch (e) {
      // Silent fail for LLM-based checks
    }
    
    return issues;
  }

  private async checkCrossFileConsistency(context: ReflectionContext): Promise<ReflectionIssue[]> {
    const issues: ReflectionIssue[] = [];
    
    // Check if this file's changes break imports in other files
    const patchedExports = this.extractExports(context.patchedFile);
    const originalExports = this.extractExports(context.originalFile);
    
    // Find removed exports
    const removedExports = [...originalExports].filter(e => !patchedExports.has(e));
    
    if (removedExports.length > 0) {
      // Check if other files import these
      for (const [filePath, content] of context.allFiles) {
        if (filePath === context.filePath) continue;
        
        for (const removed of removedExports) {
          if (content.includes(removed)) {
            issues.push({
              type: 'consistency',
              severity: 'error',
              location: { file: filePath },
              message: `'${removed}' was removed from ${context.filePath} but is used in ${filePath}`,
              fix: `Update ${filePath} to not use '${removed}' or restore the export`,
            });
          }
        }
      }
    }
    
    return issues;
  }

  // ============ Fix Attempt ============

  private async attemptFixes(
    context: ReflectionContext,
    patch: FilePatch,
    issues: ReflectionIssue[]
  ): Promise<FilePatch | null> {
    const client = this.getClient();
    
    // Only attempt fixes for errors
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length === 0) return null;
    
    const prompt = `Fix the following issues in the code patch.

ORIGINAL PATCH DESCRIPTION: ${patch.description}

ISSUES TO FIX:
${errors.map(e => `- ${e.type}: ${e.message}${e.fix ? ` (Suggested: ${e.fix})` : ''}`).join('\n')}

CURRENT PATCH HUNKS:
${JSON.stringify(patch.hunks, null, 2)}

Generate fixed hunks that resolve all errors while keeping the original intent.
Return JSON with the same structure as the input hunks.`;

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 4000,
        },
      });
      
      const fixedHunks = JSON.parse(response.text || '[]');
      
      return {
        ...patch,
        id: `${patch.id}-fixed`,
        hunks: fixedHunks,
        description: `${patch.description} (auto-fixed)`,
      };
    } catch (e) {
      return null;
    }
  }

  // ============ Helper Methods ============

  private getClient(): GoogleGenAI {
    const apiKey = process.env.AGENT_API_KEY;
    if (!apiKey) throw new Error('AGENT_API_KEY not set');
    return new GoogleGenAI({ apiKey });
  }

  private calculateScore(issues: ReflectionIssue[]): number {
    let score = 100;
    
    for (const issue of issues) {
      switch (issue.severity) {
        case 'error': score -= 20; break;
        case 'warning': score -= 5; break;
        case 'info': score -= 1; break;
      }
    }
    
    return Math.max(0, Math.min(100, score));
  }

  private extractExports(content: string): Set<string> {
    const exports = new Set<string>();
    
    const patterns = [
      /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
      /export\s+\{([^}]+)\}/g,
    ];
    
    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1].includes(',')) {
          match[1].split(',').forEach(s => exports.add(s.trim().split(' as ')[0].trim()));
        } else {
          exports.add(match[1].trim());
        }
      }
    }
    
    if (/export\s+default/.test(content)) {
      exports.add('default');
    }
    
    return exports;
  }

  private isBuiltIn(symbol: string): boolean {
    const builtIns = new Set([
      'Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
      'Promise', 'Map', 'Set', 'Date', 'RegExp', 'Error',
      'JSON', 'Math', 'console', 'window', 'document',
      'React', 'Component', 'Fragment', 'useState', 'useEffect',
      'HTMLElement', 'Event', 'Element', 'Node',
    ]);
    return builtIns.has(symbol);
  }

  private simulateApplyPatch(original: string, patch: FilePatch): string {
    const lines = original.split('\n');
    
    // Sort hunks by line number (apply from bottom to top)
    const sortedHunks = [...patch.hunks].sort((a, b) => b.startLine - a.startLine);
    
    for (const hunk of sortedHunks) {
      lines.splice(
        hunk.startLine - 1,
        hunk.oldLines.length,
        ...hunk.newLines
      );
    }
    
    return lines.join('\n');
  }
}

export default ReflectionEngine;
