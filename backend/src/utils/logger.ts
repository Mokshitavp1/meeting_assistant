import winston from 'winston';
import path from 'path';

/**
 * Production-grade Logger using Winston
 * Structured JSON logging with log levels, request context, and rotation
 */

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_DIR = process.env.LOG_DIR || 'logs';

/** Custom format: timestamp + level + message + metadata */
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

/** Human-readable format for development */
const devFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}: ${message}${metaStr}`;
    })
);

const transports: winston.transport[] = [];

if (process.env.NODE_ENV === 'production') {
    // Production: JSON to stdout (for log aggregators like ELK, CloudWatch)
    transports.push(new winston.transports.Console({ format: logFormat }));

    // File transports with rotation (optional)
    try {
        const DailyRotateFile = require('winston-daily-rotate-file');
        transports.push(
            new DailyRotateFile({
                dirname: LOG_DIR,
                filename: 'app-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxSize: '20m',
                maxFiles: '14d',
                format: logFormat,
            }),
            new DailyRotateFile({
                dirname: LOG_DIR,
                filename: 'error-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                level: 'error',
                maxSize: '20m',
                maxFiles: '30d',
                format: logFormat,
            })
        );
    } catch {
        // winston-daily-rotate-file not installed, skip file logging
    }
} else {
    // Development: colorized, human-readable to console
    transports.push(new winston.transports.Console({ format: devFormat }));
}

export const logger = winston.createLogger({
    level: LOG_LEVEL,
    defaultMeta: { service: 'meeting-assistant' },
    transports,
    // Don't exit on uncaught errors
    exitOnError: false,
});

/**
 * Create a child logger with request context
 */
export function createRequestLogger(requestId: string, userId?: string) {
    return logger.child({ requestId, userId });
}

/**
 * Log slow operations (queries, external calls)
 */
export function logSlowOperation(operation: string, durationMs: number, threshold = 1000) {
    if (durationMs > threshold) {
        logger.warn('Slow operation detected', {
            operation,
            durationMs,
            threshold,
        });
    }
}

export default logger;
