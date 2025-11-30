
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const loggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  // FIX: Cast req to any to set custom id property
  (req as any).id = requestId;
  
  const startTime = Date.now();

  // FIX: Cast res to any to access 'on'
  (res as any).on('finish', () => {
    const duration = Date.now() - startTime;
    // FIX: Cast req and res to any to access method, originalUrl, statusCode
    console.log(
      `[${new Date().toISOString()}] Request [${requestId}] ${(req as any).method} ${(req as any).originalUrl} - Status: ${(res as any).statusCode} - Duration: ${duration}ms`
    );
  });
  
  next();
}
