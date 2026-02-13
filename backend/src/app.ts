import express, { Application, Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Import configuration
import { config } from 'dotenv';
import { DatabaseClient } from './config/database';
import { RedisClient } from './config/redis';

// Import routes
import apiRouter from './routes/index';

// Import error handling
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

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

/**
 * Rate Limiting Configuration
 */
const createRateLimiter = (windowMs: number, max: number, message: string) => {
    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => process.env.RATE_LIMIT_ENABLED !== 'true',
    });
};

// Global rate limiter
const globalLimiter = createRateLimiter(
    parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000,
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    'Too many requests from this IP, please try again later'
);

// Auth rate limiter (stricter for login/registration)
export const authLimiter = createRateLimiter(
    parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000,
    parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5'),
    'Too many authentication attempts, please try again later'
);

/**
 * Multer Configuration for File Uploads
 */
const uploadDir = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directories exist
const createUploadDirs = () => {
    const dirs = [
        uploadDir,
        path.join(uploadDir, 'temp'),
        path.join(uploadDir, 'recordings'),
        path.join(uploadDir, 'documents'),
        path.join(uploadDir, 'avatars'),
    ];

    dirs.forEach((dir) => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

createUploadDirs();

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Determine destination based on file type
        let dest = path.join(uploadDir, 'temp');

        if (file.fieldname === 'recording') {
            dest = path.join(uploadDir, 'recordings');
        } else if (file.fieldname === 'document') {
            dest = path.join(uploadDir, 'documents');
        } else if (file.fieldname === 'avatar') {
            dest = path.join(uploadDir, 'avatars');
        }

        cb(null, dest);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with timestamp and original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext);
        cb(null, `${basename}-${uniqueSuffix}${ext}`);
    },
});

// File filter for validation
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
        '.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.mp3', '.mp4', '.wav', '.m4a'
    ];

    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`));
    }
};

// Multer upload middleware
export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB default
        files: 5, // Max 5 files per request
    },
});

// Recording-specific upload with larger size limit
export const uploadRecording = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedAudioTypes = process.env.ALLOWED_AUDIO_TYPES?.split(',') || [
            '.mp3', '.wav', '.m4a', '.webm', '.ogg'
        ];
        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedAudioTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Audio file type ${ext} not allowed`));
        }
    },
    limits: {
        fileSize: parseInt(process.env.MAX_RECORDING_SIZE || '524288000'), // 500MB default
        files: 1,
    },
});

/**
 * Custom Request Logging Middleware
 */
const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            timestamp: new Date().toISOString(),
        };

        if (process.env.NODE_ENV === 'development') {
            console.log(JSON.stringify(log, null, 2));
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
export { createApp, corsOptions, globalLimiter };
