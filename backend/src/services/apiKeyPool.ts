/**
 * API Key Pool Manager
 * Manages multiple API keys with automatic failover, rotation, and load balancing
 * Supports unlimited keys (50, 300, or beyond)
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

interface ApiKeyStatus {
    key: string;
    isHealthy: boolean;
    lastUsed: number;
    errorCount: number;
    rateLimitedUntil: number;
    totalRequests: number;
    successfulRequests: number;
    provider: 'gemini' | 'openai' | 'anthropic';
}

interface KeyPoolConfig {
    maxErrorsBeforeDisable: number;
    rateLimitCooldownMs: number;
    healthCheckIntervalMs: number;
    rotationStrategy: 'round-robin' | 'least-used' | 'random' | 'smart';
}

class ApiKeyPool {
    private keys: Map<string, ApiKeyStatus> = new Map();
    private currentIndex: number = 0;
    private config: KeyPoolConfig;
    private healthCheckInterval?: NodeJS.Timeout;

    constructor(config?: Partial<KeyPoolConfig>) {
        this.config = {
            maxErrorsBeforeDisable: 5,
            rateLimitCooldownMs: 60000, // 1 minute cooldown
            healthCheckIntervalMs: 300000, // Check every 5 minutes
            rotationStrategy: 'smart',
            ...config
        };

        this.loadKeysFromEnv();
        this.loadKeysFromFile();
        this.startHealthCheck();
    }

    /**
     * Load API keys from environment variables
     * Supports: AGENT_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
     */
    private loadKeysFromEnv(): void {
        // Load primary key
        const primaryKey = process.env.AGENT_API_KEY;
        if (primaryKey) {
            this.addKey(primaryKey, 'gemini');
        }

        // Load numbered keys (GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
        for (let i = 1; i <= 1000; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key) {
                this.addKey(key, 'gemini');
            }
        }

        // Load comma-separated keys from GEMINI_API_KEYS
        const multiKeys = process.env.GEMINI_API_KEYS;
        if (multiKeys) {
            multiKeys.split(',').forEach(key => {
                const trimmedKey = key.trim();
                if (trimmedKey) {
                    this.addKey(trimmedKey, 'gemini');
                }
            });
        }

        console.log(`[ApiKeyPool] Loaded ${this.keys.size} API keys from environment`);
    }

    /**
     * Load API keys from a JSON file
     */
    private loadKeysFromFile(): void {
        const keysFilePath = path.join(process.cwd(), 'api-keys.json');
        
        try {
            if (fs.existsSync(keysFilePath)) {
                const data = JSON.parse(fs.readFileSync(keysFilePath, 'utf-8'));
                
                if (Array.isArray(data.gemini)) {
                    data.gemini.forEach((key: string) => this.addKey(key, 'gemini'));
                }
                if (Array.isArray(data.openai)) {
                    data.openai.forEach((key: string) => this.addKey(key, 'openai'));
                }
                if (Array.isArray(data.anthropic)) {
                    data.anthropic.forEach((key: string) => this.addKey(key, 'anthropic'));
                }

                console.log(`[ApiKeyPool] Loaded additional keys from api-keys.json`);
            }
        } catch (error) {
            console.warn('[ApiKeyPool] Could not load api-keys.json:', error);
        }
    }

    /**
     * Add a new API key to the pool
     */
    addKey(key: string, provider: 'gemini' | 'openai' | 'anthropic' = 'gemini'): void {
        if (this.keys.has(key)) return; // Avoid duplicates

        this.keys.set(key, {
            key,
            isHealthy: true,
            lastUsed: 0,
            errorCount: 0,
            rateLimitedUntil: 0,
            totalRequests: 0,
            successfulRequests: 0,
            provider
        });
    }

    /**
     * Get the next available API key based on rotation strategy
     */
    getNextKey(provider: 'gemini' | 'openai' | 'anthropic' = 'gemini'): string | null {
        const availableKeys = this.getAvailableKeys(provider);
        
        if (availableKeys.length === 0) {
            console.error('[ApiKeyPool] No available API keys!');
            return null;
        }

        let selectedKey: ApiKeyStatus;

        switch (this.config.rotationStrategy) {
            case 'round-robin':
                selectedKey = this.roundRobinSelect(availableKeys);
                break;
            case 'least-used':
                selectedKey = this.leastUsedSelect(availableKeys);
                break;
            case 'random':
                selectedKey = this.randomSelect(availableKeys);
                break;
            case 'smart':
            default:
                selectedKey = this.smartSelect(availableKeys);
                break;
        }

        // Update usage stats
        selectedKey.lastUsed = Date.now();
        selectedKey.totalRequests++;

        return selectedKey.key;
    }

    /**
     * Get all available (healthy and not rate-limited) keys
     */
    private getAvailableKeys(provider: 'gemini' | 'openai' | 'anthropic'): ApiKeyStatus[] {
        const now = Date.now();
        return Array.from(this.keys.values()).filter(status => 
            status.provider === provider &&
            status.isHealthy &&
            status.rateLimitedUntil < now
        );
    }

    /**
     * Round-robin selection
     */
    private roundRobinSelect(keys: ApiKeyStatus[]): ApiKeyStatus {
        this.currentIndex = (this.currentIndex + 1) % keys.length;
        return keys[this.currentIndex];
    }

    /**
     * Select the least-used key
     */
    private leastUsedSelect(keys: ApiKeyStatus[]): ApiKeyStatus {
        return keys.reduce((min, current) => 
            current.totalRequests < min.totalRequests ? current : min
        );
    }

    /**
     * Random selection
     */
    private randomSelect(keys: ApiKeyStatus[]): ApiKeyStatus {
        return keys[Math.floor(Math.random() * keys.length)];
    }

    /**
     * Smart selection - considers success rate, recency, and load
     */
    private smartSelect(keys: ApiKeyStatus[]): ApiKeyStatus {
        const now = Date.now();
        
        // Score each key based on multiple factors
        const scoredKeys = keys.map(key => {
            let score = 100;

            // Factor 1: Success rate (higher is better)
            const successRate = key.totalRequests > 0 
                ? key.successfulRequests / key.totalRequests 
                : 1;
            score *= successRate;

            // Factor 2: Error count penalty
            score -= key.errorCount * 10;

            // Factor 3: Time since last use (prefer less recently used)
            const timeSinceUse = now - key.lastUsed;
            score += Math.min(timeSinceUse / 10000, 20); // Cap at 20 bonus points

            // Factor 4: Total usage penalty (spread load)
            score -= Math.min(key.totalRequests / 100, 10);

            return { key, score };
        });

        // Sort by score and pick the best
        scoredKeys.sort((a, b) => b.score - a.score);
        return scoredKeys[0].key;
    }

    /**
     * Report a successful API call
     */
    reportSuccess(key: string): void {
        const status = this.keys.get(key);
        if (status) {
            status.successfulRequests++;
            status.errorCount = Math.max(0, status.errorCount - 1); // Reduce error count on success
        }
    }

    /**
     * Report a failed API call
     */
    reportError(key: string, error: any): void {
        const status = this.keys.get(key);
        if (!status) return;

        status.errorCount++;

        // Check if it's a rate limit error
        if (this.isRateLimitError(error)) {
            status.rateLimitedUntil = Date.now() + this.config.rateLimitCooldownMs;
            console.log(`[ApiKeyPool] Key rate limited, cooling down for ${this.config.rateLimitCooldownMs}ms`);
        }

        // Disable key if too many errors
        if (status.errorCount >= this.config.maxErrorsBeforeDisable) {
            status.isHealthy = false;
            console.warn(`[ApiKeyPool] Key disabled after ${status.errorCount} errors`);
        }
    }

    /**
     * Check if an error is a rate limit error
     */
    private isRateLimitError(error: any): boolean {
        if (!error) return false;
        return (
            error.status === 429 ||
            error.code === 429 ||
            (typeof error.message === 'string' && (
                error.message.toLowerCase().includes('rate limit') ||
                error.message.toLowerCase().includes('resource exhausted') ||
                error.message.toLowerCase().includes('quota exceeded')
            ))
        );
    }

    /**
     * Create a Gemini client with automatic failover
     */
    async createGeminiClient(): Promise<{ client: GoogleGenAI; key: string } | null> {
        const key = this.getNextKey('gemini');
        if (!key) {
            throw new Error('No available Gemini API keys');
        }

        return {
            client: new GoogleGenAI({ apiKey: key }),
            key
        };
    }

    /**
     * Execute a function with automatic key failover
     */
    async executeWithFailover<T>(
        fn: (client: GoogleGenAI) => Promise<T>,
        maxRetries: number = 3
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const clientInfo = await this.createGeminiClient();
            if (!clientInfo) {
                throw new Error('No available API keys');
            }

            const { client, key } = clientInfo;

            try {
                const result = await fn(client);
                this.reportSuccess(key);
                return result;
            } catch (error: any) {
                lastError = error;
                this.reportError(key, error);

                console.log(`[ApiKeyPool] Attempt ${attempt + 1} failed, trying next key...`);

                // If not a rate limit error and not retryable, throw immediately
                if (!this.isRateLimitError(error) && !this.isRetryableError(error)) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('All API keys exhausted');
    }

    /**
     * Check if an error is retryable
     */
    private isRetryableError(error: any): boolean {
        if (!error) return false;
        return (
            this.isRateLimitError(error) ||
            error.status === 503 ||
            error.status === 500 ||
            (typeof error.message === 'string' && (
                error.message.toLowerCase().includes('timeout') ||
                error.message.toLowerCase().includes('network') ||
                error.message.toLowerCase().includes('connection')
            ))
        );
    }

    /**
     * Start periodic health check
     */
    private startHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckIntervalMs);
    }

    /**
     * Perform health check on all keys
     */
    private async performHealthCheck(): Promise<void> {
        const now = Date.now();

        for (const [key, status] of this.keys) {
            // Re-enable keys that have been disabled for a while
            if (!status.isHealthy && status.errorCount < this.config.maxErrorsBeforeDisable * 2) {
                status.isHealthy = true;
                status.errorCount = Math.floor(status.errorCount / 2);
                console.log(`[ApiKeyPool] Re-enabled key after cooldown`);
            }

            // Clear rate limit if cooldown has passed
            if (status.rateLimitedUntil > 0 && status.rateLimitedUntil < now) {
                status.rateLimitedUntil = 0;
            }
        }
    }

    /**
     * Get pool statistics
     */
    getStats(): {
        totalKeys: number;
        healthyKeys: number;
        rateLimitedKeys: number;
        disabledKeys: number;
        totalRequests: number;
        successRate: number;
    } {
        const stats = {
            totalKeys: this.keys.size,
            healthyKeys: 0,
            rateLimitedKeys: 0,
            disabledKeys: 0,
            totalRequests: 0,
            successfulRequests: 0,
            successRate: 0
        };

        const now = Date.now();
        for (const status of this.keys.values()) {
            if (!status.isHealthy) {
                stats.disabledKeys++;
            } else if (status.rateLimitedUntil > now) {
                stats.rateLimitedKeys++;
            } else {
                stats.healthyKeys++;
            }
            stats.totalRequests += status.totalRequests;
            stats.successfulRequests += status.successfulRequests;
        }

        stats.successRate = stats.totalRequests > 0 
            ? stats.successfulRequests / stats.totalRequests 
            : 1;

        return stats;
    }

    /**
     * Shutdown the pool
     */
    shutdown(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }
}

// Export singleton instance
export const apiKeyPool = new ApiKeyPool();
export default apiKeyPool;
