import { GoogleGenAI } from '@google/genai';
import { routePrompt, getModelClient } from './modelRouter';

interface ConversationContext {
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const conversationHistory: ConversationContext = {
    recentMessages: []
};

/**
 * Smart conversational handler using lightweight model
 */
/**
 * Detect if an error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
    if (!error) return false;
    
    // Check for common rate limit indicators
    return (
        (error.status === 429) ||
        (error.code === 429) ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('rate limit')) ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('resource exhausted'))
    );
}

export async function handleConversation(
    prompt: string,
    onProgress?: (msg: string) => void
): Promise<{ response: string; isConversational: boolean } | null> {
    const routing = routePrompt(prompt);
    
    // Only handle with lite model if it's truly conversational
    if (routing.tier !== 'lite') {
        return null;
    }
    
    onProgress?.('Processing with fast model...');
    
    try {
        const { client, model } = getModelClient('lite');
        
        // Build context from recent messages
        const contextMessages = conversationHistory.recentMessages
            .slice(-4)
            .map(m => `${m.role === 'user' ? 'User' : 'Platypus'}: ${m.content}`)
            .join('\n');
        
        const systemPrompt = `You are Platypus, a friendly and witty AI coding assistant. You're like a helpful senior developer who is also fun to chat with.

Your personality:
- Warm, approachable, and encouraging
- Uses occasional humor but stays professional
- Always eager to help with code
- Brief but helpful responses for simple queries

${contextMessages ? `Recent conversation:\n${contextMessages}\n` : ''}

Respond naturally to the user. If they're greeting you, greet them back warmly. If they're asking what you can do, briefly explain you can help with coding tasks like fixing bugs, adding features, refactoring, and understanding codebases.

Keep responses under 2-3 sentences for simple greetings.`;

        // Retry logic with exponential backoff for rate limiting
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            try {
                const response = await client.models.generateContent({
                    model,
                    contents: [
                        { role: 'user', parts: [{ text: systemPrompt }] },
                        { role: 'user', parts: [{ text: prompt }] }
                    ],
                    config: {
                        maxOutputTokens: 200,
                        temperature: 0.8,
                    },
                });
                
                const responseText = response.text || "Hey! I'm Platypus, ready to help you code. What would you like to work on?";
                
                // Update conversation history
                conversationHistory.recentMessages.push(
                    { role: 'user', content: prompt },
                    { role: 'assistant', content: responseText }
                );
                
                // Keep only last 10 messages
                if (conversationHistory.recentMessages.length > 10) {
                    conversationHistory.recentMessages = conversationHistory.recentMessages.slice(-10);
                }
                
                return {
                    response: responseText,
                    isConversational: true
                };
            } catch (error: any) {
                attempts++;
                if (attempts >= maxAttempts || !isRateLimitError(error)) {
                    throw error;
                }
                
                // Exponential backoff
                const delay = Math.pow(2, attempts) * 1000;
                console.log(`[SmartChat] Rate limited, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw new Error('Max retries exceeded for conversational response');
        
    } catch (error) {
        console.error('[SmartChat] Error:', error);
        return null;
    }
}

/**
 * Detect if a prompt is asking about code errors
 */
export function isErrorFixRequest(prompt: string): boolean {
    const errorPatterns = [
        /\b(fix|resolve|solve|debug|correct)\s*(the|this|my)?\s*(error|bug|issue|problem)/i,
        /\b(error|bug|issue)\s*(in|with|on)\b/i,
        /\bwhy\s*(is|am|are)\s*(it|this|i)\s*(not working|failing|broken)/i,
        /\b(doesn't|does not|won't|will not|isn't|is not)\s*work/i,
    ];
    
    return errorPatterns.some(p => p.test(prompt));
}

/**
 * Detect if a prompt needs deep codebase understanding
 */
export function needsCodebaseUnderstanding(prompt: string): boolean {
    const patterns = [
        /\b(understand|analyze|explain|show me)\s*(my|the|this)?\s*(codebase|project|folder|code)/i,
        /\bhow\s*(does|do)\s*(my|the|this)?\s*(project|code|codebase|app)/i,
        /\b(what|where)\s*(is|are)\s*(the|my)?\s*(architecture|structure|flow)/i,
    ];
    
    return patterns.some(p => p.test(prompt));
}

export { conversationHistory };
