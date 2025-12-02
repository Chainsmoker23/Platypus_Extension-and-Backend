import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION_NAME = 'platypus_codebase';
const VECTOR_SIZE = 768; // Gemini embedding dimension

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
    if (!client) {
        const url = process.env.QDRANT_URL;
        const apiKey = process.env.QDRANT_API_KEY;

        if (!url || !apiKey) {
            throw new Error('QDRANT_URL or QDRANT_API_KEY not set in environment');
        }

        client = new QdrantClient({
            url,
            apiKey,
        });
    }
    return client;
}

export interface CodeChunk {
    id: string;
    filePath: string;
    content: string;
    startLine: number;
    endLine: number;
    language: string;
    type: 'function' | 'class' | 'module' | 'chunk';
    summary?: string;
}

export interface SearchResult {
    chunk: CodeChunk;
    score: number;
}

/**
 * Initialize the Qdrant collection if it doesn't exist
 */
export async function initializeCollection(workspaceId: string): Promise<void> {
    const qdrant = getClient();
    const collectionName = `${COLLECTION_NAME}_${workspaceId}`;

    try {
        const collections = await qdrant.getCollections();
        const exists = collections.collections.some(c => c.name === collectionName);

        if (!exists) {
            await qdrant.createCollection(collectionName, {
                vectors: {
                    size: VECTOR_SIZE,
                    distance: 'Cosine',
                },
                optimizers_config: {
                    default_segment_number: 2,
                },
                replication_factor: 1,
            });
            console.log(`[Qdrant] Created collection: ${collectionName}`);
        } else {
            console.log(`[Qdrant] Collection exists: ${collectionName}`);
        }
    } catch (error) {
        console.error('[Qdrant] Failed to initialize collection:', error);
        throw error;
    }
}

/**
 * Delete and recreate collection (for re-indexing)
 */
export async function resetCollection(workspaceId: string): Promise<void> {
    const qdrant = getClient();
    const collectionName = `${COLLECTION_NAME}_${workspaceId}`;

    try {
        await qdrant.deleteCollection(collectionName);
        console.log(`[Qdrant] Deleted collection: ${collectionName}`);
    } catch (error) {
        // Collection might not exist, ignore
    }

    await initializeCollection(workspaceId);
}

/**
 * Upsert code chunks with their embeddings
 */
export async function upsertChunks(
    workspaceId: string,
    chunks: CodeChunk[],
    embeddings: number[][]
): Promise<void> {
    const qdrant = getClient();
    const collectionName = `${COLLECTION_NAME}_${workspaceId}`;

    const points = chunks.map((chunk, idx) => ({
        id: generatePointId(chunk.id),
        vector: embeddings[idx],
        payload: {
            filePath: chunk.filePath,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
            type: chunk.type,
            summary: chunk.summary || '',
        },
    }));

    // Batch upsert in chunks of 100
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        await qdrant.upsert(collectionName, {
            wait: true,
            points: batch,
        });
    }

    console.log(`[Qdrant] Upserted ${points.length} chunks to ${collectionName}`);
}

/**
 * Search for similar code chunks
 */
export async function searchSimilar(
    workspaceId: string,
    queryEmbedding: number[],
    limit: number = 10,
    filter?: { filePath?: string; type?: string }
): Promise<SearchResult[]> {
    const qdrant = getClient();
    const collectionName = `${COLLECTION_NAME}_${workspaceId}`;

    const searchFilter: any = {};
    if (filter?.filePath) {
        searchFilter.must = searchFilter.must || [];
        searchFilter.must.push({
            key: 'filePath',
            match: { value: filter.filePath },
        });
    }
    if (filter?.type) {
        searchFilter.must = searchFilter.must || [];
        searchFilter.must.push({
            key: 'type',
            match: { value: filter.type },
        });
    }

    const results = await qdrant.search(collectionName, {
        vector: queryEmbedding,
        limit,
        with_payload: true,
        filter: Object.keys(searchFilter).length > 0 ? searchFilter : undefined,
    });

    return results.map(r => ({
        chunk: {
            id: String(r.id),
            filePath: r.payload?.filePath as string,
            content: r.payload?.content as string,
            startLine: r.payload?.startLine as number,
            endLine: r.payload?.endLine as number,
            language: r.payload?.language as string,
            type: r.payload?.type as 'function' | 'class' | 'module' | 'chunk',
            summary: r.payload?.summary as string,
        },
        score: r.score,
    }));
}

/**
 * Get collection statistics
 */
export async function getCollectionStats(workspaceId: string): Promise<{
    exists: boolean;
    pointsCount: number;
    status: string;
}> {
    const qdrant = getClient();
    const collectionName = `${COLLECTION_NAME}_${workspaceId}`;

    try {
        const info = await qdrant.getCollection(collectionName);
        return {
            exists: true,
            pointsCount: info.points_count || 0,
            status: info.status,
        };
    } catch (error) {
        return {
            exists: false,
            pointsCount: 0,
            status: 'not_found',
        };
    }
}

/**
 * Delete specific files from the index
 */
export async function deleteFileChunks(workspaceId: string, filePath: string): Promise<void> {
    const qdrant = getClient();
    const collectionName = `${COLLECTION_NAME}_${workspaceId}`;

    await qdrant.delete(collectionName, {
        wait: true,
        filter: {
            must: [
                {
                    key: 'filePath',
                    match: { value: filePath },
                },
            ],
        },
    });

    console.log(`[Qdrant] Deleted chunks for file: ${filePath}`);
}

// Helper to generate consistent point IDs
function generatePointId(chunkId: string): number {
    let hash = 0;
    for (let i = 0; i < chunkId.length; i++) {
        const char = chunkId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}
