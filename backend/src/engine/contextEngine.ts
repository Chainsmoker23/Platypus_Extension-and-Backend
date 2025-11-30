
import { FileData } from '../types/index';
import { embedText } from '../services/embeddingService';

// In-memory Vector Store Types
interface DocumentChunk {
    filePath: string;
    content: string;
    embedding?: number[];
    score?: number;
}

const CHUNK_SIZE = 1000; // Characters roughly
const OVERLAP = 100;

// Simple chunking strategy
function chunkFile(file: FileData): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = file.content.split('\n');
    let currentChunk = '';
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
        currentChunk += lines[i] + '\n';
        if (currentChunk.length >= CHUNK_SIZE) {
            chunks.push({
                filePath: file.filePath,
                content: currentChunk
            });
            // Overlap: Keep last few lines
            const overlapLines = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
            currentChunk = overlapLines + '\n';
        }
    }
    if (currentChunk.trim().length > 0) {
        chunks.push({
            filePath: file.filePath,
            content: currentChunk
        });
    }
    return chunks;
}

// Cosine Similarity
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

// Global cache for embeddings to avoid re-calculating for same file content
// Key: file checksum, Value: DocumentChunk[] with embeddings
const embeddingCache = new Map<string, DocumentChunk[]>();

export async function getContextForTask(task: string, allFiles: FileData[], selectedFilePaths: string[]): Promise<FileData[]> {
    console.log(`[DeepContext] Generating context for: "${task}"`);
    
    // 1. Prepare Chunks & Embeddings (Lazy Indexing)
    const allChunks: DocumentChunk[] = [];
    const chunksToEmbed: { chunk: DocumentChunk, index: number }[] = [];

    for (const file of allFiles) {
        // If cached, use it
        if (embeddingCache.has(file.checksum)) {
            allChunks.push(...embeddingCache.get(file.checksum)!);
            continue;
        }

        const fileChunks = chunkFile(file);
        // Mark for embedding
        fileChunks.forEach(c => {
            allChunks.push(c);
            chunksToEmbed.push({ chunk: c, index: allChunks.length - 1 });
        });
        
        // Optimistically cache (will fill embeddings later)
        embeddingCache.set(file.checksum, fileChunks);
    }

    // 2. Generate Embeddings for new chunks (Parallelized)
    // Only if we have chunks to embed. This limits API calls.
    if (chunksToEmbed.length > 0) {
        console.log(`[DeepContext] Embedding ${chunksToEmbed.length} new code chunks...`);
        // Process in small batches to avoid rate limits if necessary
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

    // 3. Embed the Task
    let taskEmbedding: number[];
    try {
        taskEmbedding = await embedText(task);
    } catch (e) {
        console.error("Failed to embed task, falling back to keyword search", e);
        return getFallbackContext(task, allFiles, selectedFilePaths);
    }

    // 4. Semantic Search
    const scoredChunks = allChunks
        .filter(c => c.embedding) // Ensure embedding exists
        .map(c => ({
            ...c,
            score: cosineSimilarity(taskEmbedding, c.embedding!)
        }));

    // 5. Boost Selected Files
    scoredChunks.forEach(c => {
        if (selectedFilePaths.some(p => c.filePath.includes(p))) {
            c.score = (c.score || 0) + 0.2; // Significant boost
        }
    });

    // 6. Select Top Chunks and Reconstruct Files
    // We return "FileData" because the execution engine expects that structure.
    // We construct virtual files containing only the relevant chunks.
    const topChunks = scoredChunks
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5); // Take top 5 most relevant chunks

    const resultFiles: FileData[] = topChunks.map(c => ({
        filePath: c.filePath,
        content: `// ... relevant section ...\n${c.content}\n// ...`,
        checksum: 'virtual'
    }));

    return resultFiles;
}

// Fallback logic (original heuristic)
function getFallbackContext(task: string, allFiles: FileData[], selectedFilePaths: string[]): FileData[] {
    const taskLower = task.toLowerCase();
    return allFiles
        .map(file => {
            let score = 0;
            const lowerPath = file.filePath.toLowerCase();
            if (taskLower.includes(lowerPath)) score += 100;
            else if (taskLower.includes(lowerPath.split('/').pop() || '')) score += 50;
            if (selectedFilePaths.some(p => lowerPath.includes(p.toLowerCase()))) score += 20;
            if (lowerPath.startsWith('src/')) score += 5;
            return { file, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(item => ({
             ...item.file,
             content: item.file.content.length > 800 ? item.file.content.substring(0, 800) + "\n// [truncated]..." : item.file.content
        }));
}
