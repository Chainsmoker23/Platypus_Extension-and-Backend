import express from 'express';
import cors from 'cors';
import { analyzeRouter } from './routes/analyzeRoutes';
import { jobRouter } from './routes/jobRoutes';
import { knowledgeRouter } from './routes/knowledgeRoutes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for codebase indexing
app.use((req, _res, next) => {
  (req as any).reqId = Math.random().toString(36).substr(2, 9);
  next();
});

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API Routes
app.use('/api/analyze', analyzeRouter);
app.use('/api/jobs', jobRouter);
app.use('/api/knowledge', knowledgeRouter); // RAG & Vector DB routes

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global Error Handler
app.use((err: any, req: any, res: any, _next: any) => {
  console.error(`[error] [${req.reqId}]`, err.stack || err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

export { app };