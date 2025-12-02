import { v4 as uuidv4 } from 'uuid';
import * as qdrant from './qdrantService';
import * as embedding from './embeddingService';
import type { CodeChunk } from './qdrantService';

const CHUNK_SIZE = 1500; // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks

export interface IndexingProgress {
    phase: 'parsing' | 'chunking' | 'embedding' | 'storing' | 'complete';
    current: number;
    total: number;
    message: string;
}

export interface FileInput {
    filePath: string;
    content: string;
}

export interface RAGContext {
    chunks: qdrant.SearchResult[];
    summary: string;
}

/**
 * Index the entire codebase into Qdrant
 */
export async function indexCodebase(
    workspaceId: string,
    files: FileInput[],
    onProgress?: (progress: IndexingProgress) => void
): Promise<{ chunksIndexed: number; filesProcessed: number }> {
    
    onProgress?.({
        phase: 'parsing',
        current: 0,
        total: files.length,
        message: 'Initializing vector database...',
    });

    // Reset collection for fresh indexing
    await qdrant.resetCollection(workspaceId);

    onProgress?.({
        phase: 'chunking',
        current: 0,
        total: files.length,
        message: 'Parsing and chunking code files...',
    });

    // Parse and chunk all files
    const allChunks: CodeChunk[] = [];
    let filesProcessed = 0;

    for (const file of files) {
        const chunks = chunkFile(file);
        allChunks.push(...chunks);
        filesProcessed++;

        onProgress?.({
            phase: 'chunking',
            current: filesProcessed,
            total: files.length,
            message: `Chunked ${file.filePath} (${chunks.length} chunks)`,
        });
    }

    if (allChunks.length === 0) {
        return { chunksIndexed: 0, filesProcessed };
    }

    onProgress?.({
        phase: 'embedding',
        current: 0,
        total: allChunks.length,
        message: 'Generating embeddings for code chunks...',
    });

    // Prepare texts for embedding
    const textsToEmbed = allChunks.map(chunk =>
        embedding.prepareCodeForEmbedding(chunk.content, chunk.filePath, chunk.type)
    );

    // Generate embeddings with progress tracking
    const embeddings = await embedding.generateEmbeddings(
        textsToEmbed,
        (processed, total) => {
            onProgress?.({
                phase: 'embedding',
                current: processed,
                total,
                message: `Generated ${processed}/${total} embeddings`,
            });
        }
    );

    onProgress?.({
        phase: 'storing',
        current: 0,
        total: allChunks.length,
        message: 'Storing embeddings in vector database...',
    });

    // Store in Qdrant
    await qdrant.upsertChunks(workspaceId, allChunks, embeddings);

    onProgress?.({
        phase: 'complete',
        current: allChunks.length,
        total: allChunks.length,
        message: `Successfully indexed ${allChunks.length} chunks from ${filesProcessed} files`,
    });

    return { chunksIndexed: allChunks.length, filesProcessed };
}

/**
 * Search for relevant code based on a query
 */
export async function searchCodebase(
    workspaceId: string,
    query: string,
    limit: number = 10
): Promise<RAGContext> {
    // Generate embedding for query
    const queryEmbedding = await embedding.generateEmbedding(query);

    // Search Qdrant
    const results = await qdrant.searchSimilar(workspaceId, queryEmbedding, limit);

    // Generate context summary
    const summary = generateContextSummary(results, query);

    return {
        chunks: results,
        summary,
    };
}

/**
 * Get relevant context for a prompt (to be used by the agent)
 */
