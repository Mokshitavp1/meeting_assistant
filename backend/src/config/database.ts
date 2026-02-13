import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

// Load environment variables
config();

// Custom logging configuration
const logLevels: ("query" | "info" | "warn" | "error")[] =
    process.env.NODE_ENV === 'development' && process.env.DB_LOGGING === 'true'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'];

// Prisma Client options with connection pooling and logging
const prismaOptions = {
    log: logLevels,
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
    // Error formatting
    errorFormat: process.env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
} as const;

// Type for Prisma Client with extensions
type ExtendedPrismaClient = PrismaClient;

// Singleton pattern for Prisma Client
class DatabaseClient {
    private static instance: ExtendedPrismaClient | null = null;
    private static isConnecting = false;

    /**
     * Get Prisma Client singleton instance
     * Creates a new instance if one doesn't exist
     */
    public static getInstance(): ExtendedPrismaClient {
        if (!DatabaseClient.instance) {
            DatabaseClient.instance = new PrismaClient(prismaOptions);

            // Setup query logging in development
            if (process.env.NODE_ENV === 'development' && process.env.DB_LOGGING === 'true') {
                DatabaseClient.instance.$on('query' as never, (e: any) => {
                    console.log('Query: ' + e.query);
                    console.log('Duration: ' + e.duration + 'ms');
                });
            }

            // Log errors
            DatabaseClient.instance.$on('error' as never, (e: any) => {
                console.error('Database error:', e);
            });

            // Log warnings
            DatabaseClient.instance.$on('warn' as never, (e: any) => {
                console.warn('Database warning:', e);
            });
        }

        return DatabaseClient.instance;
    }

    /**
     * Connect to the database
     * Handles connection errors gracefully
     */
    public static async connect(): Promise<void> {
        if (DatabaseClient.isConnecting) {
            console.log('Database connection already in progress...');
            return;
        }

        try {
            DatabaseClient.isConnecting = true;
            const client = DatabaseClient.getInstance();

            // Test the connection
            await client.$connect();
            console.log('✓ Database connected successfully');

            // Verify connection with a simple query
            await client.$queryRaw`SELECT 1`;
            console.log('✓ Database health check passed');

            DatabaseClient.isConnecting = false;
        } catch (error) {
            DatabaseClient.isConnecting = false;
            console.error('✗ Failed to connect to database:', error);

            if (error instanceof Error) {
                // Handle specific connection errors
                if (error.message.includes('ECONNREFUSED')) {
                    console.error('Database server is not running or unreachable');
                } else if (error.message.includes('authentication failed')) {
                    console.error('Database authentication failed. Check credentials.');
                } else if (error.message.includes('database') && error.message.includes('does not exist')) {
                    console.error('Database does not exist. Please create it first.');
                } else {
                    console.error('Database connection error:', error.message);
                }
            }

            throw new Error('Database connection failed');
        }
    }

    /**
     * Disconnect from the database gracefully
     */
    public static async disconnect(): Promise<void> {
        if (DatabaseClient.instance) {
            try {
                await DatabaseClient.instance.$disconnect();
                console.log('✓ Database disconnected successfully');
                DatabaseClient.instance = null;
            } catch (error) {
                console.error('✗ Error disconnecting from database:', error);
                throw error;
            }
        }
    }

    /**
     * Check database connection health
     */
    public static async healthCheck(): Promise<boolean> {
        try {
            const client = DatabaseClient.getInstance();
            await client.$queryRaw`SELECT 1`;
            return true;
        } catch (error) {
            console.error('Database health check failed:', error);
            return false;
        }
    }

    /**
     * Get connection pool stats (if available)
     */
    public static async getPoolStats(): Promise<any> {
        try {
            const client = DatabaseClient.getInstance();
            // Prisma doesn't expose pool stats directly, but we can check if it's connected
            const isHealthy = await DatabaseClient.healthCheck();
            return {
                connected: isHealthy,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                connected: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

// Export the singleton instance
export const prisma = DatabaseClient.getInstance();

// Export the DatabaseClient class for advanced usage
export { DatabaseClient };

// Export types
export type { ExtendedPrismaClient as PrismaClientType };

/**
 * Graceful shutdown handlers
 * Ensures database connections are closed properly on application exit
 */

// Handle process termination signals
const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    try {
        await DatabaseClient.disconnect();
        console.log('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
};

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await DatabaseClient.disconnect();
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await DatabaseClient.disconnect();
    process.exit(1);
});

// Prevent multiple process.exit() calls
let isShuttingDown = false;
process.on('exit', (code) => {
    if (!isShuttingDown) {
        isShuttingDown = true;
        console.log(`Process exiting with code: ${code}`);
    }
});
