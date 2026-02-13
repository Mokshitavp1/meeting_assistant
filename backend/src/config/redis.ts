import Redis, { RedisOptions } from 'ioredis';
import { config } from 'dotenv';

// Load environment variables
config();

// Redis connection configuration
const redisConfig: RedisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
};

// Create Redis client instance
class RedisClient {
    private static instance: Redis | null = null;
    private static isConnecting = false;

    /**
     * Get Redis client singleton instance
     */
    public static getInstance(): Redis {
        if (!RedisClient.instance) {
            try {
                // Use REDIS_URL if provided, otherwise use individual config
                if (process.env.REDIS_URL) {
                    RedisClient.instance = new Redis(process.env.REDIS_URL, {
                        retryStrategy: redisConfig.retryStrategy,
                        maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
                        enableReadyCheck: redisConfig.enableReadyCheck,
                    });
                } else {
                    RedisClient.instance = new Redis(redisConfig);
                }

                // Setup event listeners
                RedisClient.setupEventListeners(RedisClient.instance);
            } catch (error) {
                console.error('Failed to create Redis client:', error);
                throw error;
            }
        }

        return RedisClient.instance;
    }

    /**
     * Setup Redis event listeners
     */
    private static setupEventListeners(client: Redis): void {
        client.on('connect', () => {
            console.log('✓ Redis client connecting...');
        });

        client.on('ready', () => {
            console.log('✓ Redis client connected and ready');
        });

        client.on('error', (error: Error) => {
            console.error('✗ Redis client error:', error.message);
            if (error.message.includes('ECONNREFUSED')) {
                console.error('Redis server is not running or unreachable');
            } else if (error.message.includes('WRONGPASS')) {
                console.error('Redis authentication failed. Check password.');
            }
        });

        client.on('close', () => {
            console.log('Redis connection closed');
        });

        client.on('reconnecting', (delay: number) => {
            console.log(`Redis client reconnecting in ${delay}ms...`);
        });

        client.on('end', () => {
            console.log('Redis client connection ended');
        });
    }

    /**
     * Connect to Redis
     */
    public static async connect(): Promise<void> {
        if (RedisClient.isConnecting) {
            console.log('Redis connection already in progress...');
            return;
        }

        try {
            RedisClient.isConnecting = true;
            const client = RedisClient.getInstance();

            // Test connection
            await client.ping();
            console.log('✓ Redis connection test successful');

            RedisClient.isConnecting = false;
        } catch (error) {
            RedisClient.isConnecting = false;
            console.error('✗ Failed to connect to Redis:', error);
            throw new Error('Redis connection failed');
        }
    }

    /**
     * Disconnect from Redis
     */
    public static async disconnect(): Promise<void> {
        if (RedisClient.instance) {
            try {
                await RedisClient.instance.quit();
                console.log('✓ Redis disconnected successfully');
                RedisClient.instance = null;
            } catch (error) {
                console.error('✗ Error disconnecting from Redis:', error);
                // Force disconnect if graceful quit fails
                if (RedisClient.instance) {
                    RedisClient.instance.disconnect();
                }
                RedisClient.instance = null;
            }
        }
    }

    /**
     * Check Redis connection health
     */
    public static async healthCheck(): Promise<boolean> {
        try {
            const client = RedisClient.getInstance();
            const result = await client.ping();
            return result === 'PONG';
        } catch (error) {
            console.error('Redis health check failed:', error);
            return false;
        }
    }