export async function getContextForPrompt(
    workspaceId: string,
    prompt: string,
    maxChunks: number = 15
): Promise<string> {
    try {
        const stats = await qdrant.getCollectionStats(workspaceId);
        if (!stats.exists || stats.pointsCount === 0) {
            return ''; // No indexed codebase
        }

        const context = await searchCodebase(workspaceId, prompt, maxChunks);
        
        if (context.chunks.length === 0) {
            return '';
        }

        // Format context for LLM
        const contextParts = context.chunks.map((result, idx) => {
            const { chunk, score } = result;
            return `--- Relevant Code #${idx + 1} (score: ${score.toFixed(3)}) ---
File: ${chunk.filePath} (lines ${chunk.startLine}-${chunk.endLine})
Type: ${chunk.type}

\`\`\`${chunk.language}
${chunk.content}
\`\`\``;
        });

        return `
## Retrieved Context from Codebase (RAG)

The following code snippets were retrieved as most relevant to the user's request:

${contextParts.join('\n\n')}

Use this context to provide accurate, codebase-aware responses.
`;
    } catch (error) {
        console.error('[RAG] Error getting context:', error);
        return '';
    }
}

/**
 * Incrementally update index for changed files
 */
export async function updateFileIndex(
    workspaceId: string,
    file: FileInput
): Promise<number> {
    // Delete existing chunks for this file
    await qdrant.deleteFileChunks(workspaceId, file.filePath);

    // Create new chunks
    const chunks = chunkFile(file);
    
    if (chunks.length === 0) {
        return 0;
    }

    // Generate embeddings
    const textsToEmbed = chunks.map(chunk =>
        embedding.prepareCodeForEmbedding(chunk.content, chunk.filePath, chunk.type)
    );
    const embeddings = await embedding.generateEmbeddings(textsToEmbed);

    // Store in Qdrant
    await qdrant.upsertChunks(workspaceId, chunks, embeddings);

    return chunks.length;
}

/**
 * Get indexing status
 */
export async function getIndexStatus(workspaceId: string): Promise<{
    indexed: boolean;
    chunksCount: number;
    status: string;
}> {
    const stats = await qdrant.getCollectionStats(workspaceId);
    return {
        indexed: stats.exists && stats.pointsCount > 0,
        chunksCount: stats.pointsCount,
        status: stats.status,
    };
}

// ============ Helper Functions ============

/**
 * Chunk a file into smaller pieces for embedding
 */
function chunkFile(file: FileInput): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const content = file.content;
    const lines = content.split('\n');
    const extension = file.filePath.split('.').pop() || '';
    const language = getLanguageFromExtension(extension);

    // Try to chunk by logical units (functions, classes) first
    const logicalChunks = extractLogicalChunks(content, file.filePath, language);
    
    if (logicalChunks.length > 0) {
        chunks.push(...logicalChunks);
    } else {
        // Fall back to sliding window chunking
        chunks.push(...slidingWindowChunk(content, file.filePath, language));
    }

    return chunks;
}

/**
 * Extract logical code chunks (functions, classes, etc.)
 */
function extractLogicalChunks(content: string, filePath: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    // Patterns for different languages
    const patterns: Record<string, RegExp[]> = {
        TypeScript: [
            /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
            /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
            /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
            /^(?:export\s+)?interface\s+(\w+)/,
            /^(?:export\s+)?type\s+(\w+)/,
        ],
        JavaScript: [
            /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
            /^(?:export\s+)?class\s+(\w+)/,
            /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
        ],
        Python: [
            /^(?:async\s+)?def\s+(\w+)/,
            /^class\s+(\w+)/,
        ],
    };

    const langPatterns = patterns[language] || patterns.TypeScript;
    let currentChunk: { start: number; lines: string[]; name: string; type: string } | null = null;
    let braceCount = 0;
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Check for new logical unit
        if (!inBlock) {
            for (const pattern of langPatterns) {
                const match = trimmedLine.match(pattern);
                if (match) {
                    // Save previous chunk
                    if (currentChunk && currentChunk.lines.length > 0) {
                        chunks.push(createChunk(currentChunk, filePath, language));
                    }

                    currentChunk = {
                        start: i + 1,
                        lines: [line],
                        name: match[1] || 'unknown',
                        type: getChunkType(trimmedLine),
                    };
                    inBlock = true;
                    braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
                    break;
                }
            }
        } else if (currentChunk) {
            currentChunk.lines.push(line);
            braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            // End of block (for brace-based languages)
            if (braceCount <= 0 && currentChunk.lines.length > 1) {
                chunks.push(createChunk(currentChunk, filePath, language));
                currentChunk = null;
                inBlock = false;
                braceCount = 0;
            }

            // Limit chunk size
            if (currentChunk && currentChunk.lines.join('\n').length > CHUNK_SIZE * 2) {
                chunks.push(createChunk(currentChunk, filePath, language));
                currentChunk = null;
                inBlock = false;
            }
        }
    }

    // Save last chunk
    if (currentChunk && currentChunk.lines.length > 0) {
        chunks.push(createChunk(currentChunk, filePath, language));
    }

    return chunks;
}

