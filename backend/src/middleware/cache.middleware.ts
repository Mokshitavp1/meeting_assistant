import { Request, Response, NextFunction } from 'express';
import { get as redisGet, set as redisSet, del as redisDel, deletePattern } from '../config/redis';
import logger from '../utils/logger';

/**
 * Redis Response Caching Middleware
 * Caches GET responses by URL + user context for configurable TTL
 */

interface CacheOptions {
    /** Cache TTL in seconds (default: 300 = 5 min) */
    ttl?: number;
    /** Include user ID in cache key (default: true for auth routes) */
    perUser?: boolean;
    /** Custom key prefix */
    prefix?: string;
}

/**
 * Generate a deterministic cache key from the request
 */
function buildCacheKey(req: Request, options: CacheOptions): string {
    const prefix = options.prefix || 'cache';
    const userId = options.perUser !== false && req.user?.id ? `:u:${req.user.id}` : '';
    const path = req.originalUrl || req.url;
    return `${prefix}${userId}:${path}`;
}

/**
 * Express middleware factory — caches successful GET responses in Redis
 *
 * @example
 * ```ts
 * router.get('/meetings', authenticate, cacheResponse({ ttl: 120 }), listMeetings);
 * ```
 */
export function cacheResponse(options: CacheOptions = {}) {
    const ttl = options.ttl ?? 300;

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            next();
            return;
        }

        const key = buildCacheKey(req, options);

        try {
            const cached = await redisGet(key);
            if (cached) {
                const parsed = JSON.parse(cached);
                res.status(200).json(parsed);
                return;
            }
        } catch (err) {
            // Cache miss or Redis error — proceed normally
            logger.debug('Cache miss or error', { key, error: (err as Error).message });
        }

        // Monkey-patch res.json to capture the response body
        const originalJson = res.json.bind(res);
        res.json = function (body: unknown) {
            // Only cache successful responses
            if (res.statusCode >= 200 && res.statusCode < 300) {
                redisSet(key, JSON.stringify(body), ttl).catch((err) =>
                    logger.warn('Failed to write cache', { key, error: (err as Error).message })
                );
            }
            return originalJson(body);
        };

        next();
    };
}

/**
 * Invalidate cache keys matching a pattern.
 * Call after mutations (POST/PUT/DELETE) to keep data fresh.
 *
 * @example
 * ```ts
 * await invalidateCache('cache:u:user123:/api/v1/meetings*');
 * ```
 */
export async function invalidateCache(pattern: string): Promise<void> {
    try {
        const deleted = await deletePattern(pattern);
        if (deleted > 0) {
            logger.debug('Cache invalidated', { pattern, keysDeleted: deleted });
        }
    } catch (err) {
        logger.warn('Cache invalidation failed', { pattern, error: (err as Error).message });
    }
}

/**
 * Invalidate all cache entries for a specific user
 */
export async function invalidateUserCache(userId: string): Promise<void> {
    await invalidateCache(`cache:u:${userId}:*`);
}

export default cacheResponse;
