/**
 * Centralized Error Handling System
 * Provides error classification, recovery strategies, and user-friendly messages
 */

import logger from './logger';

export enum ErrorCode {
    // Client errors (400-499)
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    INVALID_INPUT = 'INVALID_INPUT',
    MISSING_PARAMETER = 'MISSING_PARAMETER',
    FILE_TOO_LARGE = 'FILE_TOO_LARGE',
    UNAUTHORIZED = 'UNAUTHORIZED',
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    
    // Server errors (500-599)
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    LLM_API_ERROR = 'LLM_API_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT_ERROR = 'TIMEOUT_ERROR',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    
    // Business logic errors
    PROCESSING_ERROR = 'PROCESSING_ERROR',
    INVALID_STATE = 'INVALID_STATE',
    RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
}

export interface AppError {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details?: any;
    isRetryable: boolean;
    userMessage: string;
}

class ErrorHandler {
    /**
     * Create standardized error object
     */
    createError(
        code: ErrorCode,
        message: string,
        details?: any,
        isRetryable: boolean = false
    ): AppError {
        const statusCode = this.getStatusCode(code);
        const userMessage = this.getUserMessage(code, message);

        return {
            code,
            message,
            statusCode,
            details,
            isRetryable,
            userMessage
        };
    }

    /**
     * Handle and classify errors
     */
    handleError(error: any, requestId?: string): AppError {
        const logContext = { requestId, originalError: error };

        // Rate limit errors
        if (this.isRateLimitError(error)) {
            logger.warn('Rate limit exceeded', logContext, requestId);
            return this.createError(
                ErrorCode.RATE_LIMIT_EXCEEDED,
                'API rate limit exceeded',
                { retryAfter: error.retryAfter || 1000 },
                true
            );
        }

        // Network/timeout errors
        if (this.isNetworkError(error)) {
            logger.error('Network error occurred', error, logContext, requestId);
            return this.createError(
                ErrorCode.NETWORK_ERROR,
                'Network communication failed',
                { originalMessage: error.message },
                true
            );
        }

        // LLM API errors
        if (this.isLLMError(error)) {
            logger.error('LLM API error', error, logContext, requestId);
            return this.createError(
                ErrorCode.LLM_API_ERROR,
                'AI service error',
                { originalMessage: error.message },
                true
            );
        }

        // Validation errors
        if (error.name === 'ZodError' || error.name === 'ValidationError') {
            logger.warn('Validation error', { ...logContext, errors: error.errors }, requestId);
            return this.createError(
                ErrorCode.VALIDATION_ERROR,
                'Invalid request data',
                { errors: error.errors || error.message },
                false
            );
        }

        // Database errors
        if (this.isDatabaseError(error)) {
            logger.error('Database error', error, logContext, requestId);
            return this.createError(
                ErrorCode.DATABASE_ERROR,
                'Database operation failed',
                { originalMessage: error.message },
                true
            );
        }

        // Default internal error
        logger.error('Unhandled error', error, logContext, requestId);
        return this.createError(
            ErrorCode.INTERNAL_ERROR,
            error.message || 'An unexpected error occurred',
            { stack: error.stack },
            false
        );
    }

    /**
     * Check if error is retryable
     */
    isRetryable(error: AppError | any): boolean {
        if (typeof error === 'object' && 'isRetryable' in error) {
            return error.isRetryable;
        }

        return this.isRateLimitError(error) || 
               this.isNetworkError(error) ||
               this.isTimeoutError(error);
    }

    /**
     * Get retry delay with exponential backoff
     */
    getRetryDelay(attempt: number, baseDelay: number = 1000): number {
        const maxDelay = 30000; // 30 seconds
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * delay;
        return Math.floor(delay + jitter);
    }

