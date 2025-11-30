
import { GoogleGenAI, Type } from '@google/genai';
import { createTwoFilesPatch } from 'diff';
import { FileData, FileSystemOperation } from '../types/index';
import { withRotatingKey } from './apiKeyRotator';

export async function resolveErrors(diagnostics: string[], files: FileData[]): Promise<FileSystemOperation[]> {
    if (!diagnostics || diagnostics.length === 0) return [];

    const operations: FileSystemOperation[] = [];
    const errorsByFile = new Map<string, string[]>();

    // 1. Group errors by file
    for (const diag of diagnostics) {
        // Find which file this error belongs to
        const foundFile = files.find(f => diag.includes(f.filePath));
        if (foundFile) {
            if (!errorsByFile.has(foundFile.filePath)) errorsByFile.set(foundFile.filePath, []);
            errorsByFile.get(foundFile.filePath)?.push(diag);
        }
    }

    // 2. Analyze each file with errors
    for (const [filePath, fileErrors] of errorsByFile.entries()) {
        const file = files.find(f => f.filePath === filePath);
        if (!file) continue;

        const errorMsg = fileErrors.join('\n');
        
        // 3. Send to Gemini
        await withRotatingKey(async (key) => {
            const ai = new GoogleGenAI({apiKey: key});
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `
You are a senior engineer. This error happened:
${errorMsg}

Here is the code and context.
\`\`\`
${file.content}
\`\`\`

Tell me the ROOT CAUSE and the ONE perfect fix.
Rate confidence 1–10.
Return JSON only.
`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            rootCause: { type: Type.STRING },
                            fixedContent: { type: Type.STRING, description: "The fully corrected file content." },
                            confidence: { type: Type.INTEGER },
                            explanation: { type: Type.STRING }
                        },
                        required: ["rootCause", "fixedContent", "confidence", "explanation"]
                    }
                }
            });

            const result = JSON.parse(response.text || "{}");
            
            // 4. Generate Diff
            if (result.fixedContent) {
                const patch = createTwoFilesPatch(
                    filePath,
                    filePath,
                    file.content,
                    result.fixedContent,
                    'Original',
                    'Fixed'
                );

                operations.push({
                    type: 'modify',
                    filePath,
                    diff: patch,
                    explanation: `[Confidence: ${result.confidence}/10] ${result.rootCause}`
                });
            }
        });
    }

    return operations;
}
