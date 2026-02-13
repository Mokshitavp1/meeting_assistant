import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import multer from 'multer';

/**
 * Custom Application Error Class
 * Base class for all operational errors
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly code?: string;
    public readonly details?: any;

    constructor(
        message: string,
        statusCode: number = 500,
        code?: string,
        details?: any,
        isOperational: boolean = true
    ) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.code = code;
        this.details = details;

        // Maintains proper stack trace for where error was thrown
        Error.captureStackTrace(this, this.constructor);
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

/**
 * Specific Error Classes
 */

export class ValidationError extends AppError {
    constructor(message: string = 'Validation failed', details?: any) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}

export class AuthenticationError extends AppError {
    constructor(message: string = 'Authentication failed', code?: string) {
        super(message, 401, code || 'AUTHENTICATION_ERROR');
    }
}

export class AuthorizationError extends AppError {
    constructor(message: string = 'Access forbidden', code?: string) {
        super(message, 403, code || 'AUTHORIZATION_ERROR');
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string = 'Resource', id?: string) {
        const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
        super(message, 404, 'NOT_FOUND');
    }
}

export class ConflictError extends AppError {
    constructor(message: string = 'Resource already exists') {
        super(message, 409, 'CONFLICT_ERROR');
    }
}

export class BadRequestError extends AppError {
    constructor(message: string = 'Bad request', details?: any) {
        super(message, 400, 'BAD_REQUEST', details);
    }
}

export class DatabaseError extends AppError {
    constructor(message: string = 'Database operation failed') {
        super(message, 500, 'DATABASE_ERROR', undefined, false);
    }
}

export class ExternalServiceError extends AppError {
    constructor(service: string, message?: string) {
        super(
            message || `External service ${service} failed`,
            503,
            'EXTERNAL_SERVICE_ERROR'
        );
    }
}

/**
 * Error Response Interface
 */
interface ErrorResponse {
    success: false;
    error: string;
    message: string;
    code?: string;
    details?: any;
    stack?: string;
    timestamp: string;
}

/**
 * Format error response
 */
const formatErrorResponse = (
    error: Error | AppError,
    includeStack: boolean = false
): ErrorResponse => {
    const response: ErrorResponse = {
        success: false,
        error: error.name || 'Error',
        message: error.message,
        timestamp: new Date().toISOString(),
    };

    if (error instanceof AppError) {
        response.code = error.code;
        response.details = error.details;
    }

    if (includeStack && error.stack) {
        response.stack = error.stack;
    }

    return response;
};

/**
 * Handle Prisma Errors
 */
const handlePrismaError = (error: Prisma.PrismaClientKnownRequestError): AppError => {
    switch (error.code) {
        case 'P2002': {
            // Unique constraint violation
            const field = (error.meta?.target as string[])?.join(', ') || 'field';
            return new ConflictError(`A record with this ${field} already exists`);
        }
        case 'P2025': {
            // Record not found
            return new NotFoundError('Record');
        }
        case 'P2003': {
            // Foreign key constraint violation
            return new BadRequestError('Related record does not exist');
        }
        case 'P2014': {
            // Required relation violation
            return new BadRequestError('Cannot delete record with related data');
        }
        default: {
            return new DatabaseError(`Database error: ${error.message}`);
        }
    }
};

/**
 * Handle Zod Validation Errors
 */
const handleZodError = (error: ZodError): AppError => {
    const details = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
    }));

    return new ValidationError('Request validation failed', details);
};

/**
 * Handle JWT Errors
 */
const handleJWTError = (error: JsonWebTokenError | TokenExpiredError): AppError => {
    if (error instanceof TokenExpiredError) {
        return new AuthenticationError('Token has expired', 'TOKEN_EXPIRED');
    }
    return new AuthenticationError('Invalid token', 'INVALID_TOKEN');
};

/**
 * Handle Multer Errors
 */
const handleMulterError = (error: multer.MulterError): AppError => {
    switch (error.code) {
        case 'LIMIT_FILE_SIZE':
            return new BadRequestError('File size exceeds maximum allowed size');
        case 'LIMIT_FILE_COUNT':
            return new BadRequestError('Too many files uploaded');
        case 'LIMIT_UNEXPECTED_FILE':
            return new BadRequestError('Unexpected file field');
        default:
            return new BadRequestError(error.message);
    }
};

/**
 * Log error using winston or console
 */
const logError = (error: Error | AppError, req: Request): void => {
    const errorLog = {
        timestamp: new Date().toISOString(),
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
        },
        request: {
            method: req.method,
            url: req.originalUrl,
            params: req.params,
            query: req.query,
            body: sanitizeBody(req.body),
            ip: req.ip,
            userAgent: req.get('user-agent'),
            userId: (req as any).user?.id,
        },
    };

    // Determine if it's an operational or programming error
    const isOperational = error instanceof AppError && error.isOperational;

    if (isOperational) {
        // Operational error - less severe, log as warning
        console.warn('Operational Error:', JSON.stringify(errorLog, null, 2));
        // TODO: Replace with winston logger
        // logger.warn('Operational Error', errorLog);
    } else {
        // Programming error - critical, log as error
        console.error('Programming Error:', JSON.stringify(errorLog, null, 2));
        // TODO: Replace with winston logger
        // logger.error('Programming Error', errorLog);

        // Optional: Send alert to monitoring service (Sentry, DataDog, etc.)
        // if (process.env.NODE_ENV === 'production') {
        //     Sentry.captureException(error);
        // }
    }
};

/**
 * Sanitize request body to remove sensitive data before logging
 */
const sanitizeBody = (body: any): any => {
    if (!body || typeof body !== 'object') {
        return body;
    }

    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'accessToken', 'refreshToken'];

    for (const field of sensitiveFields) {
        if (field in sanitized) {
            sanitized[field] = '[REDACTED]';
        }
    }

    return sanitized;
};

/**
 * Determine if error details should be sent to client
 */
const shouldSendDetails = (): boolean => {
    return process.env.NODE_ENV === 'development';
};

/**
 * Global Error Handling Middleware
 * This should be the last middleware in the chain
 */
export const errorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    // Log the error
    logError(err, req);

    // Convert known error types to AppError
    let error: AppError;

    if (err instanceof AppError) {
        error = err;
    } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
        error = handlePrismaError(err);
    } else if (err instanceof ZodError) {
        error = handleZodError(err);
    } else if (err instanceof JsonWebTokenError || err instanceof TokenExpiredError) {
        error = handleJWTError(err);
    } else if (err instanceof multer.MulterError) {
        error = handleMulterError(err);
    } else {
        // Unknown error - treat as programming error
        error = new AppError(
            shouldSendDetails() ? err.message : 'Internal Server Error',
            500,
            'INTERNAL_ERROR',
            undefined,
            false
        );
    }

    // Format error response
    const response = formatErrorResponse(error, shouldSendDetails());

    // Send response
    res.status(error.statusCode).json(response);
};

/**
 * 404 Not Found Handler
 * Handle requests to undefined routes
 */
export const notFoundHandler = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const error = new NotFoundError('Route');
    error.message = `Route ${req.method} ${req.originalUrl} not found`;
    next(error);
};

/**
 * Async Route Handler Wrapper
 * Wraps async route handlers to catch errors and pass to error middleware
 */
export const asyncHandler = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * Validation Error Handler
 * Creates a validation error from Zod schema or custom validation
 */
export const validateRequest = (schema: any) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                next(handleZodError(error));
            } else {
                next(error);
            }
        }
    };
};
