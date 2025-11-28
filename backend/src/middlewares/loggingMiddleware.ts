import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function loggingMiddleware(req: Request, res: Response, next: NextFunction) {
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
