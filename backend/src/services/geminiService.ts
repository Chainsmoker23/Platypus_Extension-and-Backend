import { GoogleGenAI, Type } from '@google/genai';
import { FileData } from '../types';
import { parsePatch } from 'diff';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const analysisResultSchema = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING },
        changes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    filePath: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    diff: { type: Type.STRING },
                },
                required: ['filePath', 'explanation', 'diff'],
            },
        },
    },
    required: ['summary', 'changes'],
};


export async function generateAnalysis(prompt: string, files: FileData[]) {
    const model = 'gemini-3-pro-preview';

    const systemInstruction = `You are "Platypus," an expert AI software engineer. Your task is to analyze the user's codebase and request, and provide a set of precise, actionable code changes.
1.  First, provide a concise summary explaining your overall plan.
2.  Then, for each file you modify, provide a brief explanation of the changes.
3.  Finally, provide the code changes in the standard unified diff format, starting each file's diff with \`--- a/path/to/file\` and \`+++ b/path/to/file\`.
4.  Only modify the files provided in the context. Do not invent new file paths or change files not provided.
5.  Your entire response MUST be in a single, valid JSON object that adheres to the provided schema. Do not include any markdown formatting like \`\`\`json around the code.`;

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

    try {
        const response = await ai.models.generateContent({
            model,
            contents: fullPrompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: analysisResultSchema,
                temperature: 0.2,
            },
        });

        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);

        // --- Diff Validation Step ---
        if (result.changes && Array.isArray(result.changes)) {
            for (const change of result.changes) {
                if (typeof change.diff !== 'string' || change.diff.trim().length === 0) continue;
                
                try {
                    const parsedDiff = parsePatch(change.diff);
                    // A valid patch for a single file should result in exactly one parsed patch object.
                    // An empty diff string is valid and results in an empty array.
                    if (parsedDiff.length > 1) {
                         throw new Error(`Malformed diff for ${change.filePath}: contains multiple file patches.`);
                    }
                } catch (e) {
                    console.error(`Invalid diff format for file ${change.filePath}:`, e);
                    throw new Error(`AI generated an invalid diff format for ${change.filePath}.`);
                }
            }
        }
        
        return result;

    } catch (error) {
        console.error("Error calling Gemini API or validating response:", error);
        throw new Error("Failed to generate and validate analysis from Gemini API.");
    }
}