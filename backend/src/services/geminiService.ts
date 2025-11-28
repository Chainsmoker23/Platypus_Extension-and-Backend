

// FIX: Corrected the import path from '@google/ai/generativelanguage' to '@google/genai'.
import { GoogleGenAI, Type } from '@google/genai';
// FIX: Added AnalysisResult to imports for the new generateAnalysis function.
import { FileData, AnalysisResult } from '../types/index';
import { validateOperations } from '../utils/diffValidator';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

// FIX: Corrected GoogleGenAI initialization to use an options object with an apiKey property.
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const analysisResultSchema = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING },
        changes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    operation: {
                        type: Type.STRING,
                        description: "The type of file operation: 'create', 'delete', 'move', or 'modify'.",
                    },
                    filePath: {
                        type: Type.STRING,
                        description: "The path for 'create', 'delete', and 'modify' operations. Relative to the project root.",
                    },
                    oldPath: {
                        type: Type.STRING,
                        description: "The original path for a 'move' operation. Relative to the project root.",
                    },
                    newPath: {
                        type: Type.STRING,
                        description: "The new path for a 'move' operation. Relative to the project root.",
                    },
                    content: {
                        type: Type.STRING,
                        description: "The full file content for a 'create' operation.",
                    },
                    diff: {
                        type: Type.STRING,
                        description: "The unified diff content for a 'modify' operation.",
                    },
                    explanation: {
                        type: Type.STRING,
                        description: "A brief explanation of why this change is being made.",
                    },
                },
                required: ['operation', 'explanation'],
            },
        },
    },
    required: ['summary', 'changes'],
};


export async function* generateAnalysisStream(prompt: string, files: FileData[], signal: AbortSignal) {
    const model = 'gemini-3-pro-preview';

    const systemInstruction = `You are "Platypus," an expert AI software engineer. Your task is to analyze the user's codebase and request, and provide a set of precise, actionable file system operations.
1.  First, provide a concise summary explaining your overall plan.
2.  Then, provide a list of operations. Each operation MUST be a JSON object with an 'operation' field.
3.  You can perform the following operations:
    - 'modify': Modify an existing file. You MUST provide 'filePath' and a 'diff' in the standard unified format.
    - 'create': Create a new file. You MUST provide 'filePath' for the new file and its full 'content'.
    - 'delete': Delete an existing file. You MUST provide the 'filePath' of the file to be deleted.
    - 'move': Move or rename a file. You MUST provide 'oldPath' and 'newPath'.
4.  For every operation, you MUST provide a brief 'explanation' of the change.
5.  Only operate on the files provided in the context unless creating new files. Do not invent new file paths for modification.
6.  Your entire response MUST be in a single, valid JSON object that adheres to the provided schema. Do not include any markdown formatting like \`\`\`json around the code.`;

    const fileContents = files.map(file => `
--- FILE: ${file.filePath} ---
\`\`\`
${file.content}
\`\`\`
`).join('\\n');

    const fullPrompt = `
User Request: "${prompt}"

Codebase context:
${fileContents}
`;

    if (signal.aborted) {
        throw new Error('Aborted');
    }

    try {
        // FIX: Updated the API call to match the new @google/genai SDK format.
        // This includes using ai.models.generateContentStream and passing parameters in the correct structure.
        const streamResult = await ai.models.generateContentStream({
            model: model,
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisResultSchema,
                temperature: 0.2,
                systemInstruction: systemInstruction,
            },
        });

        let fullText = '';
        
        for await (const chunk of streamResult) {
            if (signal.aborted) {
                throw new Error('Aborted');
            }
            // FIX: Changed from chunk.text() method call to chunk.text property access.
            const chunkText = chunk.text;
            if(chunkText) {
                fullText += chunkText;
                yield { type: 'summary_chunk', payload: chunkText };
            }
        }
        
        const result = JSON.parse(fullText);
        validateOperations(result);

        yield { type: 'result', payload: result };

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

// FIX: Added a non-streaming generateAnalysis function to resolve the missing export error.
export async function generateAnalysis(prompt: string, files: FileData[], signal: AbortSignal): Promise<AnalysisResult> {
    const stream = generateAnalysisStream(prompt, files, signal);
    let analysisResult: AnalysisResult | null = null;
    for await (const chunk of stream) {
        if (chunk.type === 'result') {
            analysisResult = chunk.payload as AnalysisResult;
            break; 
        }
    }

    if (!analysisResult) {
        if (signal.aborted) {
            const abortError = new Error("The analysis was cancelled.");
            abortError.name = "AbortError";
            throw abortError;
        }
        throw new Error("Analysis stream did not yield a final result.");
    }

    return analysisResult;
}
