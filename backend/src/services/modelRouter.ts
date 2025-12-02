import { GoogleGenAI } from '@google/genai';

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

// Model configuration
const MODELS = {
    // Fast model for simple conversations, greetings, quick answers
    FLASH_LITE: 'gemini-2.0-flash-lite',
    // Standard model for moderate tasks
    FLASH: 'gemini-2.0-flash',
    // Advanced reasoning model for complex code generation
    REASONING: 'gemini-2.5-pro',
    // Experimental preview model for cutting-edge capabilities
    PREVIEW: 'gemini-3.0-preview',
};

export type ModelTier = 'lite' | 'standard' | 'reasoning' | 'preview';

interface RoutingDecision {
    model: string;
    tier: ModelTier;
    reason: string;
}

// Keywords that indicate simple conversational intent
const CONVERSATIONAL_PATTERNS = [
    /^(hi|hello|hey|hii+|sup|yo|thanks?|thank you|good (morning|evening|night|afternoon))[\s!.?]*$/i,
    /^(what'?s? up|how are you|who are you|what can you do)[\s!.?]*$/i,
    /^(ok|okay|sure|yes|no|yep|nope|cool|great|awesome|nice)[\s!.?]*$/i,
];

// Keywords that indicate code-heavy operations requiring reasoning
const REASONING_PATTERNS = [
    /\b(refactor|optimize|architect|redesign|restructure|enhance)\b/i,
    /\b(implement|create|build|develop|design)\s+(a|an|the)?\s*(new|complex|full|complete|advanced|robust)\b/i,
    /\b(fix|debug|solve|resolve)\s+(all|multiple|complex|critical|advanced)\b/i,
    /\b(add|create)\s+\w+\s+(feature|system|module|service|component)/i,
    /\b(understand|analyze|explain|scan)\s+(my|the|this)\s+(codebase|project|architecture|entire folder)\b/i,
    /\bmulti(ple)?\s*file/i,
    /\bentire\s+(project|codebase|folder)/i,
    /\bsystem\s+wide\s+(changes?|modifications?|enhancements?)/i,
];

// Keywords that indicate need for preview/experimental model
const PREVIEW_PATTERNS = [
    /\benhance(d?)\s+(system|codebase|project|application|software)\b/i,
    /\b(make|implement)\s+(my\s+)?(system\s+)?(more\s+)?advanced\b/i,
    /\b(complete|full|major)\s+(refactor|redesign|restructure|enhancement|upgrade)\b/i,
    /\b(deep\s+)?(analysis|understanding|scan)\s+(of\s+)?(entire\s+)?codebase\b/i,
    /\bcross\s*file\s+(dependency|analysis|modification|integration)/i,
    /\binterconnected\s+(components?|modules?|systems?|services?)/i,
    /\b(make|implement).*\b(connected|linked|related)\b.*\b(changes|modifications)\b/i,
    /\bsystem\s+level\s+(enhancement|improvement|upgrade)/i,
];

// Keywords for standard code tasks
const CODE_PATTERNS = [
    /\b(fix|add|remove|update|change|modify|edit)\b/i,
    /\b(function|class|method|variable|component|file)\b/i,
    /\b(error|bug|issue|problem)\b/i,
    /\b(import|export|type|interface)\b/i,
    /\.(ts|tsx|js|jsx|py|java|go|rs|cpp|c)\b/i,
];

/**
 * Determines which model to use based on prompt complexity
 */
export function routePrompt(prompt: string, hasSelectedFiles: boolean = false): RoutingDecision {
    const trimmedPrompt = prompt.trim();
    const wordCount = trimmedPrompt.split(/\s+/).length;
    
    // Very short conversational messages → Flash Lite
    if (wordCount <= 5 && CONVERSATIONAL_PATTERNS.some(p => p.test(trimmedPrompt))) {
        return {
            model: MODELS.FLASH_LITE,
            tier: 'lite',
            reason: 'Conversational greeting or simple response'
        };
    }
    
    // Preview model for advanced enhancement requests
    if (PREVIEW_PATTERNS.some(p => p.test(trimmedPrompt))) {
        return {
            model: MODELS.PREVIEW,
            tier: 'preview',
            reason: 'Advanced enhancement requiring preview model'
        };
    }
    
    // Short prompts without code keywords → Flash Lite
    if (wordCount <= 10 && !CODE_PATTERNS.some(p => p.test(trimmedPrompt))) {
        return {
            model: MODELS.FLASH_LITE,
            tier: 'lite',
            reason: 'Short non-technical query'
        };
    }
    
    // Complex operations requiring deep reasoning → Reasoning model
    if (REASONING_PATTERNS.some(p => p.test(trimmedPrompt))) {
        return {
            model: MODELS.REASONING,
            tier: 'reasoning',
            reason: 'Complex code operation requiring deep analysis'
        };
    }
    
    // Multiple files selected → Reasoning model
    if (hasSelectedFiles) {
        return {
            model: MODELS.REASONING,
            tier: 'reasoning',
            reason: 'Multi-file operation'
        };
    }
    
    // Long prompts → Reasoning model
    if (wordCount > 50) {
        return {
            model: MODELS.REASONING,
            tier: 'reasoning',
            reason: 'Detailed request requiring careful analysis'
        };
    }
    
    // Standard code operations → Flash
    if (CODE_PATTERNS.some(p => p.test(trimmedPrompt))) {
        return {
            model: MODELS.FLASH,
            tier: 'standard',
            reason: 'Standard code modification'
        };
    }
    
    // Default to Flash for general queries
    return {
        model: MODELS.FLASH,
        tier: 'standard',
        reason: 'General query'
    };
}

/**
 * Get a client for the appropriate model
 */
export function getModelClient(tier: ModelTier = 'standard'): { client: GoogleGenAI; model: string } {
    const apiKey = process.env.AGENT_API_KEY || process.env.GEMINI_KEYS?.split(',')[0];
    if (!apiKey) {
        throw new Error('No API key configured');
    }
    
    const client = new GoogleGenAI({ apiKey: apiKey.trim() });
    
    switch (tier) {
        case 'lite':
            return { client, model: MODELS.FLASH_LITE };
        case 'preview':
            return { client, model: MODELS.PREVIEW };
        case 'reasoning':
            return { client, model: MODELS.REASONING };
        default:
            return { client, model: MODELS.FLASH };
    }
}

/**
 * Quick response for simple conversational queries
 */
export async function quickConversationalResponse(prompt: string): Promise<string | null> {
    const routing = routePrompt(prompt);
    
    if (routing.tier !== 'lite') {
        return null; // Not a simple conversational query
    }
    
    try {
        const { client, model } = getModelClient('lite');
        
        // Retry logic with exponential backoff for rate limiting
        let attempts = 0;
        const maxAttempts = 3;
        let response: any;
        
        while (attempts < maxAttempts) {
            try {
                response = await client.models.generateContent({
                    model,
                    contents: `You are Platypus, a friendly AI coding assistant. Respond briefly and warmly to: "${prompt}"`,
                    config: {
                        maxOutputTokens: 150,
                        temperature: 0.7,
                    },
                });
                break; // Success, exit retry loop
                
            } catch (error: any) {
                attempts++;
                if (attempts >= maxAttempts || !isRateLimitError(error)) {
                    throw error;
                }
                
                // Exponential backoff
                const delay = Math.pow(2, attempts) * 1000;
                console.log(`[ModelRouter] Rate limited, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        if (attempts >= maxAttempts) {
            throw new Error('Max retries exceeded for quick response');
        }
        
        return response.text || null;
    } catch (e) {
        console.error('[ModelRouter] Quick response failed:', e);
        return null;
    }
}

export { MODELS };
