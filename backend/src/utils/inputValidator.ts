/**
 * Input Validation & Sanitization Utilities
 * Ensures all user inputs are safe and valid
 */

import { z } from 'zod';
import errorHandler, { ErrorCode } from './errorHandler';

export class InputValidator {
    /**
     * Validate and sanitize file path
     */
    static validateFilePath(filePath: string): string {
        if (!filePath || typeof filePath !== 'string') {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'File path must be a non-empty string'
            );
        }

        // Remove null bytes and control characters
        const sanitized = filePath.replace(/[\x00-\x1F\x7F]/g, '');

        // Check for path traversal attempts
        if (sanitized.includes('..') || sanitized.includes('~')) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Invalid file path: path traversal detected',
                { originalPath: filePath }
            );
        }

        // Check for absolute paths (we expect relative paths)
        if (sanitized.startsWith('/') || sanitized.match(/^[A-Za-z]:\\/)) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Absolute paths are not allowed',
                { originalPath: filePath }
            );
        }

        return sanitized;
    }

    /**
     * Validate file content size
     */
    static validateFileSize(content: string, maxSizeKB: number = 200): void {
        const sizeKB = Buffer.byteLength(content, 'utf8') / 1024;
        
        if (sizeKB > maxSizeKB) {
            throw errorHandler.createError(
                ErrorCode.FILE_TOO_LARGE,
                `File size (${Math.round(sizeKB)}KB) exceeds maximum (${maxSizeKB}KB)`,
                { sizeKB, maxSizeKB }
            );
        }
    }

    /**
     * Validate and sanitize prompt
     */
    static validatePrompt(prompt: string, maxLength: number = 10000): string {
        if (!prompt || typeof prompt !== 'string') {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Prompt must be a non-empty string'
            );
        }

        // Trim whitespace
        const sanitized = prompt.trim();

        if (sanitized.length === 0) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Prompt cannot be empty'
            );
        }

        if (sanitized.length > maxLength) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                `Prompt too long (${sanitized.length} characters, max ${maxLength})`,
                { length: sanitized.length, maxLength }
            );
        }

        return sanitized;
    }

    /**
     * Validate workspace ID
     */
    static validateWorkspaceId(workspaceId: string): string {
        if (!workspaceId || typeof workspaceId !== 'string') {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Workspace ID must be a non-empty string'
            );
        }

        // Workspace ID should be alphanumeric and hyphens only
        if (!/^[a-zA-Z0-9-_]+$/.test(workspaceId)) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Invalid workspace ID format',
                { workspaceId }
            );
        }

        return workspaceId;
    }

    /**
     * Validate array of file paths
     */
    static validateFilePaths(filePaths: unknown): string[] {
        if (!Array.isArray(filePaths)) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'File paths must be an array'
            );
        }

        if (filePaths.length === 0) {
            return [];
        }

        // Validate each file path
        return filePaths.map((fp, index) => {
            try {
                return InputValidator.validateFilePath(fp);
            } catch (error) {
                throw errorHandler.createError(
                    ErrorCode.INVALID_INPUT,
                    `Invalid file path at index ${index}`,
                    { index, filePath: fp, error }
                );
            }
        });
    }

    /**
     * Validate file object
     */
    static validateFileObject(file: unknown): { filePath: string; content: string } {
        const schema = z.object({
            filePath: z.string().min(1),
            content: z.string()
        });

        try {
            const validated = schema.parse(file);
            
            // Additional validation
            const sanitizedPath = InputValidator.validateFilePath(validated.filePath);
            InputValidator.validateFileSize(validated.content);

            return {
                filePath: sanitizedPath,
                content: validated.content
            };
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw errorHandler.createError(
                    ErrorCode.VALIDATION_ERROR,
                    'Invalid file object structure',
                    { errors: error.errors }
                );
            }
            throw error;
        }
    }

    /**
     * Validate array of files
     */
    static validateFiles(files: unknown, maxFiles: number = 1000): Array<{ filePath: string; content: string }> {
        if (!Array.isArray(files)) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Files must be an array'
            );
        }

        if (files.length > maxFiles) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                `Too many files (${files.length}, max ${maxFiles})`,
                { count: files.length, maxFiles }
            );
        }

        return files.map((file, index) => {
            try {
                return InputValidator.validateFileObject(file);
            } catch (error: any) {
                throw errorHandler.createError(
                    ErrorCode.VALIDATION_ERROR,
                    `Invalid file at index ${index}: ${error.message}`,
                    { index, file, originalError: error }
                );
            }
        });
    }

    /**
     * Sanitize string for safe display (prevent XSS)
     */
    static sanitizeForDisplay(input: string): string {
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    /**
     * Validate model selection
     */
    static validateModel(model: unknown): string | undefined {
        if (model === undefined || model === null) {
            return undefined;
        }

        if (typeof model !== 'string') {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Model must be a string'
            );
        }

        const validModels = [
            'gemini-2.0-flash-lite',
            'gemini-2.0-flash',
            'gemini-2.5-pro',
            'gemini-3.0-preview'
        ];

        if (!validModels.includes(model)) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                `Invalid model selection. Valid models: ${validModels.join(', ')}`,
                { model, validModels }
            );
        }

        return model;
    }

    /**
     * Validate diagnostics array
     */
    static validateDiagnostics(diagnostics: unknown): string[] {
        if (diagnostics === undefined || diagnostics === null) {
            return [];
        }

        if (!Array.isArray(diagnostics)) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Diagnostics must be an array'
            );
        }

        // Ensure all items are strings
        if (!diagnostics.every(d => typeof d === 'string')) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'All diagnostics must be strings'
            );
        }

        return diagnostics;
    }

    /**
     * Validate pagination parameters
     */
    static validatePagination(params: { limit?: unknown; offset?: unknown }): {
        limit: number;
        offset: number;
    } {
        const limit = params.limit !== undefined ? Number(params.limit) : 10;
        const offset = params.offset !== undefined ? Number(params.offset) : 0;

        if (isNaN(limit) || limit < 1 || limit > 100) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Limit must be between 1 and 100',
                { limit: params.limit }
            );
        }

        if (isNaN(offset) || offset < 0) {
            throw errorHandler.createError(
                ErrorCode.INVALID_INPUT,
                'Offset must be >= 0',
                { offset: params.offset }
            );
        }

        return { limit, offset };
    }
}

export default InputValidator;
