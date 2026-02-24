import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Request ID Middleware
 * Attaches a unique request ID to every request for distributed tracing
 */

declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}

export default requestIdMiddleware;
