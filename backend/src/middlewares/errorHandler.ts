import { ErrorRequestHandler } from 'express';

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

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const requestId = (req as any).id || 'N/A';

    if (err.name === 'AbortError') {
        console.log(`[${requestId}] Request aborted: ${err.message}`);
        return res.status(499).json({
            code: 'request/aborted',
            message: 'The analysis request was cancelled by the client.',
        });
    }

    if (isApiError(err)) {
        console.error(`[${requestId}] API Error: ${err.code} - ${err.message}`, err.details || '');
        return res.status(err.statusCode).json({
            code: err.code,
            message: err.message,
            details: err.details,
        });
    }

    console.error(`[${requestId}] Unhandled Error:`, err);
    return res.status(500).json({
        code: 'internal/unknown_error',
        message: 'An unexpected internal server error occurred.',
        details: err.message,
    });
};
