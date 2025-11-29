// FIX: Corrected the import path from '@google/ai/generativelace' to '@google/genai'.
import { GoogleGenAI, Type } from '@google/genai';
import { FileData, AnalysisResult } from '../types/index';
import { validateOperations } from '../utils/diffValidator';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

// FIX: Corrected GoogleGenAI initialization to use an options object with an apiKey property.
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const modificationResultSchema = {
    type: Type.OBJECT,
    properties: {
        reasoning: { 
            type: Type.STRING,
            description: "A short, visible summary of the changes for the user."
        },
        changes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    type: {
                        type: Type.STRING,
                        enum: ['modify'],
                    },
                    filePath: {
                        type: Type.STRING,
                        description: "The exact same filePath that was provided in the prompt.",
                    },
                    diff: {
                        type: Type.STRING,
                        description: "A valid unified diff that applies perfectly to the original file content.",
                    },
                },
                required: ['type', 'filePath', 'diff'],
            },
        },
    },
    required: ['reasoning', 'changes'],
};


export async function generateModificationForFile(prompt: string, file: FileData, signal: AbortSignal): Promise<AnalysisResult> {
    const model = 'gemini-3-pro-preview';

    const systemInstruction = `You are an expert coder. The user has one file open.

File: ${file.filePath}
Content:
${file.content}

User request: ${prompt}

Return ONLY valid JSON. No markdown. No explanations outside JSON.
`;

    if (signal.aborted) {
        throw new Error('Aborted');
    }

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [{ text: systemInstruction }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: modificationResultSchema,
                temperature: 0.1,
            },
        });

        if (signal.aborted) {
            throw new Error('Aborted');
        }

        const responseText = response.text;
        if (!responseText) {
            throw new Error("Received an empty response from the AI.");
        }
        
        const result = JSON.parse(responseText);
        validateOperations(result);

        return result;

    } catch (error) {
        if (error instanceof Error && error.message === 'Aborted') {
            const abortError = new Error("The analysis was cancelled.");
            abortError.name = "AbortError";
            throw abortError;
        }
        console.error("Error calling Gemini API or validating response:", error);
        throw new Error("Failed to generate and validate analysis from Gemini API.");
    }
}