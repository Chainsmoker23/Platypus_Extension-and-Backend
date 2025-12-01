
import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = 'platypus_codebase';
// Dimensions for 'text-embedding-004'
const VECTOR_SIZE = 768; 
// Namespace for UUID v5 generation (randomly generated constant)
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

let client: QdrantClient | null = null;

export async function initQdrant() {
    if (client) return client;
    if (!QDRANT_URL || !QDRANT_API_KEY) {
        // Silent fail if no keys provided, allowing fallback to in-memory
        return null;
    }

    try {
        // Basic validation to prevent immediate crash in client constructor
        new URL(QDRANT_URL);

        client = new QdrantClient({
            url: QDRANT_URL,
            apiKey: QDRANT_API_KEY,
            timeout: 5000, // 5s timeout for initial connection
        });

        // Test connection and schema
        const collections = await client.getCollections();
        const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
        
        if (!exists) {
            await client.createCollection(COLLECTION_NAME, {
                vectors: {
                    size: VECTOR_SIZE,
                    distance: 'Cosine',
                },
            });
            console.log(`[Qdrant] Created collection: ${COLLECTION_NAME}`);
        }
    } catch (e) {
        console.warn("[Qdrant] Connection failed or misconfigured. Falling back to in-memory search.");
        console.warn(`[Qdrant] Error details: ${e instanceof Error ? e.message : String(e)}`);
        client = null;
    }
    return client;
}

export interface VectorPoint {
    id?: string;
    vector: number[];
    payload: {
        filePath: string;
        content: string;
        checksum?: string;
        [key: string]: any;
    };
}

export async function upsertPoints(points: VectorPoint[]) {
    const c = await initQdrant();
    if (!c || points.length === 0) return;

    try {
        const qdrantPoints = points.map(p => {
            // Generate deterministic ID based on content to ensure deduplication
            const contentHash = p.payload.checksum || p.payload.content;
            const deterministicId = uuidv5(p.payload.filePath + contentHash, UUID_NAMESPACE);
            
            return {
                id: deterministicId,
                vector: p.vector,
                payload: p.payload
            };
        });

        await c.upsert(COLLECTION_NAME, {
            wait: true,
            points: qdrantPoints
        });
        
    } catch (e) {
        console.error("[Qdrant] Upsert failed (non-fatal):", e instanceof Error ? e.message : String(e));
    }
}

export async function searchPoints(vector: number[], limit: number = 8) {
    const c = await initQdrant();
    if (!c) return null;

    try {
        return await c.search(COLLECTION_NAME, {
            vector,
            limit,
            with_payload: true,
        });
    } catch (e) {
        console.error("[Qdrant] Search failed (falling back):", e instanceof Error ? e.message : String(e));
        return null;
    }
}
