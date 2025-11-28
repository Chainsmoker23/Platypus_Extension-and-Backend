import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

// FIX: Change to a const of type RequestHandler to resolve type inference issues
// with request and response objects, which fixes errors on properties like .on, .method, etc.
// This also resolves the argument type error for app.use() in app.ts.
export const loggingMiddleware: RequestHandler = (req, res, next) => {
  const requestId = uuidv4();
  // @ts-ignore
  req.id = requestId;
  
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] Request [${requestId}] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms`
    );
  });
  
  next();
}