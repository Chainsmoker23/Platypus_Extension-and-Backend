
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
// This saves cost and time before upserting to Qdrant
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
    // We filter only chunks that have embeddings.
    // Qdrant service handles deduplication using deterministic IDs.
    const validChunks = allChunks.filter(c => c.embedding && c.embedding.length > 0);
    if (validChunks.length > 0) {
         // Convert to Qdrant format
         const points: VectorPoint[] = validChunks.map(c => ({
             vector: c.embedding!,
             payload: {
                 filePath: c.filePath,
                 content: c.content,
                 checksum: c.checksum
             }
         }));
         
         // Non-blocking upsert to speed up response? 
         // For now, await it to ensure consistency for this request.
         // In production, might want to fire-and-forget or queue.
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
    const qdrantResults = await searchPoints(taskEmbedding, 8);

    let topChunks: { filePath: string; content: string; score: number }[] = [];

    if (qdrantResults) {
        // Qdrant found results
        console.log(`[DeepContext] Qdrant returned ${qdrantResults.length} matches.`);
        topChunks = qdrantResults.map(r => ({
            filePath: r.payload?.filePath as string,
            content: r.payload?.content as string,
            score: r.score
        }));
    } else {
        // Fallback to In-Memory Cosine Similarity if Qdrant not configured or failed
        console.log(`[DeepContext] Qdrant unavailable. Using in-memory fallback.`);
        topChunks = allChunks
            .filter(c => c.embedding)
            .map(c => ({
                filePath: c.filePath,
                content: c.content,
                score: cosineSimilarity(taskEmbedding, c.embedding!)
            }))
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 8);
    }

    // 6. Boost Selected Files
    // If we have selected files, we ensure they are part of the context or boosted
    if (selectedFilePaths.length > 0) {
        // Simple boost: logic is complex with just chunks, so we rely on the orchestrator 
        // to forcefully include selected files in the prompt.
        // However, we can use this phase to pull relevant chunks from them specifically.
    }

    // 7. Reconstruct Virtual Files
    const resultFiles: FileData[] = topChunks.map(c => ({
        filePath: c.filePath,
        content: `// ... relevant section from Qdrant Search ...\n${c.content}\n// ...`,
        checksum: 'virtual'
    }));

    return resultFiles;
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
    return allFiles
        .map(file => {
            let score = 0;
            const lowerPath = file.filePath.toLowerCase();
            if (taskLower.includes(lowerPath)) score += 100;
            if (selectedFilePaths.some(p => lowerPath.includes(p.toLowerCase()))) score += 20;
            return { file, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(item => ({
             ...item.file,
             content: item.file.content.length > 800 ? item.file.content.substring(0, 800) + "\n// [truncated]..." : item.file.content
        }));
}
