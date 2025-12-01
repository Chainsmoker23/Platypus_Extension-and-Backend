
import { FileData } from '../types/index';
import { embedText } from '../services/embeddingService';
import { upsertPoints, searchPoints, VectorPoint } from '../services/qdrantService';

// In-memory Vector Store Types (Fallback)
interface DocumentChunk {
    filePath: string;
    content: string;
    embedding?: number[];
    score?: number;
    checksum?: string;
}

const CHUNK_SIZE = 1000; 
const OVERLAP = 100;

function chunkFile(file: FileData): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = file.content.split('\n');
    let currentChunk = '';
    
    for (let i = 0; i < lines.length; i++) {
        currentChunk += lines[i] + '\n';
        if (currentChunk.length >= CHUNK_SIZE) {
            chunks.push({
                filePath: file.filePath,
                content: currentChunk,
                checksum: file.checksum
            });
            const overlapLines = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
            currentChunk = overlapLines + '\n';
        }
    }
    if (currentChunk.trim().length > 0) {
        chunks.push({
            filePath: file.filePath,
            content: currentChunk,
            checksum: file.checksum
        });
    }
    return chunks;
}

// Global cache for embeddings to avoid re-calculating for same file content
const embeddingCache = new Map<string, DocumentChunk[]>();

export async function getContextForTask(task: string, allFiles: FileData[], selectedFilePaths: string[]): Promise<FileData[]> {
    console.log(`[DeepContext] Generating context for: "${task}"`);
    
    // 1. Prepare Chunks & Embeddings (Lazy Indexing)
    const allChunks: DocumentChunk[] = [];
    const chunksToEmbed: { chunk: DocumentChunk, index: number }[] = [];

    for (const file of allFiles) {
        if (embeddingCache.has(file.checksum)) {
            allChunks.push(...embeddingCache.get(file.checksum)!);
            continue;
        }

        const fileChunks = chunkFile(file);
        fileChunks.forEach(c => {
            allChunks.push(c);
            chunksToEmbed.push({ chunk: c, index: allChunks.length - 1 });
        });
        
        embeddingCache.set(file.checksum, fileChunks);
    }

    // 2. Generate Embeddings for new chunks (Parallelized)
    if (chunksToEmbed.length > 0) {
        console.log(`[DeepContext] Embedding ${chunksToEmbed.length} new code chunks...`);
        const BATCH_SIZE = 5; 
        for (let i = 0; i < chunksToEmbed.length; i += BATCH_SIZE) {
            const batch = chunksToEmbed.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (item) => {
                try {
                    item.chunk.embedding = await embedText(item.chunk.content);
                } catch (e) {
                    console.warn(`Failed to embed chunk in ${item.chunk.filePath}`, e);
                }
            }));
        }
    }

    // 3. Upsert to Qdrant (Sync active workspace state)
    const validChunks = allChunks.filter(c => c.embedding && c.embedding.length > 0);
    if (validChunks.length > 0) {
         const points: VectorPoint[] = validChunks.map(c => ({
             vector: c.embedding!,
             payload: {
                 filePath: c.filePath,
                 content: c.content, // Storing chunk content for search debug/verification
                 checksum: c.checksum
             }
         }));
         
         await upsertPoints(points);
    }

    // 4. Embed the Task
    let taskEmbedding: number[];
    try {
        taskEmbedding = await embedText(task);
    } catch (e) {
        console.error("Failed to embed task, falling back to keyword search", e);
        return getFallbackContext(task, allFiles, selectedFilePaths);
    }

    // 5. Semantic Search via Qdrant
    // We retrieve more chunks to ensure we cover all relevant files
    const qdrantResults = await searchPoints(taskEmbedding, 12);

    const relevantFilePaths = new Set<string>();

    // Always include explicitly selected files
    selectedFilePaths.forEach(p => relevantFilePaths.add(p));

    if (qdrantResults && qdrantResults.length > 0) {
        console.log(`[DeepContext] Qdrant returned ${qdrantResults.length} matches.`);
        qdrantResults.forEach(r => {
             if (r.payload?.filePath) relevantFilePaths.add(r.payload.filePath as string);
        });
    } else {
        console.log(`[DeepContext] Qdrant unavailable or no results. Using in-memory fallback.`);
        const fallbackFiles = getFallbackContext(task, allFiles, selectedFilePaths);
        fallbackFiles.forEach(f => relevantFilePaths.add(f.filePath));
    }

    // 6. Map back to FULL Content
    // CRITICAL: We must return the FULL file content, not just the chunk, 
    // so the AI can generate valid diffs with correct line numbers.
    const finalContext: FileData[] = allFiles.filter(f => {
        return Array.from(relevantFilePaths).some(rel => f.filePath === rel || f.filePath.endsWith(rel));
    });

    // 7. Sort: Selected files first, then by relevance (if we had scores per file, here we prioritize selection)
    finalContext.sort((a, b) => {
        const aSelected = selectedFilePaths.some(p => a.filePath.includes(p));
        const bSelected = selectedFilePaths.some(p => b.filePath.includes(p));
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return 0;
    });

    // Limit context to top 10 files to keep prompt size manageable but sufficient
    return finalContext.slice(0, 10);
}

// In-Memory Fallback Utility
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getFallbackContext(task: string, allFiles: FileData[], selectedFilePaths: string[]): FileData[] {
    const taskLower = task.toLowerCase();
    
    // Find files with simple keyword matching
    const rankedFiles = allFiles
        .map(file => {
            let score = 0;
            const lowerPath = file.filePath.toLowerCase();
            if (taskLower.includes(lowerPath)) score += 100; // Direct mention of file
            if (selectedFilePaths.some(p => lowerPath.includes(p.toLowerCase()))) score += 1000; // Explicit selection
            if (file.content.toLowerCase().includes(taskLower)) score += 10; // Content match
            return { file, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5); // Take top 5

    // Return FULL content for fallback as well
    return rankedFiles.map(item => item.file);
}
