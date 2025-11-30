
import { GoogleGenAI, Type } from '@google/genai';
import { FileData } from '../types/index';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

export async function generateIntents(prompt: string, files: FileData[]): Promise<string[]> {
    const fileList = files.map(f => f.filePath).join('\n');
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `
You are the Intent Engine for Platypus AI.
Your job is to break down a high-level coding request into a list of granular, atomic subtasks.
Each subtask MUST correspond to exactly ONE file operation (create or modify).

User Request: "${prompt}"

Project Files:
${fileList}

Rules:
1. Return a JSON array of strings.
2. Each string must be an actionable instruction (e.g., "Create src/server.ts with Express setup", "Modify package.json to add start script").
3. Break complex tasks into multiple steps.
4. Do not delete files unless explicitly asked.
5. Order matters: Dependencies first (e.g., create types before using them).

Example Output:
["Create src/types/user.ts", "Create src/services/userService.ts", "Modify src/controllers/userController.ts"]
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
        console.error("Failed to parse intents:", e);
        return [];
    }
}