
import { Request, Response } from 'express';
import { z } from 'zod';
import { runAgent } from '../agent/agent';
import { handleConversation } from '../services/smartChat';

const analysisSchema = z.object({
  prompt: z.string().min(1),
  files: z.array(z.object({
    filePath: z.string(),
    content: z.string(),
  })),
  jobId: z.string().optional(),
  selectedFilePaths: z.array(z.string()).optional(),
  diagnostics: z.array(z.string()).optional(),
  workspaceId: z.string().optional(), // For RAG context
  model: z.string().optional(), // Manual model selection
});

export const handleAnalysisRequest = async (req: Request, res: Response) => {
  const requestId = (req as any).reqId ?? 'unknown';

  let parsed: z.infer<typeof analysisSchema>;
  try {
    parsed = analysisSchema.parse((req as any).body);
  } catch (err) {
    console.error(`[${requestId}] Invalid analyze payload`, err);
    res.status(400).json({ error: 'Invalid request payload' });
    return;
  }

  const { prompt, files, selectedFilePaths = [], diagnostics = [], workspaceId, model } = parsed;

  (res as any).setHeader('Content-Type', 'application/x-ndjson');
  (res as any).setHeader('Transfer-Encoding', 'chunked');

  const writeProgress = (message: string) => {
    (res as any).write(JSON.stringify({ type: 'progress', message }) + '\n');
  };

  try {
    console.log(`[${requestId}] analyze: ${prompt.slice(0, 120)}... (${files.length} files)`);
    
    // Try smart chat for simple conversational prompts
    const conversationResult = await handleConversation(prompt, writeProgress);
    if (conversationResult?.isConversational) {
      // Simple chat response - no code changes
      (res as any).write(JSON.stringify({ 
        type: 'result', 
        data: {
          reasoning: conversationResult.response,
          changes: [],
        }
      }) + '\n');
      (res as any).end();
      return;
    }
    
    // For non-conversational prompts, proceed with full analysis
    writeProgress('Analyzing workspace structure...');
    writeProgress('Planning changes...');
    
    // More detailed progress updates
    const progressInterval = setInterval(() => {
      writeProgress('Still working on your request...');
    }, 5000);

    const result = await runAgent({
      prompt,
      files,
      selectedFilePaths,
      diagnostics,
      workspaceId,
      model, // Pass model selection
      onProgress: writeProgress,
    });
    
    clearInterval(progressInterval);

    (res as any).write(JSON.stringify({ type: 'result', data: result }) + '\n');
    (res as any).end();
  } catch (error: any) {
    console.error(`[${requestId}] Agent error`, error);
    (res as any).write(JSON.stringify({
      type: 'error',
      error: { message: error?.message || 'Agent failed' },
    }) + '\n');
    (res as any).end();
  }
};
