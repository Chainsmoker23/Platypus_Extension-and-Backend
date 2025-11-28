
import * as path from 'path';
// FIX: Changed import path from '../types' to the more specific '../types/index' to avoid ambiguity with the empty 'types.ts' file.
import { FileData } from '../types/index';

type AdjacencyList = Map<string, Set<string>>;

export class DependencyGraphService {
    private graph: AdjacencyList = new Map();
    private files: Map<string, string> = new Map();

    constructor(files: FileData[]) {
        for (const file of files) {
            // Normalize paths to use forward slashes for consistency
            const normalizedPath = file.filePath.replace(/\\/g, '/');
            this.files.set(normalizedPath, file.content);
            this.graph.set(normalizedPath, new Set());
        }
        this.buildGraph();
    }

    private buildGraph(): void {
        const importRegex = /import(?:["'\\s]*(?:[\\w*{}\\s,]+)from\\s*)?["'\\s]*([@\\w/\\-.]+?)["'\\s]*;/gm;

        for (const [filePath, content] of this.files.entries()) {
            let match;
            while ((match = importRegex.exec(content)) !== null) {
                const importPath = match[1];
                const resolvedPath = this.resolveImport(importPath, filePath);
                if (resolvedPath && this.graph.has(resolvedPath)) {
                    this.graph.get(filePath)!.add(resolvedPath);
                }
            }
        }
    }

    private resolveImport(importPath: string, importerPath: string): string | null {
        if (!importPath.startsWith('.')) {
            // For now, we only handle relative imports.
            // A real implementation would need to handle node_modules, aliases, etc.
            return null;
        }
        
        const importerDir = path.dirname(importerPath);
        const absolutePath = path.resolve(importerDir, importPath);
        const potentialPaths = [
            absolutePath,
            `${absolutePath}.js`,
            `${absolutePath}.ts`,
            `${absolutePath}.tsx`,
            path.join(absolutePath, 'index.js'),
            path.join(absolutePath, 'index.ts'),
            path.join(absolutePath, 'index.tsx'),
        ].map(p => p.replace(/\\/g, '/')); // Normalize before checking

        for (const p of potentialPaths) {
            if (this.files.has(p)) {
                return p;
            }
        }
        
        return null;
    }

    public findCycles(): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: string[] = [];

        const dfs = (node: string) => {
            visited.add(node);
            recursionStack.add(node);
            path.push(node);

            const neighbors = this.graph.get(node) || [];
            for (const neighbor of neighbors) {
                if (recursionStack.has(neighbor)) {
                    const cycle = path.slice(path.indexOf(neighbor));
                    cycle.push(neighbor);
                    cycles.push(cycle);
                } else if (!visited.has(neighbor)) {
                    dfs(neighbor);
                }
            }
            
            path.pop();
            recursionStack.delete(node);
        };

        for (const node of this.graph.keys()) {
            if (!visited.has(node)) {
                dfs(node);
            }
        }

        return cycles;
    }
}
