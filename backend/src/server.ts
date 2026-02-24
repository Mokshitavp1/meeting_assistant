import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from 'dotenv';
import app, { corsOptions } from './app';
import { DatabaseClient } from './config/database';
import { RedisClient } from './config/redis';
import { socketAuthMiddleware, getSocketUser } from './websocket/auth.middleware';
import logger from './utils/logger';

// Load environment variables
config();

// Server configuration
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new SocketIOServer(server, {
    cors: corsOptions,
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT || '60000', 10),
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL || '25000', 10),
    connectTimeout: parseInt(process.env.SOCKET_TIMEOUT || '20000', 10),
    transports: ['websocket', 'polling'],
});

/**
 * Setup Socket.IO event handlers
 */
function setupSocketIO(): void {
    io.on('connection', (socket) => {
        console.log(`✓ Socket.IO client connected: ${socket.id}`);

        // Handle client disconnection
        socket.on('disconnect', (reason) => {
            console.log(`Socket.IO client disconnected: ${socket.id} - Reason: ${reason}`);
        });

        // Handle connection errors
        socket.on('error', (error) => {
            console.error(`Socket.IO error for ${socket.id}:`, error);
        });

        // Example event handlers (customize based on your needs)
        socket.on('join-room', (roomId: string) => {
            socket.join(roomId);
            console.log(`Client ${socket.id} joined room: ${roomId}`);
        });

        socket.on('leave-room', (roomId: string) => {
            socket.leave(roomId);
            console.log(`Client ${socket.id} left room: ${roomId}`);
        });
    });

    // Handle Socket.IO server errors
    io.engine.on('connection_error', (err) => {
        logger.error('Socket.IO connection error:', { error: err.message ?? String(err) });
    });
}

/**
 * Initialize all services (Database, Redis, etc.)
 */
async function initializeServices(): Promise<void> {
    logger.info('Initializing services...');

    try {
        // Connect to PostgreSQL
        logger.info('Connecting to PostgreSQL...');
        await DatabaseClient.connect();

        // Connect to Redis
        logger.info('Connecting to Redis...');
        await RedisClient.connect();

        logger.info('All services initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize services:', { error });
        throw error;
    }
}

/**
 * Start the HTTP server
 */
function startServer(): void {
    server.listen(PORT, HOST, () => {
        logger.info('='.repeat(50));
        logger.info('Server started successfully!');
        logger.info('='.repeat(50));
        logger.info(`Environment: ${NODE_ENV}`);
        logger.info(`Server running at: http://${HOST}:${PORT}`);
        logger.info(`Health check: http://${HOST}:${PORT}/health`);
        logger.info(`Socket.IO enabled: Yes (authenticated)`);
        logger.info('='.repeat(50));
    });

    // Handle server errors
    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${PORT} is already in use`);
        } else if (error.code === 'EACCES') {
            logger.error(`Port ${PORT} requires elevated privileges`);
        } else {
            logger.error('Server error:', { error });
        }
        process.exit(1);
    });
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
        logger.info('HTTP server closed');

        try {
            // Close Socket.IO connections
            logger.info('Closing Socket.IO connections...');
            io.close(() => {
                logger.info('Socket.IO server closed');
            });

            // Disconnect from Redis
            logger.info('Disconnecting from Redis...');
            await RedisClient.disconnect();

            // Disconnect from Database
            logger.info('Disconnecting from database...');
            await DatabaseClient.disconnect();

            logger.info('Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            logger.error('Error during graceful shutdown:', { error });
            process.exit(1);
        }
    });

    // Force shutdown after timeout
    setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
    }, 10000); // 10 seconds timeout
}

/**
 * Setup process event handlers
 */
function setupProcessHandlers(): void {
    // Graceful shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error: Error) => {
        logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
        await gracefulShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason: any, promise: Promise<any>) => {
        logger.error('Unhandled Rejection:', { reason });
        await gracefulShutdown('unhandledRejection');
    });

    // Log process warnings
    process.on('warning', (warning: Error) => {
        logger.warn('Process Warning:', { name: warning.name, message: warning.message });
    });
}

/**
 * Bootstrap the application
 */
async function bootstrap(): Promise<void> {
    try {
        logger.info('Starting AI Meeting Assistant Server...');
        logger.info(`Node.js version: ${process.version}`);
        logger.info(`Environment: ${NODE_ENV}`);

        // Setup Socket.IO
        setupSocketIO();

        // Setup process handlers
        setupProcessHandlers();

        // Initialize services (Database, Redis)
        await initializeServices();

        // Start the server
        startServer();
    } catch (error) {
        logger.error('Failed to start server:', { error });
        process.exit(1);
    }
}

// Start the application
bootstrap();

// Export for testing and use in application
export { app, server, io };
