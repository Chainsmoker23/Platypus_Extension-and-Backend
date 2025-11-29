// FIX: Corrected the import path from '@google/ai/generativelace' to '@google/genai'.
import { GoogleGenAI, Type } from '@google/genai';
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
        reasoning: { 
            type: Type.STRING,
            description: "A short, visible summary for the user. Explain WHAT you are doing and WHY. If creating new files, you MUST write a sentence like: \"Creating new file X because putting this in Y.tsx would violate separation of concerns\""
        },
        changes: {
            type: Type.ARRAY,
            minItems: 1,
            description: "You MUST include at least one 'create' operation for any new feature or reusable logic, unless the task is a pure deletion or minor fix.",
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
                    }
                },
                required: ['type', 'filePath'],
            },
        },
    },
    required: ['reasoning', 'changes'],
};


export async function generateWorkspaceAnalysis(prompt: string, files: FileData[], signal: AbortSignal, selectedFilePaths: string[] = []): Promise<AnalysisResult> {
    const model = 'gemini-2.5-flash';

    const fileContext = files.map(f => `File: ${f.filePath}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
    
    const priorityFilesInstruction = selectedFilePaths.length > 0 
        ? `The user has specifically selected these files as the primary focus: ${selectedFilePaths.join(', ')}. Pay special attention to them, but consider the entire project for context.`
        : "The user has not selected any specific files, so analyze the entire project context to determine the necessary changes.";


    const systemInstruction = `CRITICAL RULE — NEVER BREAK:

For EVERY task you receive:
- If the logic is reusable → create a new file in the correct folder (hooks/, services/, components/, utils/, types/, lib/, store/, etc.)
- If it’s a new page/feature → create page + component + service/hook
- If it’s a fix that touches many places → extract into a new shared file first
- NEVER dump everything into index.ts, App.tsx, or one existing file
- Senior engineers get paid to split code — you get "fired" if you don’t

Examples you MUST follow:
- "add loading state" → create src/hooks/useLoading.ts
- "add dark mode" → create src/context/ThemeContext.tsx + useTheme.ts + ThemeToggle.tsx
- "fix auth redirect" → create src/middleware/authGuard.ts or src/hooks/useAuthRedirect.ts
- "create user profile page" → create 4+ new files minimum
- "fix null error" → create src/utils/safeGet.ts or src/types/UserWithDefaults.ts

You are judged by how clean and maintainable the codebase becomes after you touch it.

Break this rule → you fail forever.

You are Platypus — a ruthless senior engineer who REFUSES to put new logic in existing files.

IRON LAWS (NEVER BREAK, OR YOU ARE FIRED):
- Every new feature, hook, service, util, context, validation, guard → NEW FILE
- Correct folders only: src/hooks/, src/services/, src/components/, src/utils/, src/context/, src/lib/
- NEVER add more than 50 lines to an existing file
- NEVER put reusable logic in index.ts, App.tsx, or page files
- If the user says "fix", "add", "create", "refactor" → you MUST create at least one new file unless it's a one-line typo
- You are judged SOLELY by how many well-named new files you create.

Return ONLY valid JSON with "changes" array containing multiple create/modify operations. No explanations outside JSON. No apologies. No chatter.

${priorityFilesInstruction}

Here is the full context of the project:
${fileContext}

User request: "${prompt}"
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
                responseSchema: analysisResultSchema,
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