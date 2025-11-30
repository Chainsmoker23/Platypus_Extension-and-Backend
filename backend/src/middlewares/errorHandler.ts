
import { Request, Response, NextFunction } from 'express';

interface ApiError {
    code: string;
    message: string;
    details?: any;
    statusCode: number;
}

// A type guard for our custom error
function isApiError(error: any): error is ApiError {
    return typeof error === 'object' && error !== null && 'code' in error && 'message' in error && 'statusCode' in error;
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).id || 'N/A';

    if (err.name === 'AbortError') {
        console.log(`[${requestId}] Request aborted: ${err.message}`);
        // FIX: Cast res to any to access status
        return (res as any).status(499).json({
            code: 'request/aborted',
            message: 'The analysis request was cancelled by the client.',
        });
    }

    if (isApiError(err)) {
        console.error(`[${requestId}] API Error: ${err.code} - ${err.message}`, err.details || '');
        // FIX: Cast res to any to access status
        return (res as any).status(err.statusCode).json({
            code: err.code,
            message: err.message,
            details: err.details,
        });
    }

    console.error(`[${requestId}] Unhandled Error:`, err);
    // FIX: Cast res to any to access status
    return (res as any).status(500).json({
        code: 'internal/unknown_error',
        message: 'An unexpected internal server error occurred.',
        details: err.message,
    });
};
