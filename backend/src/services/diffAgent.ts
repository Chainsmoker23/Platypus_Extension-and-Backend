/**
 * Diff Agent - Patch-Based Editing System
 * 
 * This implements Cursor-like precise editing:
 * 1. Generate small, targeted diffs (not full file rewrites)
 * 2. Line-level patch hunks
 * 3. Multi-file consistency checking
 * 4. Safe atomic patch application
 * 5. Easy rollback and error correction
 */

import { GoogleGenAI } from '@google/genai';
import * as Diff from 'diff';

// ============ Types ============

export interface PatchHunk {
  id: string;
  startLine: number;      // 1-based line number where change starts
  endLine: number;        // 1-based line number where change ends
  oldLines: string[];     // Original lines being replaced
  newLines: string[];     // New lines to insert
  contextBefore: string[];  // 3 lines before for matching
  contextAfter: string[];   // 3 lines after for matching
}

export interface FilePatch {
  id: string;
  filePath: string;
  hunks: PatchHunk[];
  originalChecksum: string;
  description: string;
  verified: boolean;
  applied: boolean;
  appliedAt?: number;
}

export interface DiffResult {
  success: boolean;
  patches: FilePatch[];
  errors: string[];
  warnings: string[];
}

export interface ApplyResult {
  success: boolean;
  filePath: string;
  newContent: string;
  hunksApplied: number;
  hunksFailed: number;
  errors: string[];
}

// ============ Diff Agent ============

export class DiffAgent {
  private model: string;
  private onProgress?: (msg: string) => void;

  constructor(model: string = 'gemini-2.5-flash', onProgress?: (msg: string) => void) {
    this.model = model;
    this.onProgress = onProgress;
  }