    /**
     * Get Redis connection info
     */
    public static async getInfo(): Promise<string> {
        try {
            const client = RedisClient.getInstance();
            return await client.info();
        } catch (error) {
            console.error('Failed to get Redis info:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const redisClient = RedisClient.getInstance();

// Export RedisClient class for advanced usage
export { RedisClient };

/**
 * Redis Helper Functions
 * Wrapper functions for common Redis operations with error handling
 */

/**
 * Get value from Redis
 * @param key - Redis key
 * @returns Value as string or null if not found
 */
export async function get(key: string): Promise<string | null> {
    try {
        return await redisClient.get(key);
    } catch (error) {
        console.error(`Error getting key "${key}":`, error);
        throw error;
    }
}

/**
 * Get value from Redis and parse as JSON
 * @param key - Redis key
 * @returns Parsed JSON object or null if not found
 */
export async function getJSON<T = any>(key: string): Promise<T | null> {
    try {
        const value = await redisClient.get(key);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.error(`Error getting JSON key "${key}":`, error);
        throw error;
    }
}

/**
 * Set value in Redis
 * @param key - Redis key
 * @param value - Value to store
 * @param ttl - Time to live in seconds (optional)
 * @returns OK if successful
 */
export async function set(
    key: string,
    value: string | number | Buffer,
    ttl?: number
): Promise<string | null> {
    try {
        if (ttl) {
            return await redisClient.setex(key, ttl, value.toString());
        }
        return await redisClient.set(key, value.toString());
    } catch (error) {
        console.error(`Error setting key "${key}":`, error);
        throw error;
    }
}

/**
 * Set JSON value in Redis
 * @param key - Redis key
 * @param value - Object to store as JSON
 * @param ttl - Time to live in seconds (optional)
 * @returns OK if successful
 */
export async function setJSON(
    key: string,
    value: any,
    ttl?: number
): Promise<string | null> {
    try {
        const json = JSON.stringify(value);
        return await set(key, json, ttl);
    } catch (error) {
        console.error(`Error setting JSON key "${key}":`, error);
        throw error;
    }
}

/**
 * Delete key(s) from Redis
 * @param keys - Single key or array of keys to delete
 * @returns Number of keys deleted
 */
export async function del(...keys: string[]): Promise<number> {
    try {
        return await redisClient.del(...keys);
    } catch (error) {
        console.error(`Error deleting keys:`, error);
        throw error;
    }
}

/**
 * Check if key exists in Redis
 * @param key - Redis key
 * @returns 1 if exists, 0 if not
 */
export async function exists(key: string): Promise<number> {
    try {
        return await redisClient.exists(key);
    } catch (error) {
        console.error(`Error checking existence of key "${key}":`, error);
        throw error;
    }
}

/**
 * Set expiration time for a key
 * @param key - Redis key
 * @param seconds - Time to live in seconds
 * @returns 1 if successful, 0 if key doesn't exist
 */
export async function expire(key: string, seconds: number): Promise<number> {
    try {
        return await redisClient.expire(key, seconds);
    } catch (error) {
        console.error(`Error setting expiration for key "${key}":`, error);
        throw error;
    }
}

/**
 * Get time to live for a key
 * @param key - Redis key
 * @returns TTL in seconds, -1 if no expiry, -2 if key doesn't exist
 */
export async function ttl(key: string): Promise<number> {
    try {
        return await redisClient.ttl(key);
    } catch (error) {
        console.error(`Error getting TTL for key "${key}":`, error);
        throw error;
    }
}

/**
 * Increment value by 1
 * @param key - Redis key
 * @returns New value after increment
 */
export async function incr(key: string): Promise<number> {
    try {
        return await redisClient.incr(key);
    } catch (error) {
        console.error(`Error incrementing key "${key}":`, error);
        throw error;
    }
}

/**
 * Increment value by amount
 * @param key - Redis key
 * @param amount - Amount to increment by
 * @returns New value after increment
 */
export async function incrBy(key: string, amount: number): Promise<number> {
    try {
        return await redisClient.incrby(key, amount);
    } catch (error) {
        console.error(`Error incrementing key "${key}" by ${amount}:`, error);
        throw error;
    }
}

/**
 * Decrement value by 1
 * @param key - Redis key
 * @returns New value after decrement
 */
export async function decr(key: string): Promise<number> {
    try {
        return await redisClient.decr(key);
    } catch (error) {
        console.error(`Error decrementing key "${key}":`, error);
        throw error;
    }
}

/**
 * Get all keys matching a pattern
 * @param pattern - Pattern to match (e.g., "user:*")
 * @returns Array of matching keys
 */
export async function keys(pattern: string): Promise<string[]> {
    try {
        return await redisClient.keys(pattern);
    } catch (error) {
        console.error(`Error getting keys with pattern "${pattern}":`, error);
        throw error;
    }
}

/**
 * Delete all keys matching a pattern
 * @param pattern - Pattern to match (e.g., "cache:*")
 * @returns Number of keys deleted
 */
export async function deletePattern(pattern: string): Promise<number> {
    try {
        const matchingKeys = await redisClient.keys(pattern);
        if (matchingKeys.length === 0) return 0;
        return await redisClient.del(...matchingKeys);
    } catch (error) {
        console.error(`Error deleting keys with pattern "${pattern}":`, error);
        throw error;
    }
}

/**
 * Flush all keys in current database
 * @returns OK if successful
 */
export async function flushDb(): Promise<string> {
    try {
        return await redisClient.flushdb();
    } catch (error) {
        console.error('Error flushing database:', error);
        throw error;
    }
}

/**
 * Add member to a set
 * @param key - Set key
 * @param members - Members to add
 * @returns Number of members added
 */
export async function sadd(key: string, ...members: string[]): Promise<number> {
    try {
        return await redisClient.sadd(key, ...members);
    } catch (error) {
        console.error(`Error adding to set "${key}":`, error);
        throw error;
    }
}

/**
 * Get all members of a set
 * @param key - Set key
 * @returns Array of set members
 */
export async function smembers(key: string): Promise<string[]> {
    try {
        return await redisClient.smembers(key);
    } catch (error) {
        console.error(`Error getting members of set "${key}":`, error);
        throw error;
    }
}

/**
 * Add item to the end of a list
 * @param key - List key
 * @param values - Values to push
 * @returns Length of list after push
 */
export async function rpush(key: string, ...values: string[]): Promise<number> {
    try {
        return await redisClient.rpush(key, ...values);
    } catch (error) {
        console.error(`Error pushing to list "${key}":`, error);
        throw error;
    }
}

/**
 * Get range of items from a list
 * @param key - List key
 * @param start - Start index
 * @param stop - Stop index
 * @returns Array of list items
 */
export async function lrange(
    key: string,
    start: number,
    stop: number
): Promise<string[]> {
    try {
        return await redisClient.lrange(key, start, stop);
    } catch (error) {
        console.error(`Error getting range from list "${key}":`, error);
        throw error;
    }
}

/**
 * Set hash field value
 * @param key - Hash key
 * @param field - Field name
 * @param value - Field value
 * @returns 1 if new field, 0 if field updated
 */
export async function hset(
    key: string,
    field: string,
    value: string
): Promise<number> {
    try {
        return await redisClient.hset(key, field, value);
    } catch (error) {
        console.error(`Error setting hash field "${field}" in "${key}":`, error);
        throw error;
    }
}

/**
 * Get hash field value
 * @param key - Hash key
 * @param field - Field name
 * @returns Field value or null
 */
export async function hget(key: string, field: string): Promise<string | null> {
    try {
        return await redisClient.hget(key, field);
    } catch (error) {
        console.error(`Error getting hash field "${field}" from "${key}":`, error);
        throw error;
    }
}

/**
 * Get all fields and values in a hash
 * @param key - Hash key
 * @returns Object with all fields and values
 */
export async function hgetall(key: string): Promise<Record<string, string>> {
    try {
        return await redisClient.hgetall(key);
    } catch (error) {
        console.error(`Error getting all hash fields from "${key}":`, error);
        throw error;
    }
}

/**
 * Graceful shutdown handlers
 */
const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Disconnecting Redis...`);
    try {
        await RedisClient.disconnect();
    } catch (error) {
        console.error('Error during Redis shutdown:', error);
    }
};

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