    /**
     * Execute with retry logic
     */
    async withRetry<T>(
        fn: () => Promise<T>,
        options: {
            maxAttempts?: number;
            baseDelay?: number;
            onRetry?: (attempt: number, error: any) => void;
            requestId?: string;
        } = {}
    ): Promise<T> {
        const { 
            maxAttempts = 3, 
            baseDelay = 1000, 
            onRetry,
            requestId 
        } = options;

        let lastError: any;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const appError = this.handleError(error, requestId);

                if (!this.isRetryable(appError) || attempt === maxAttempts - 1) {
                    throw appError;
                }

                const delay = this.getRetryDelay(attempt, baseDelay);
                logger.warn(
                    `Retry attempt ${attempt + 1}/${maxAttempts} after ${delay}ms`,
                    { error: appError, attempt },
                    requestId
                );

                onRetry?.(attempt + 1, error);
                await this.sleep(delay);
            }
        }

        throw lastError;
    }

    /**
     * Execute with timeout
     */
    async withTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
        requestId?: string
    ): Promise<T> {
        return Promise.race([
            fn(),
            new Promise<T>((_, reject) => {
                setTimeout(() => {
                    logger.error('Operation timeout', null, { timeoutMs }, requestId);
                    reject(this.createError(
                        ErrorCode.TIMEOUT_ERROR,
                        `Operation timed out after ${timeoutMs}ms`,
                        { timeoutMs },
                        true
                    ));
                }, timeoutMs);
            })
        ]);
    }

    // Helper methods
    private getStatusCode(code: ErrorCode): number {
        const statusMap: Record<ErrorCode, number> = {
            [ErrorCode.VALIDATION_ERROR]: 400,
            [ErrorCode.INVALID_INPUT]: 400,
            [ErrorCode.MISSING_PARAMETER]: 400,
            [ErrorCode.FILE_TOO_LARGE]: 413,
            [ErrorCode.UNAUTHORIZED]: 401,
            [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
            [ErrorCode.INTERNAL_ERROR]: 500,
            [ErrorCode.LLM_API_ERROR]: 502,
            [ErrorCode.DATABASE_ERROR]: 500,
            [ErrorCode.NETWORK_ERROR]: 503,
            [ErrorCode.TIMEOUT_ERROR]: 504,
            [ErrorCode.SERVICE_UNAVAILABLE]: 503,
            [ErrorCode.PROCESSING_ERROR]: 500,
            [ErrorCode.INVALID_STATE]: 409,
            [ErrorCode.RESOURCE_NOT_FOUND]: 404,
        };

        return statusMap[code] || 500;
    }

    private getUserMessage(code: ErrorCode, technicalMessage: string): string {
        const userMessages: Record<ErrorCode, string> = {
            [ErrorCode.VALIDATION_ERROR]: 'The request contains invalid data. Please check your input.',
            [ErrorCode.INVALID_INPUT]: 'The provided input is not valid. Please try again.',
            [ErrorCode.MISSING_PARAMETER]: 'Required information is missing. Please provide all necessary details.',
            [ErrorCode.FILE_TOO_LARGE]: 'The file is too large to process. Please try with a smaller file.',
            [ErrorCode.UNAUTHORIZED]: 'You are not authorized to perform this action.',
            [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please wait a moment and try again.',
            [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred. Our team has been notified.',
            [ErrorCode.LLM_API_ERROR]: 'The AI service is temporarily unavailable. Please try again shortly.',
            [ErrorCode.DATABASE_ERROR]: 'A database error occurred. Please try again.',
            [ErrorCode.NETWORK_ERROR]: 'Network connection failed. Please check your connection and try again.',
            [ErrorCode.TIMEOUT_ERROR]: 'The operation took too long and was cancelled. Please try again.',
            [ErrorCode.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable. Please try again later.',
            [ErrorCode.PROCESSING_ERROR]: 'An error occurred while processing your request.',
            [ErrorCode.INVALID_STATE]: 'The requested operation cannot be performed in the current state.',
            [ErrorCode.RESOURCE_NOT_FOUND]: 'The requested resource was not found.',
        };

        return userMessages[code] || technicalMessage;
    }

    private isRateLimitError(error: any): boolean {
        return (
            error?.status === 429 ||
            error?.code === 429 ||
            (typeof error?.message === 'string' && error.message.toLowerCase().includes('rate limit')) ||
            (typeof error?.message === 'string' && error.message.toLowerCase().includes('resource exhausted'))
        );
    }

    private isNetworkError(error: any): boolean {
        return (
            error?.code === 'ECONNREFUSED' ||
            error?.code === 'ENOTFOUND' ||
            error?.code === 'ETIMEDOUT' ||
            error?.code === 'ECONNRESET' ||
            (typeof error?.message === 'string' && error.message.toLowerCase().includes('network'))
        );
    }

    private isTimeoutError(error: any): boolean {
        return (
            error?.code === 'ETIMEDOUT' ||
            error?.code === ErrorCode.TIMEOUT_ERROR ||
            (typeof error?.message === 'string' && error.message.toLowerCase().includes('timeout'))
        );
    }

    private isLLMError(error: any): boolean {
        return (
            error?.code === 'LLM_ERROR' ||
            error?.message?.includes('gemini') ||
            error?.message?.includes('model')
        );
    }

    private isDatabaseError(error: any): boolean {
        return (
            error?.code === 'ENOTFOUND' && error?.message?.includes('qdrant') ||
            error?.message?.includes('database') ||
            error?.message?.includes('collection')
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance
const errorHandler = new ErrorHandler();

export default errorHandler;
