/**
 * System Health Monitoring & Metrics
 * Tracks performance, resource usage, and service availability
 */

import logger from './logger';

interface HealthMetrics {
    uptime: number;
    memory: {
        used: number;
        total: number;
        percentage: number;
    };
    cpu: {
        usage: number;
    };
    requests: {
        total: number;
        successful: number;
        failed: number;
        avgResponseTime: number;
    };
    services: {
        llm: 'healthy' | 'degraded' | 'down';
        qdrant: 'healthy' | 'degraded' | 'down';
    };
}

interface RequestMetric {
    startTime: number;
    endTime?: number;
    duration?: number;
    success?: boolean;
    endpoint: string;
}

class HealthMonitor {
    private startTime: number;
    private requestMetrics: Map<string, RequestMetric>;
    private totalRequests: number = 0;
    private successfulRequests: number = 0;
    private failedRequests: number = 0;
    private responseTimes: number[] = [];
    private maxResponseTimes: number = 1000; // Keep last 1000 response times

    constructor() {
        this.startTime = Date.now();
        this.requestMetrics = new Map();
        this.startPeriodicHealthCheck();
    }

    /**
     * Start tracking a request
     */
    startRequest(requestId: string, endpoint: string): void {
        this.requestMetrics.set(requestId, {
            startTime: Date.now(),
            endpoint
        });
    }

    /**
     * End tracking a request
     */
    endRequest(requestId: string, success: boolean = true): void {
        const metric = this.requestMetrics.get(requestId);
        if (!metric) return;

        metric.endTime = Date.now();
        metric.duration = metric.endTime - metric.startTime;
        metric.success = success;

        this.totalRequests++;
        if (success) {
            this.successfulRequests++;
        } else {
            this.failedRequests++;
        }

        // Track response time
        if (this.responseTimes.length >= this.maxResponseTimes) {
            this.responseTimes.shift();
        }
        this.responseTimes.push(metric.duration);

        // Log slow requests
        if (metric.duration > 5000) {
            logger.warn('Slow request detected', {
                requestId,
                endpoint: metric.endpoint,
                duration: metric.duration
            });
        }

        this.requestMetrics.delete(requestId);
    }

    /**
     * Get current health metrics
     */
    getMetrics(): HealthMetrics {
        const memory = process.memoryUsage();
        const uptime = Date.now() - this.startTime;

        return {
            uptime,
            memory: {
                used: memory.heapUsed,
                total: memory.heapTotal,
                percentage: (memory.heapUsed / memory.heapTotal) * 100
            },
            cpu: {
                usage: this.getCpuUsage()
            },
            requests: {
                total: this.totalRequests,
                successful: this.successfulRequests,
                failed: this.failedRequests,
                avgResponseTime: this.getAverageResponseTime()
            },
            services: {
                llm: this.checkLLMHealth(),
                qdrant: this.checkQdrantHealth()
            }
        };
    }

    /**
     * Get health status
     */
    getHealthStatus(): {
        status: 'healthy' | 'degraded' | 'unhealthy';
        checks: Record<string, boolean>;
        metrics: HealthMetrics;
    } {
        const metrics = this.getMetrics();
        const checks = {
            memory: metrics.memory.percentage < 90,
            services: metrics.services.llm !== 'down' && metrics.services.qdrant !== 'down',
            errorRate: this.getErrorRate() < 0.1 // Less than 10% error rate
        };

        const healthy = Object.values(checks).every(c => c);
        const degraded = Object.values(checks).some(c => !c);

        return {
            status: healthy ? 'healthy' : degraded ? 'degraded' : 'unhealthy',
            checks,
            metrics
        };
    }

    /**
     * Check if system is healthy
     */
    isHealthy(): boolean {
        return this.getHealthStatus().status === 'healthy';
    }

    /**
     * Get error rate
     */
    private getErrorRate(): number {
        if (this.totalRequests === 0) return 0;
        return this.failedRequests / this.totalRequests;
    }

    /**
     * Get average response time
     */
    private getAverageResponseTime(): number {
        if (this.responseTimes.length === 0) return 0;
        const sum = this.responseTimes.reduce((a, b) => a + b, 0);
        return sum / this.responseTimes.length;
    }

    /**
     * Get CPU usage (simplified)
     */
    private getCpuUsage(): number {
        const usage = process.cpuUsage();
        return (usage.user + usage.system) / 1000000; // Convert to seconds
    }

    /**
     * Check LLM service health
     */
    private checkLLMHealth(): 'healthy' | 'degraded' | 'down' {
        // Check if API key is set
        if (!process.env.AGENT_API_KEY) {
            return 'down';
        }

        // Check recent error rate for LLM requests
        const recentRequests = Array.from(this.requestMetrics.values())
            .filter(m => m.endpoint.includes('analyze'));
        
        if (recentRequests.length === 0) return 'healthy';

        const failed = recentRequests.filter(m => m.success === false).length;
        const errorRate = failed / recentRequests.length;

        if (errorRate > 0.5) return 'down';
        if (errorRate > 0.2) return 'degraded';
        return 'healthy';
    }

    /**
     * Check Qdrant service health
     */
    private checkQdrantHealth(): 'healthy' | 'degraded' | 'down' {
        // Check if Qdrant URL is configured
        if (!process.env.QDRANT_URL && !process.env.QDRANT_API_KEY) {
            return 'degraded'; // Optional service
        }

        return 'healthy'; // Assume healthy unless we track Qdrant-specific errors
    }

    /**
     * Periodic health check
     */
    private startPeriodicHealthCheck(): void {
        setInterval(() => {
            const status = this.getHealthStatus();
            
            if (status.status !== 'healthy') {
                logger.warn('System health degraded', {
                    status: status.status,
                    checks: status.checks,
                    metrics: status.metrics
                });
            }

            // Log metrics every 5 minutes
            logger.info('System metrics', {
                uptime: status.metrics.uptime,
                memory: status.metrics.memory.percentage,
                requests: status.metrics.requests,
                services: status.metrics.services
            });
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Get active requests count
     */
    getActiveRequestsCount(): number {
        return this.requestMetrics.size;
    }

    /**
     * Reset metrics (for testing)
     */
    reset(): void {
        this.totalRequests = 0;
        this.successfulRequests = 0;
        this.failedRequests = 0;
        this.responseTimes = [];
        this.requestMetrics.clear();
    }
}

// Singleton instance
const healthMonitor = new HealthMonitor();

export default healthMonitor;
