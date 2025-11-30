import express from 'express';
import cors from 'cors';
import { analyzeRouter } from './routes/analyzeRoutes';
import { jobRouter } from './routes/jobRoutes';
import { codeIntelligenceRouter } from './routes/codeIntelligenceRoutes';
import { loggingMiddleware } from './middlewares/loggingMiddleware';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

// Core Middlewares
app.use(cors() as any);
app.use(express.json({ limit: '50mb' }) as any);

// Custom Middlewares
// FIX: Cast loggingMiddleware to any to avoid type mismatch issues with Express RequestHandler
app.use(loggingMiddleware as any);

// API Routes
app.get('/', (req, res) => {
  res.send('Platypus Backend is running!');
});
app.use('/api/v1/analyze', analyzeRouter);
app.use('/api/v1/jobs', jobRouter);
app.use('/api/v1/code-intelligence', codeIntelligenceRouter);


// Error Handling Middleware (must be last)
app.use(errorHandler);

export { app };