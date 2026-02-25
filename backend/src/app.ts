import express, { Application, Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';

// Import configuration
import { config } from 'dotenv';
import { DatabaseClient } from './config/database';
import { RedisClient } from './config/redis';

// Import routes
import apiRouter from './routes/index';

// Import error handling
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/requestId.middleware';
import logger from './utils/logger';

// Import extracted config modules (avoids circular deps)
import { globalLimiter, authLimiter } from './config/rateLimiter';
import { upload, uploadRecording } from './config/upload';

// Load environment variables
config();

/**
 * CORS Configuration
 */
const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];

        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: process.env.CORS_CREDENTIALS === 'true',
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

const uploadDir = process.env.UPLOAD_DIR || './uploads';

/**
 * Custom Request Logging Middleware
 */
const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            requestId: req.requestId,
        };

        if (res.statusCode >= 400) {
            logger.warn('Request completed with error', logData);
        } else if (duration > 1000) {
            logger.warn('Slow request detected', logData);
        } else {
            logger.debug('Request completed', logData);
        }
    });

    next();
};

/**
 * Create and configure Express application
 */
const createApp = (): Application => {
    const app: Application = express();

    // Trust proxy - important for rate limiting behind reverse proxy
    app.set('trust proxy', 1);

    // Request ID for distributed tracing
    app.use(requestIdMiddleware);

    // Security middleware - Helmet
    if (process.env.HELMET_ENABLED !== 'false') {
        app.use(helmet({
            contentSecurityPolicy: process.env.NODE_ENV === 'production',
            crossOriginEmbedderPolicy: process.env.NODE_ENV === 'production',
        }));
    }

    // CORS middleware
    app.use(cors(corsOptions));

    // Compression middleware
    app.use(compression());

    // Request logging
    if (process.env.NODE_ENV === 'development') {
        app.use(morgan('dev'));
    } else {
        app.use(morgan('combined'));
    }

    // Custom request logger
    app.use(requestLogger);

    // Body parsing middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Cookie parser middleware
    app.use(cookieParser());

    // Global rate limiting
    if (process.env.RATE_LIMIT_ENABLED === 'true') {
        app.use(globalLimiter);
    }

    // Serve static files (uploaded files)
    app.use('/uploads', express.static(uploadDir));

    // Health check endpoint (before rate limiting for monitoring)
    app.get('/health', async (req: Request, res: Response) => {
        try {
            const dbHealthy = await DatabaseClient.healthCheck();
            const redisHealthy = await RedisClient.healthCheck();

            const health = {
                status: dbHealthy && redisHealthy ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: process.env.NODE_ENV || 'development',
                services: {
                    database: dbHealthy ? 'up' : 'down',
                    redis: redisHealthy ? 'up' : 'down',
                },
            };

            res.status(dbHealthy && redisHealthy ? 200 : 503).json(health);
        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    // Root endpoint
    app.get('/', (req: Request, res: Response) => {
        res.json({
            name: 'AI Meeting Assistant API',
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            timestamp: new Date().toISOString(),
        });
    });

    // Mount API routes
    app.use('/api', apiRouter);

    // 404 handler - must be after all routes
    app.use(notFoundHandler);

    // Global error handling middleware - must be last
    app.use(errorHandler);

    return app;
};

// Create and export the app
const app = createApp();

export default app;
export { createApp, corsOptions, globalLimiter, authLimiter, upload, uploadRecording };
