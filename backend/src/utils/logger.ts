/**
 * Professional Structured Logging System
 * Provides context-aware logging with levels, request tracking, and file output
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    CRITICAL = 4
}

interface LogEntry {
    timestamp: string;
    level: string;
    requestId?: string;
    message: string;
    context?: Record<string, any>;
    error?: {
        message: string;
        stack?: string;
        code?: string;
    };
}

class Logger {
    private logLevel: LogLevel;
    private logStream?: ReturnType<typeof createWriteStream>;
    private logDir: string;

    constructor(level: LogLevel = LogLevel.INFO) {
        this.logLevel = level;
        this.logDir = join(process.cwd(), 'logs');
        this.initializeLogFile();
    }

    private initializeLogFile() {
        try {
            if (!existsSync(this.logDir)) {
                mkdirSync(this.logDir, { recursive: true });
            }

            const logFile = join(this.logDir, `platypus-${this.getDateString()}.log`);
            this.logStream = createWriteStream(logFile, { flags: 'a' });

            // Handle stream errors
            this.logStream.on('error', (err) => {
                console.error('Log stream error:', err);
            });
        } catch (error) {
            console.error('Failed to initialize log file:', error);
        }
    }

    private getDateString(): string {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    private formatLog(entry: LogEntry): string {
        return JSON.stringify(entry) + '\n';
    }

    private writeLog(entry: LogEntry) {
        const formatted = this.formatLog(entry);
        
        // Console output with colors
        const colors: Record<string, string> = {
            DEBUG: '\x1b[36m',    // Cyan
            INFO: '\x1b[32m',     // Green
            WARN: '\x1b[33m',     // Yellow
            ERROR: '\x1b[31m',    // Red
            CRITICAL: '\x1b[35m'  // Magenta
        };
        
        const reset = '\x1b[0m';
        const color = colors[entry.level] || '';
        
        console.log(`${color}[${entry.timestamp}] [${entry.level}]${entry.requestId ? ` [${entry.requestId}]` : ''} ${entry.message}${reset}`);
        
        if (entry.context) {
            console.log(`${color}  Context:${reset}`, entry.context);
        }
        
        if (entry.error) {
            console.error(`${color}  Error:${reset}`, entry.error);
        }

        // File output
        if (this.logStream) {
            this.logStream.write(formatted);
        }
    }

    debug(message: string, context?: Record<string, any>, requestId?: string) {
        if (this.logLevel <= LogLevel.DEBUG) {
            this.writeLog({
                timestamp: new Date().toISOString(),
                level: 'DEBUG',
                requestId,
                message,
                context
            });
        }
    }

    info(message: string, context?: Record<string, any>, requestId?: string) {
        if (this.logLevel <= LogLevel.INFO) {
            this.writeLog({
                timestamp: new Date().toISOString(),
                level: 'INFO',
                requestId,
                message,
                context
            });
        }
    }

    warn(message: string, context?: Record<string, any>, requestId?: string) {
        if (this.logLevel <= LogLevel.WARN) {
            this.writeLog({
                timestamp: new Date().toISOString(),
                level: 'WARN',
                requestId,
                message,
                context
            });
        }
    }

    error(message: string, error?: Error | any, context?: Record<string, any>, requestId?: string) {
        if (this.logLevel <= LogLevel.ERROR) {
            this.writeLog({
                timestamp: new Date().toISOString(),
                level: 'ERROR',
                requestId,
                message,
                context,
                error: error ? {
                    message: error.message || String(error),
                    stack: error.stack,
                    code: error.code
                } : undefined
            });
        }
    }

    critical(message: string, error?: Error | any, context?: Record<string, any>, requestId?: string) {
        this.writeLog({
            timestamp: new Date().toISOString(),
            level: 'CRITICAL',
            requestId,
            message,
            context,
            error: error ? {
                message: error.message || String(error),
                stack: error.stack,
                code: error.code
            } : undefined
        });
    }

    // Request-scoped logger
    child(requestId: string) {
        return {
            debug: (msg: string, ctx?: Record<string, any>) => this.debug(msg, ctx, requestId),
            info: (msg: string, ctx?: Record<string, any>) => this.info(msg, ctx, requestId),
            warn: (msg: string, ctx?: Record<string, any>) => this.warn(msg, ctx, requestId),
            error: (msg: string, err?: Error | any, ctx?: Record<string, any>) => this.error(msg, err, ctx, requestId),
            critical: (msg: string, err?: Error | any, ctx?: Record<string, any>) => this.critical(msg, err, ctx, requestId)
        };
    }

    close() {
        if (this.logStream) {
            this.logStream.end();
        }
    }
}

// Singleton instance
const logger = new Logger(
    process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG :
    process.env.LOG_LEVEL === 'warn' ? LogLevel.WARN :
    process.env.LOG_LEVEL === 'error' ? LogLevel.ERROR :
    LogLevel.INFO
);

export default logger;
