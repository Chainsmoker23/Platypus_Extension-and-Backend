
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const loggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  // FIX: Removed @ts-ignore as the custom 'id' property is now defined in 'backend/src/types/express/index.d.ts'.
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