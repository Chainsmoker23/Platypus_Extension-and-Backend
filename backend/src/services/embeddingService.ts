import { GoogleGenAI } from '@google/genai';

const EMBEDDING_MODEL = 'text-embedding-004';
const MAX_BATCH_SIZE = 100;
const MAX_TEXT_LENGTH = 2048;

let client: GoogleGenAI | null = null;
let currentKeyIndex = 0;
let apiKeys: string[] = [];

function getClient(): GoogleGenAI {
    // Support multiple API keys for rate limiting
    if (apiKeys.length === 0) {
        const keysEnv = process.env.GEMINI_KEYS || process.env.AGENT_API_KEY;
        if (!keysEnv) {
            throw new Error('No GEMINI_KEYS or AGENT_API_KEY set in environment');
        }
        apiKeys = keysEnv.split(',').map(k => k.trim()).filter(k => k);
    }

    // Rotate through keys
    const key = apiKeys[currentKeyIndex % apiKeys.length];
    currentKeyIndex++;

    return new GoogleGenAI({ apiKey: key });
}

/**
 * Detect if an error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
    if (!error) return false;
    
    // Check for common rate limit indicators
    return (
        (error.status === 429) ||
        (error.code === 429) ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('rate limit')) ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('resource exhausted'))
    );
}

/**
 * Generate embeddings for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    // Truncate text if too long
    const truncatedText = text.slice(0, MAX_TEXT_LENGTH);
    
    // Retry logic with exponential backoff for rate limiting
    let attempts = 0;
    const maxAttempts = 3;
    let response: any;
    
    while (attempts < maxAttempts) {
        try {
            const client = getClient();
            response = await client.models.embedContent({
                model: EMBEDDING_MODEL,
                contents: truncatedText,
            });
            break; // Success, exit retry loop
            
        } catch (error: any) {
            attempts++;
            if (attempts >= maxAttempts || !isRateLimitError(error)) {
                throw error;
            }
            
            // Exponential backoff
            const delay = Math.pow(2, attempts) * 1000;
            console.log(`[Embedding] Rate limited, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    if (attempts >= maxAttempts) {
        throw new Error('Max retries exceeded for embedding generation');
    }

    const embedding = response.embeddings?.[0]?.values;
    if (!embedding) {
        throw new Error('No embedding returned from API');
    }

    return embedding;
}

/**
 * Generate embeddings for multiple texts with batching and rate limiting
 */
export async function generateEmbeddings(
    texts: string[],
    onProgress?: (processed: number, total: number) => void
): Promise<number[][]> {
    const embeddings: number[][] = [];
    
    // Process in batches
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
        const batch = texts.slice(i, i + MAX_BATCH_SIZE);
        
        // Process batch with parallel requests (but limit concurrency)
        const batchPromises = batch.map(async (text, idx) => {
            // Add small delay to avoid rate limiting
            await delay(50 * (idx % 5));
            
            // Retry logic for individual embeddings
            let attempts = 0;
            const maxAttempts = 3;
            while (attempts < maxAttempts) {
                try {
                    return await generateEmbedding(text);
                } catch (error: any) {
                    attempts++;
                    if (attempts >= maxAttempts || !isRateLimitError(error)) {
                        throw error;
                    }
                    
                    // Exponential backoff
                    const delay = Math.pow(2, attempts) * 1000;
                    console.log(`[Embedding] Rate limited for batch item, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            throw new Error('Max retries exceeded for batch embedding');
        });

        const batchResults = await Promise.all(batchPromises);
        embeddings.push(...batchResults);

        onProgress?.(Math.min(i + MAX_BATCH_SIZE, texts.length), texts.length);
        
        // Rate limit between batches
        if (i + MAX_BATCH_SIZE < texts.length) {
            await delay(500);
        }
    }

    return embeddings;
}

/**
 * Generate a semantic summary of code for better embedding
 */
export function prepareCodeForEmbedding(
    content: string,
    filePath: string,
    type: string
): string {
    const extension = filePath.split('.').pop() || '';
    const fileName = filePath.split('/').pop() || filePath;
    
    // Create a semantic representation
    const parts = [
        `File: ${fileName}`,
        `Type: ${type}`,
        `Language: ${getLanguageFromExtension(extension)}`,
        '',
        content.slice(0, MAX_TEXT_LENGTH - 200), // Leave room for metadata
    ];

    return parts.join('\n');
}

/**
 * Get programming language from file extension
 */
function getLanguageFromExtension(ext: string): string {
    const languageMap: Record<string, string> = {
        'ts': 'TypeScript',
        'tsx': 'TypeScript React',
        'js': 'JavaScript',
        'jsx': 'JavaScript React',
        'py': 'Python',
        'java': 'Java',
        'go': 'Go',
        'rs': 'Rust',
        'cpp': 'C++',
        'c': 'C',
        'cs': 'C#',
        'rb': 'Ruby',
        'php': 'PHP',
        'swift': 'Swift',
        'kt': 'Kotlin',
        'scala': 'Scala',
        'vue': 'Vue',
        'svelte': 'Svelte',
        'html': 'HTML',
        'css': 'CSS',
        'scss': 'SCSS',
        'less': 'LESS',
        'json': 'JSON',
        'yaml': 'YAML',
        'yml': 'YAML',
        'md': 'Markdown',
        'sql': 'SQL',
        'sh': 'Shell',
        'bash': 'Bash',
        'dockerfile': 'Dockerfile',
    };

    return languageMap[ext.toLowerCase()] || ext.toUpperCase();
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