/**
 * Sliding window chunking for files without clear logical units
 */
function slidingWindowChunk(content: string, filePath: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    let startLine = 0;
    let currentChunk = '';
    let chunkStartLine = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (currentChunk.length + line.length > CHUNK_SIZE) {
            if (currentChunk.length > 0) {
                chunks.push({
                    id: uuidv4(),
                    filePath,
                    content: currentChunk.trim(),
                    startLine: chunkStartLine,
                    endLine: i,
                    language,
                    type: 'chunk',
                });
            }

            // Start new chunk with overlap
            const overlapLines = Math.ceil(CHUNK_OVERLAP / 80); // ~80 chars per line
            const startIdx = Math.max(0, i - overlapLines);
            currentChunk = lines.slice(startIdx, i + 1).join('\n');
            chunkStartLine = startIdx + 1;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }

    // Add remaining content
    if (currentChunk.trim().length > 0) {
        chunks.push({
            id: uuidv4(),
            filePath,
            content: currentChunk.trim(),
            startLine: chunkStartLine,
            endLine: lines.length,
            language,
            type: 'chunk',
        });
    }

    return chunks;
}

function createChunk(
    data: { start: number; lines: string[]; name: string; type: string },
    filePath: string,
    language: string
): CodeChunk {
    return {
        id: uuidv4(),
        filePath,
        content: data.lines.join('\n'),
        startLine: data.start,
        endLine: data.start + data.lines.length - 1,
        language,
        type: data.type as 'function' | 'class' | 'module' | 'chunk',
        summary: `${data.type}: ${data.name}`,
    };
}

function getChunkType(line: string): 'function' | 'class' | 'module' | 'chunk' {
    if (/class\s+/i.test(line)) return 'class';
    if (/function\s+|=>\s*{|=\s*\(/i.test(line)) return 'function';
    if (/interface\s+|type\s+/i.test(line)) return 'module';
    return 'chunk';
}

function getLanguageFromExtension(ext: string): string {
    const languageMap: Record<string, string> = {
        'ts': 'TypeScript',
        'tsx': 'TypeScript',
        'js': 'JavaScript',
        'jsx': 'JavaScript',
        'py': 'Python',
        'java': 'Java',
        'go': 'Go',
        'rs': 'Rust',
        'cpp': 'C++',
        'c': 'C',
    };
    return languageMap[ext.toLowerCase()] || ext;
}

function generateContextSummary(results: qdrant.SearchResult[], query: string): string {
    if (results.length === 0) {
        return 'No relevant code found.';
    }

    const filesSummary = new Map<string, number>();
    results.forEach(r => {
        const count = filesSummary.get(r.chunk.filePath) || 0;
        filesSummary.set(r.chunk.filePath, count + 1);
    });

    const files = Array.from(filesSummary.entries())
        .map(([file, count]) => `${file} (${count} matches)`)
        .join(', ');

    return `Found ${results.length} relevant code chunks across ${filesSummary.size} files: ${files}`;
}
