
import { Request, Response } from 'express';
import { z } from 'zod';
import { runAgent } from '../agent/agent';
import { handleConversation } from '../services/smartChat';
import logger from '../utils/logger';
import errorHandler from '../utils/errorHandler';
import { ProgressTracker } from '../utils/progressTracker';

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
  
  // Enhanced progress tracker for detailed updates
  const progressTracker = new ProgressTracker((update) => {
    // Send structured progress updates
    (res as any).write(JSON.stringify({ 
      type: 'progress-detailed', 
      data: update 
    }) + '\n');
  });

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
    progressTracker.initializing('Analyzing workspace structure...');
    progressTracker.analyzing('Planning changes...', 0, 100);
    
    // More detailed progress updates
    const progressInterval = setInterval(() => {
      progressTracker.searching('Still working on your request...');
    }, 5000);

    const result = await runAgent({
      prompt,
      files,
      selectedFilePaths,
      diagnostics,
      workspaceId,
      model, // Pass model selection
      onProgress: (message: string) => {
        // Send both legacy and enhanced progress updates
        writeProgress(message);
        progressTracker.generating(message);
      },
    });
    
    clearInterval(progressInterval);

    (res as any).write(JSON.stringify({ type: 'result', data: result }) + '\n');
    (res as any).end();
  } catch (error: any) {
    const log = logger.child(requestId);
    const appError = errorHandler.handleError(error, requestId);
    
    log.error('Agent error', error, {
      prompt: prompt.slice(0, 100),
      filesCount: files.length,
      errorCode: appError.code
    });
    
    (res as any).write(JSON.stringify({
      type: 'error',
      error: { 
        message: appError.userMessage,
        code: appError.code,
        isRetryable: appError.isRetryable
      },
    }) + '\n');
    (res as any).end();
  }
};
