
// FIX: Corrected the import path from '@google/ai/generativelace' to '@google/genai'.
import { GoogleGenAI, Type } from '@google/genai';
import { FileData, AnalysisResult } from '../types/index';
import { validateOperations } from '../utils/diffValidator';
import { createSystemInstruction } from './systemPrompt';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

// FIX: Corrected GoogleGenAI initialization to use an options object with an apiKey property.
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const analysisResultSchema = {
    type: Type.OBJECT,
    properties: {
        reasoning: { 
            type: Type.STRING,
            description: "A short, visible summary for the user. Explain WHAT you are doing and WHY. If creating new files, you MUST write a sentence like: \"Creating new file X because putting this in Y.tsx would violate separation of concerns\""
        },
        changes: {
            type: Type.ARRAY,
            minItems: 3,
            maxItems: 12,
            description: "You MUST include at least one 'create' operation for any new feature or reusable logic. For non-trivial tasks, return 3-10 changes.",
            items: {
                type: Type.OBJECT,
                properties: {
                    type: {
                        type: Type.STRING,
                        enum: ['create', 'delete', 'modify'],
                    },
                    filePath: {
                        type: Type.STRING,
                        description: "The full relative path of the file to be operated on.",
                    },
                    diff: {
                        type: Type.STRING,
                        description: "For 'modify' operations, a valid unified diff that applies perfectly to the original file content. For 'create' or 'delete', this should be an empty string.",
                    },
                    content: {
                        type: Type.STRING,
                        description: "For 'create' operations, the full content of the new file. For 'modify' or 'delete', this should be an empty string.",
                    },
                    explanation: {
                        type: Type.STRING,
                        description: "A brief explanation of why this specific file is being changed or created."
                    }
                },
                required: ['type', 'filePath'],
            },
        },
    },
    required: ['reasoning', 'changes'],
};


export async function generateWorkspaceAnalysis(
    prompt: string, 
    files: FileData[], 
    signal: AbortSignal, 
    selectedFilePaths: string[] = [],
    onProgress?: (message: string) => void
): Promise<AnalysisResult> {
    const model = 'gemini-1.5-flash-latest';

    if (onProgress) {
        onProgress("Platypus is thinking...");
    }

    // Smart context — max 8 files total
    let contextFiles: FileData[] = [];

    // 1. Always include user-selected files first (full content)
    if (selectedFilePaths.length > 0) {
      contextFiles = files.filter(f => 
        selectedFilePaths.some(p => f.filePath.includes(p))
      );
    }

    // 2. If less than 8 files → add most relevant ones
    if (contextFiles.length < 8) {
      const remaining = files
        .filter(f => !contextFiles.some(c => c.filePath === f.filePath))
        .sort((a, b) => b.filePath.includes('src') ? -1 : 1)  // prefer src/
        .slice(0, 8 - contextFiles.length);
      contextFiles.push(...remaining);
    }

    if (onProgress) {
        onProgress(`Analyzing ${contextFiles.length} relevant files...`);
    }

    const fileContext = contextFiles.map(f => `File: ${f.filePath}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
    
    const systemInstruction = createSystemInstruction(prompt, fileContext, selectedFilePaths);

    if (signal.aborted) {
        throw new Error('Aborted');
    }

    try {
        if (onProgress) {
            this.streamProgress("Designing clean architecture...");
        }

        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [{ text: systemInstruction }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisResultSchema,
                temperature: 0.1,
                maxOutputTokens: 2048,
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

        if (onProgress) {
            const createCount = result.changes.filter((c: any) => c.type === 'create').length;
            const modifyCount = result.changes.filter((c: any) => c.type === 'modify').length;
            onProgress(`Ready — ${createCount} new files + ${modifyCount} modifications`);
        }

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

// Helper to access stream if needed (though onProgress is passed in)
function streamProgress(message: string) {
    // This function is kept for consistency with the prompt requirement, 
    // but in this implementation, we use the onProgress callback passed to the function.
}