  /**
   * Generate patches for a specific change
   * Instead of "here's the full new file", we get "here are the specific lines to change"
   */
  async generatePatch(
    filePath: string,
    fileContent: string,
    changeDescription: string,
    lineHints?: number[],
    codeReferences?: string[]
  ): Promise<FilePatch> {
    const client = this.getClient();
    const lines = fileContent.split('\n');
    
    this.onProgress?.(`Generating targeted patch for ${filePath}...`);

    // Extract relevant context around line hints
    const focusContext = lineHints && lineHints.length > 0
      ? this.extractFocusContext(lines, lineHints)
      : '';

    const systemPrompt = `You are a precise code editor. Generate a MINIMAL DIFF for the requested change.

CRITICAL RULES:
1. Only modify the EXACT lines that need to change
2. DO NOT rewrite the entire file
3. DO NOT include unchanged lines in your output
4. Preserve exact indentation and formatting
5. Include 3 lines of context before and after for matching

OUTPUT FORMAT (JSON):
{
  "hunks": [
    {
      "startLine": 42,           // 1-based line number
      "endLine": 45,             // Last line being modified
      "oldLines": [              // Exact original lines
        "  const x = 1;",
        "  const y = 2;"
      ],
      "newLines": [              // New replacement lines
        "  const x = calculateValue();",
        "  const y = x * 2;"
      ],
      "contextBefore": [         // 3 lines before for matching
        "",
        "function example() {",
        "  // Setup"
      ],
      "contextAfter": [          // 3 lines after for matching
        "  return x + y;",
        "}",
        ""
      ]
    }
  ],
  "description": "Brief description of what changed"
}

Return ONLY valid JSON. Multiple hunks allowed for non-contiguous changes.`;

    const userPrompt = `
FILE: ${filePath}
CHANGE NEEDED: ${changeDescription}
${codeReferences?.length ? `SYMBOLS TO MODIFY: ${codeReferences.join(', ')}` : ''}

CURRENT FILE CONTENT (with line numbers):
${lines.map((line, i) => `${(i + 1).toString().padStart(4, ' ')} | ${line}`).join('\n')}

${focusContext ? `
FOCUS AREA:
${focusContext}
` : ''}

Generate a minimal patch that makes ONLY the necessary changes.`;

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,  // Low temp for precise edits
          maxOutputTokens: 4000,
        },
      });

      const text = response.text || '{}';
      let parsed: { hunks: any[]; description: string };
      
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Try to extract JSON
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw new Error('Failed to parse patch response');
        }
      }

      const hunks: PatchHunk[] = (parsed.hunks || []).map((h: any, idx: number) => ({
        id: `hunk-${idx}`,
        startLine: h.startLine || 1,
        endLine: h.endLine || h.startLine || 1,
        oldLines: h.oldLines || [],
        newLines: h.newLines || [],
        contextBefore: h.contextBefore || [],
        contextAfter: h.contextAfter || [],
      }));

      return {
        id: `patch-${Date.now()}`,
        filePath,
        hunks,
        originalChecksum: this.checksum(fileContent),
        description: parsed.description || changeDescription,
        verified: false,
        applied: false,
      };

    } catch (error: any) {
      console.error('[DiffAgent] Failed to generate patch:', error);
      throw error;
    }
  }

  /**
   * Verify a patch can be applied correctly
   */
  verifyPatch(patch: FilePatch, fileContent: string): {
    valid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const lines = fileContent.split('\n');

    for (const hunk of patch.hunks) {
      // Check line range validity
      if (hunk.startLine < 1 || hunk.startLine > lines.length) {
        issues.push(`Hunk ${hunk.id}: Start line ${hunk.startLine} out of range (file has ${lines.length} lines)`);
        continue;
      }

      if (hunk.endLine < hunk.startLine || hunk.endLine > lines.length) {
        issues.push(`Hunk ${hunk.id}: End line ${hunk.endLine} invalid`);
        continue;
      }

      // Verify old lines match
      const actualOldLines = lines.slice(hunk.startLine - 1, hunk.endLine);
      if (!this.linesMatch(actualOldLines, hunk.oldLines)) {
        issues.push(`Hunk ${hunk.id}: Old lines don't match current file content at lines ${hunk.startLine}-${hunk.endLine}`);
        
        // Try to find the correct location by context matching
        const foundLine = this.findByContext(lines, hunk.contextBefore, hunk.oldLines);
        if (foundLine !== -1) {
          suggestions.push(`Hunk ${hunk.id}: Content might be at line ${foundLine + 1} instead`);
        }
      }

      // Verify context matching
      if (hunk.contextBefore.length > 0) {
        const beforeIdx = hunk.startLine - 1 - hunk.contextBefore.length;
        if (beforeIdx >= 0) {
          const actualBefore = lines.slice(beforeIdx, hunk.startLine - 1);
          if (!this.linesMatch(actualBefore, hunk.contextBefore)) {
            suggestions.push(`Hunk ${hunk.id}: Context before doesn't match exactly`);
          }
        }
      }
    }

    // Check for overlapping hunks
    const sortedHunks = [...patch.hunks].sort((a, b) => a.startLine - b.startLine);
    for (let i = 0; i < sortedHunks.length - 1; i++) {
      if (sortedHunks[i].endLine >= sortedHunks[i + 1].startLine) {
        issues.push(`Hunks ${sortedHunks[i].id} and ${sortedHunks[i + 1].id} overlap`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  /**
   * Apply a patch to file content
   */
  applyPatch(patch: FilePatch, fileContent: string): ApplyResult {
    const lines = fileContent.split('\n');
    const errors: string[] = [];
    let hunksApplied = 0;
    let hunksFailed = 0;

    // Sort hunks by line number (apply from bottom to top to preserve line numbers)
    const sortedHunks = [...patch.hunks].sort((a, b) => b.startLine - a.startLine);

    for (const hunk of sortedHunks) {
      try {
        // Verify old lines match (with fuzzy matching)
        const actualOldLines = lines.slice(hunk.startLine - 1, hunk.endLine);
        
        if (this.linesMatch(actualOldLines, hunk.oldLines, true)) {
          // Replace the lines
          lines.splice(
            hunk.startLine - 1,
            hunk.endLine - hunk.startLine + 1,
            ...hunk.newLines
          );
          hunksApplied++;
          this.onProgress?.(`Applied hunk at lines ${hunk.startLine}-${hunk.endLine}`);
        } else {
          // Try context-based matching
          const foundLine = this.findByContext(lines, hunk.contextBefore, hunk.oldLines);
          if (foundLine !== -1) {
            lines.splice(
              foundLine,
              hunk.oldLines.length,
              ...hunk.newLines
            );
            hunksApplied++;
            this.onProgress?.(`Applied hunk using context matching at line ${foundLine + 1}`);
          } else {
            errors.push(`Hunk at lines ${hunk.startLine}-${hunk.endLine} couldn't be matched`);
            hunksFailed++;
          }
        }
      } catch (e: any) {
        errors.push(`Failed to apply hunk at lines ${hunk.startLine}-${hunk.endLine}: ${e.message}`);
        hunksFailed++;
      }
    }

    return {
      success: hunksFailed === 0,
      filePath: patch.filePath,
      newContent: lines.join('\n'),
      hunksApplied,
      hunksFailed,
      errors,
    };
  }

  /**
   * Generate a unified diff string (for display/preview)
   */
  generateUnifiedDiff(
    filePath: string,
    originalContent: string,
    newContent: string
  ): string {
    return Diff.createPatch(
      filePath,
      originalContent,
      newContent,
      'original',
      'modified'
    );
  }

  /**
   * Parse a unified diff string back into patches
   */
  parseUnifiedDiff(diffString: string): FilePatch[] {
    const patches: FilePatch[] = [];
    
    // Use diff library to parse
    const parsedPatches = Diff.parsePatch(diffString);
    
    for (const parsed of parsedPatches) {
      const hunks: PatchHunk[] = (parsed.hunks || []).map((h, idx) => ({
        id: `hunk-${idx}`,
        startLine: h.oldStart,
        endLine: h.oldStart + h.oldLines - 1,
        oldLines: h.lines.filter(l => l.startsWith('-')).map(l => l.slice(1)),
        newLines: h.lines.filter(l => l.startsWith('+')).map(l => l.slice(1)),
        contextBefore: h.lines.slice(0, 3).filter(l => l.startsWith(' ')).map(l => l.slice(1)),
        contextAfter: h.lines.slice(-3).filter(l => l.startsWith(' ')).map(l => l.slice(1)),
      }));

      patches.push({
        id: `patch-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        filePath: parsed.oldFileName?.replace(/^[ab]\//, '') || parsed.newFileName?.replace(/^[ab]\//, '') || 'unknown',
        hunks,
        originalChecksum: '',
        description: 'Parsed from unified diff',
        verified: false,
        applied: false,
      });
    }

    return patches;
  }

  /**
   * Create a rollback patch (reverse of applied patch)
   */
  createRollbackPatch(patch: FilePatch): FilePatch {
    const rollbackHunks: PatchHunk[] = patch.hunks.map(h => ({
      ...h,
      id: `rollback-${h.id}`,
      oldLines: h.newLines,  // Swap old and new
      newLines: h.oldLines,
    }));

    return {
      id: `rollback-${patch.id}`,
      filePath: patch.filePath,
      hunks: rollbackHunks,
      originalChecksum: patch.originalChecksum,
      description: `Rollback: ${patch.description}`,
      verified: false,
      applied: false,
    };
  }

  // ============ Multi-file Consistency ============

  /**
   * Check if multiple patches are consistent (imports, exports, types match)
   */
  async checkMultiFileConsistency(
    patches: FilePatch[],
    fileContents: Map<string, string>
  ): Promise<{
    consistent: boolean;
    issues: Array<{
      type: 'import' | 'export' | 'type' | 'reference';
      file1: string;
      file2: string;
      description: string;
    }>;
  }> {
    const issues: Array<{
      type: 'import' | 'export' | 'type' | 'reference';
      file1: string;
      file2: string;
      description: string;
    }> = [];

    // Apply patches temporarily to check consistency
    const patchedContents = new Map<string, string>();
    for (const patch of patches) {
      const original = fileContents.get(patch.filePath) || '';
      const result = this.applyPatch(patch, original);
      if (result.success) {
        patchedContents.set(patch.filePath, result.newContent);
      }
    }

    // Extract exports from all patched files
    const exports = new Map<string, Set<string>>();
    for (const [path, content] of patchedContents) {
      exports.set(path, this.extractExports(content));
    }

    // Check imports match exports
    for (const [path, content] of patchedContents) {
      const imports = this.extractImports(content);
      for (const [importPath, symbols] of imports) {
        const resolvedPath = this.resolveImportPath(path, importPath, Array.from(patchedContents.keys()));
        if (resolvedPath && exports.has(resolvedPath)) {
          const availableExports = exports.get(resolvedPath)!;
          for (const symbol of symbols) {
            if (!availableExports.has(symbol) && symbol !== '*' && symbol !== 'default') {
              issues.push({
                type: 'import',
                file1: path,
                file2: resolvedPath,
                description: `Symbol '${symbol}' imported but not exported`,
              });
            }
          }
        }
      }
    }

    return {
      consistent: issues.length === 0,
      issues,
    };
  }

  // ============ Helper Methods ============

  private getClient(): GoogleGenAI {
    const apiKey = process.env.AGENT_API_KEY;
    if (!apiKey) throw new Error('AGENT_API_KEY not set');
    return new GoogleGenAI({ apiKey });
  }

  private checksum(content: string): string {
    // Simple hash for content verification
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private extractFocusContext(lines: string[], lineHints: number[]): string {
    const minLine = Math.max(0, Math.min(...lineHints) - 5);
    const maxLine = Math.min(lines.length, Math.max(...lineHints) + 5);
    return lines.slice(minLine, maxLine)
      .map((line, i) => `${(minLine + i + 1).toString().padStart(4, ' ')} | ${line}`)
      .join('\n');
  }

  private linesMatch(actual: string[], expected: string[], fuzzy: boolean = false): boolean {
    if (actual.length !== expected.length) return false;
    
    for (let i = 0; i < actual.length; i++) {
      if (fuzzy) {
        // Fuzzy matching - ignore whitespace differences
        if (actual[i].trim() !== expected[i].trim()) return false;
      } else {
        if (actual[i] !== expected[i]) return false;
      }
    }
    return true;
  }

  private findByContext(
    lines: string[],
    contextBefore: string[],
    targetLines: string[]
  ): number {
    const searchPattern = [...contextBefore, ...targetLines].map(l => l.trim()).join('\n');
    
    for (let i = 0; i < lines.length - targetLines.length; i++) {
      const windowStart = Math.max(0, i - contextBefore.length);
      const windowEnd = i + targetLines.length;
      const window = lines.slice(windowStart, windowEnd).map(l => l.trim()).join('\n');
      
      if (window.includes(searchPattern) || searchPattern.includes(window)) {
        return i;
      }
    }
    
    return -1;
  }

  private extractExports(content: string): Set<string> {
    const exports = new Set<string>();
    
    // Named exports
    const namedExports = content.matchAll(/export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g);
    for (const match of namedExports) {
      exports.add(match[1]);
    }
    
    // Export { }
    const bracedExports = content.matchAll(/export\s*\{([^}]+)\}/g);
    for (const match of bracedExports) {
      const symbols = match[1].split(',').map(s => s.trim().split(' as ')[0].trim());
      symbols.forEach(s => exports.add(s));
    }
    
    // Default export
    if (/export\s+default/.test(content)) {
      exports.add('default');
    }
    
    return exports;
  }

  private extractImports(content: string): Map<string, string[]> {
    const imports = new Map<string, string[]>();
    
    const importMatches = content.matchAll(/import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))?\s*(?:,\s*(?:\{([^}]+)\}|(\w+)))?\s*from\s+['"]([^'"]+)['"]/g);
    
    for (const match of importMatches) {
      const path = match[6];
      const symbols: string[] = [];
      
      // Named imports in braces
      if (match[1]) {
        symbols.push(...match[1].split(',').map(s => s.trim().split(' as ')[0].trim()));
      }
      // Default import
      if (match[2]) {
        symbols.push('default');
      }
      // Namespace import
      if (match[3]) {
        symbols.push('*');
      }
      // Additional named imports
      if (match[4]) {
        symbols.push(...match[4].split(',').map(s => s.trim().split(' as ')[0].trim()));
      }
      
      imports.set(path, symbols);
    }
    
    return imports;
  }

  private resolveImportPath(fromPath: string, importPath: string, availablePaths: string[]): string | null {
    if (!importPath.startsWith('.')) return null;
    
    const fromDir = fromPath.split('/').slice(0, -1).join('/');
    let resolved = importPath;
    
    // Resolve relative path
    if (importPath.startsWith('./')) {
      resolved = fromDir + '/' + importPath.slice(2);
    } else if (importPath.startsWith('../')) {
      const parts = fromDir.split('/');
      let remaining = importPath;
      while (remaining.startsWith('../')) {
        parts.pop();
        remaining = remaining.slice(3);
      }
      resolved = parts.join('/') + '/' + remaining;
    }
    
    // Try with extensions
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (availablePaths.some(p => p.endsWith(withExt) || p === withExt)) {
        return withExt;
      }
    }
    
    return null;
  }
}

export default DiffAgent;
