import { Router } from 'express';
import {
    handleIndexCodebase,
    handleSearchCodebase,
    handleGetStatus,
    handleUpdateFile,
    handleGetContext,
} from '../controllers/knowledgeController';

const router = Router();

// POST /api/knowledge/index - Index entire codebase
router.post('/index', handleIndexCodebase as any);

// POST /api/knowledge/search - Search indexed codebase
router.post('/search', handleSearchCodebase as any);

// GET /api/knowledge/status/:workspaceId - Get indexing status
router.get('/status/:workspaceId', handleGetStatus as any);

// POST /api/knowledge/update-file - Update single file (incremental)
router.post('/update-file', handleUpdateFile as any);

// POST /api/knowledge/context - Get RAG context for prompt
router.post('/context', handleGetContext as any);

export { router as knowledgeRouter };
