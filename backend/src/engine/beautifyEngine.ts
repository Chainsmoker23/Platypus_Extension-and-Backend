
import { GoogleGenAI } from '@google/genai';
import { FileData } from '../types/index';
import { withRotatingKey } from './apiKeyRotator';

const BEAUTY_PROMPT = `
You are the world's best frontend designer.

Transform the given React component into a PERFECT, production-ready Shadcn + Tailwind UI component.

MANDATORY RULES:
- Use only shadcn/ui components (Card, Button, Input, Label, Dialog, DropdownMenu, etc.)
- Use Tailwind classes only (no CSS modules, no inline styles)
- Perfect spacing, hover states, focus rings, dark mode support
- Proper form labels and accessibility
- Clean, modern, minimal look
- Import all required shadcn components from "@/components/ui/..."
- Return ONLY the complete file content. No explanations. No markdown.

Transform this component:
`;

export async function makeItBeautiful(file: FileData): Promise<{ filePath: string; content: string }> {
  return withRotatingKey(async (key) => {
    const ai = new GoogleGenAI({apiKey: key});
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${BEAUTY_PROMPT}\n\n\`\`\`tsx\n${file.content}\n\`\`\``,
        config: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain"
        }
    });

    const text = response.text || "";
    // Strip markdown code blocks if present
    const cleanContent = text.replace(/^```(tsx|jsx|javascript|typescript)?\n/i, '').replace(/\n```$/, '');

    return {
        filePath: file.filePath,
        content: cleanContent.trim()
    };
  });
}
