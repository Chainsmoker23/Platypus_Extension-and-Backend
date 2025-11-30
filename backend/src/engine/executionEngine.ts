
import { GoogleGenAI, Type } from '@google/genai';
import { FileData, FileSystemOperation } from '../types/index';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

export async function executeTask(task: string, context: FileData[]): Promise<FileSystemOperation | null> {
    const contextStr = context.map(f => `File: ${f.filePath}\nContent:\n${f.content}`).join('\n\n');

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `
Task: ${task}

Context:
${contextStr}

Generate a SINGLE file system operation to fulfill the task.
If modifying, provide a valid unified diff.
If creating, provide full content.
If deleting, just filePath.

Return JSON only.
`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: ['create', 'modify', 'delete'] },
                    filePath: { type: Type.STRING },
                    diff: { type: Type.STRING },
                    content: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                },
                required: ['type', 'filePath', 'explanation']
            }
        }
    });

    const text = response.text;
    if (!text) return null;
    try {
        return JSON.parse(text) as FileSystemOperation;
    } catch (e) {
        return null;
    }
}