
import { GoogleGenAI } from '@google/genai';
import { withRotatingKey } from '../engine/apiKeyRotator';

export async function embedText(text: string): Promise<number[]> {
    return withRotatingKey(async (key) => {
        const ai = new GoogleGenAI({apiKey: key});
        const response = await ai.models.embedContent({
            model: 'text-embedding-004',
            content: { parts: [{ text }] }
        });

        if (!response.embedding?.values) {
            throw new Error("Failed to generate embedding");
        }
        return response.embedding.values;
    });
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
    // Gemini supports batch embedding, but for simplicity and error handling in this rotation logic,
    // we'll map them. In a high-throughput prod env, use batchEmbedContents.
    return Promise.all(texts.map(t => embedText(t)));
}
