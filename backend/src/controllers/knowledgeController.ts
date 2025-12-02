import { Request, Response } from 'express';
import { z } from 'zod';
import * as ragService from '../services/ragService';
import crypto from 'crypto';

// Validation schemas
const indexRequestSchema = z.object({
    workspaceId: z.string().optional(),
    files: z.array(z.object({
        filePath: z.string(),
        content: z.string(),
    })),
});

const searchRequestSchema = z.object({
    workspaceId: z.string(),
    query: z.string().min(1),
    limit: z.number().min(1).max(50).optional().default(10),
});

const updateFileSchema = z.object({
    workspaceId: z.string(),
    file: z.object({
        filePath: z.string(),
        content: z.string(),
    }),
});

/**
 * POST /api/knowledge/index
 * Index the entire codebase
 */
export const handleIndexCodebase = async (req: Request, res: Response) => {
    const requestId = (req as any).reqId ?? 'unknown';

    let parsed: z.infer<typeof indexRequestSchema>;
    try {
        parsed = indexRequestSchema.parse(req.body);
    } catch (err) {
        console.error(`[${requestId}] Invalid index payload`, err);
        res.status(400).json({ error: 'Invalid request payload' });
        return;
    }

    // Generate workspace ID if not provided (based on file paths hash)
    const workspaceId = parsed.workspaceId || generateWorkspaceId(parsed.files);

    // Set up streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const writeProgress = (progress: ragService.IndexingProgress) => {
        res.write(JSON.stringify({ type: 'progress', data: progress }) + '\n');
    };

    try {
        console.log(`[${requestId}] Indexing ${parsed.files.length} files for workspace ${workspaceId}`);

        writeProgress({
            phase: 'parsing',
            current: 0,
            total: parsed.files.length,
            message: 'Starting codebase indexing...',
        });

        const result = await ragService.indexCodebase(
            workspaceId,
            parsed.files,
            writeProgress
        );

        res.write(JSON.stringify({
            type: 'result',
            data: {
                success: true,
                workspaceId,
                chunksIndexed: result.chunksIndexed,
                filesProcessed: result.filesProcessed,
            },
        }) + '\n');
        res.end();

    } catch (error: any) {
        console.error(`[${requestId}] Indexing error:`, error);
        res.write(JSON.stringify({
            type: 'error',
            error: { message: error?.message || 'Indexing failed' },
        }) + '\n');
        res.end();
    }
};

/**
 * POST /api/knowledge/search
 * Search the indexed codebase
 */
export const handleSearchCodebase = async (req: Request, res: Response) => {
    const requestId = (req as any).reqId ?? 'unknown';

    let parsed: z.infer<typeof searchRequestSchema>;
    try {
        parsed = searchRequestSchema.parse(req.body);
    } catch (err) {
        console.error(`[${requestId}] Invalid search payload`, err);
        res.status(400).json({ error: 'Invalid request payload' });
        return;
    }

    try {
        console.log(`[${requestId}] Searching: "${parsed.query.slice(0, 100)}..."`);

        const results = await ragService.searchCodebase(
            parsed.workspaceId,
            parsed.query,
            parsed.limit
        );

        res.json({
            success: true,
            query: parsed.query,
            results: results.chunks.map(r => ({
                filePath: r.chunk.filePath,
                content: r.chunk.content,
                startLine: r.chunk.startLine,
                endLine: r.chunk.endLine,
                type: r.chunk.type,
                score: r.score,
            })),
            summary: results.summary,
        });

    } catch (error: any) {
        console.error(`[${requestId}] Search error:`, error);
        res.status(500).json({
            error: 'Search failed',
            details: error?.message,
        });
    }
};

/**
 * GET /api/knowledge/status/:workspaceId
 * Get indexing status for a workspace
 */
export const handleGetStatus = async (req: Request, res: Response) => {
    const requestId = (req as any).reqId ?? 'unknown';
    const { workspaceId } = req.params;

    if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' });
        return;
    }

    try {
        const status = await ragService.getIndexStatus(workspaceId);

        res.json({
            success: true,
            workspaceId,
            ...status,
        });

    } catch (error: any) {
        console.error(`[${requestId}] Status error:`, error);
        res.status(500).json({
            error: 'Failed to get status',
            details: error?.message,
        });
    }
};

/**
 * POST /api/knowledge/update-file
 * Update index for a single file (incremental)
 */
export const handleUpdateFile = async (req: Request, res: Response) => {
    const requestId = (req as any).reqId ?? 'unknown';

    let parsed: z.infer<typeof updateFileSchema>;
    try {
        parsed = updateFileSchema.parse(req.body);
    } catch (err) {
        console.error(`[${requestId}] Invalid update payload`, err);
        res.status(400).json({ error: 'Invalid request payload' });
        return;
    }

    try {
        console.log(`[${requestId}] Updating file: ${parsed.file.filePath}`);

        const chunksUpdated = await ragService.updateFileIndex(
            parsed.workspaceId,
            parsed.file
        );

        res.json({
            success: true,
            filePath: parsed.file.filePath,
            chunksUpdated,
        });

    } catch (error: any) {
        console.error(`[${requestId}] Update error:`, error);
        res.status(500).json({
            error: 'Update failed',
            details: error?.message,
        });
    }
};

/**
 * POST /api/knowledge/context
 * Get RAG context for a prompt (used internally by agent)
 */
export const handleGetContext = async (req: Request, res: Response) => {
    const requestId = (req as any).reqId ?? 'unknown';

    const { workspaceId, prompt, maxChunks } = req.body;

    if (!workspaceId || !prompt) {
        res.status(400).json({ error: 'workspaceId and prompt are required' });
        return;
    }

    try {
        const context = await ragService.getContextForPrompt(
            workspaceId,
            prompt,
            maxChunks || 8
        );

        res.json({
            success: true,
            context,
            hasContext: context.length > 0,
        });

    } catch (error: any) {
        console.error(`[${requestId}] Context error:`, error);
        res.status(500).json({
            error: 'Failed to get context',
            details: error?.message,
        });
    }
};

// Helper to generate a stable workspace ID from files
function generateWorkspaceId(files: { filePath: string }[]): string {
    // Use the first few file paths to create a hash
    const paths = files.slice(0, 5).map(f => f.filePath).sort().join(':');
    return crypto.createHash('md5').update(paths).digest('hex').slice(0, 16);
}
