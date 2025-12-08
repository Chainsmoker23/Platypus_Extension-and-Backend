import express from 'express';
import cors from 'cors';
import { analyzeRouter } from './routes/analyzeRoutes';
import { jobRouter } from './routes/jobRoutes';
import { knowledgeRouter } from './routes/knowledgeRoutes';
import logger from './utils/logger';
import errorHandler from './utils/errorHandler';
import healthMonitor from './utils/healthMonitor';
import apiKeyPool from './services/apiKeyPool';
import { v4 as uuidv4 } from 'uuid';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for codebase indexing

// Request tracking middleware with structured logging
app.use((req, _res, next) => {
  const requestId = uuidv4();
  (req as any).reqId = requestId;
  (req as any).logger = logger.child(requestId);
  
  // Start health monitoring
  healthMonitor.startRequest(requestId, req.path);
  
  // Log incoming request
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent')
  }, requestId);
  
  next();
});

// Response time tracking
app.use((req, res, next) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const requestId = (req as any).reqId;
    
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration
    }, requestId);
    
    healthMonitor.endRequest(requestId, res.statusCode < 400);
  });
  next();
});

// Enhanced Health Check with detailed metrics
app.get('/api/health', (_req, res) => {
  const health = healthMonitor.getHealthStatus();
  res.status(health.status === 'healthy' ? 200 : 503).json({
    status: health.status,
    timestamp: new Date().toISOString(),
    uptime: health.metrics.uptime,
    memory: health.metrics.memory,
    services: health.metrics.services,
    requests: health.metrics.requests
  });
});

// Detailed metrics endpoint
app.get('/api/metrics', (_req, res) => {
  const metrics = healthMonitor.getMetrics();
  res.json({
    timestamp: new Date().toISOString(),
    ...metrics
  });
});

// API Key Pool status endpoint
app.get('/api/keys/status', (_req, res) => {
  const stats = apiKeyPool.getStats();
  res.json({
    timestamp: new Date().toISOString(),
    apiKeyPool: {
      totalKeys: stats.totalKeys,
      healthyKeys: stats.healthyKeys,
      rateLimitedKeys: stats.rateLimitedKeys,
      disabledKeys: stats.disabledKeys,
      totalRequests: stats.totalRequests,
      successRate: Math.round(stats.successRate * 100) + '%'
    }
  });
});

// API Routes
app.use('/api/analyze', analyzeRouter);
app.use('/api/jobs', jobRouter);
app.use('/api/knowledge', knowledgeRouter); // RAG & Vector DB routes

// 404 Handler
app.use((req, res) => {
  const requestId = (req as any).reqId;
  logger.warn('Route not found', { path: req.path, method: req.method }, requestId);
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    requestId 
  });
});

// Global Error Handler with structured error handling
app.use((err: any, req: any, res: any, _next: any) => {
  const requestId = req.reqId || 'unknown';
  const appError = errorHandler.handleError(err, requestId);
  
  res.status(appError.statusCode).json({
    error: appError.code,
    message: appError.userMessage,
    requestId,
    ...(process.env.NODE_ENV === 'development' && {
      details: appError.details,
      stack: err.stack
    })
  });
});

export { app };