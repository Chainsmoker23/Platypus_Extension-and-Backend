
import { GoogleGenAI, Type } from '@google/genai';
import { FileData } from '../types/index';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

export async function generateErrorFixes(diagnostics: string[], files: FileData[]): Promise<string[]> {
    if (!diagnostics || diagnostics.length === 0) return [];

    const fileList = files.map(f => f.filePath).join('\n');
    const errorsStr = diagnostics.join('\n');
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `
You are the Error Fix Engine for Platypus AI.
Your job is to convert a list of specific VS Code diagnostics (errors) into a list of atomic coding subtasks.

Errors to fix:
${errorsStr}

Project Files:
${fileList}

Rules:
1. Return a JSON array of strings.
2. Each string must be a specific command to fix ONE error (e.g., "Fix type mismatch in src/user.ts line 40").
3. Do not generalize. Be extremely specific.
4. If multiple errors are related, you can group them into one task, but prefer 1:1 mapping.
5. Do not invent errors. Only fix what is listed.

Example Output:
["Fix 'user' possibly undefined in src/components/Header.tsx", "Import 'useState' in src/App.tsx"]
`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    });

    const text = response.text;
    if (!text) return [];
    
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse error fix intents:", e);
        return [];
    }
}
