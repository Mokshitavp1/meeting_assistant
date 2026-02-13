import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { redisClient, get as redisGet, set as redisSet } from '../config/redis';
import * as jwtUtil from '../utils/jwt.util';

/**
 * User Interface (basic fields from token)
 */
export interface AuthUser {
    id: string;
    email: string;
    name?: string;
    role?: string;
    workspaceId?: string;
}

/**
 * Extend Express Request to include user
 */
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

/**
 * Check if token is blacklisted in Redis
 */
const isTokenBlacklisted = async (token: string): Promise<boolean> => {
    try {
        const blacklisted = await redisGet(`blacklist:${token}`);
        return blacklisted !== null;
    } catch (error) {
        console.error('Error checking token blacklist:', error);
        // If Redis fails, allow the request (fail open for availability)
        return false;
    }
};

/**
 * Get user from database by ID
 */
const getUserById = async (userId: string): Promise<AuthUser | null> => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                // Add other fields as needed
                // workspaceId: true,
            },
        });

        if (!user) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            name: user.name || undefined,
            role: user.role || undefined,
            // workspaceId: user.workspaceId || undefined,
        };
    } catch (error) {
        console.error('Error fetching user from database:', error);
        return null;
    }
};

/**
 * Authentication Middleware (Required)
 * Requires valid JWT token in Authorization header
 * Attaches user object to req.user
 * Returns 401 if authentication fails
 */
export const authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Extract token from header
        const token = jwtUtil.extractTokenFromHeader(req.headers.authorization);

        if (!token) {
            res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authentication token provided',
            });
            return;
        }

        // Check if token is blacklisted
        const blacklisted = await isTokenBlacklisted(token);
        if (blacklisted) {
            res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'Token has been revoked',
            });
            return;
        }

        // Verify token
        let decoded: jwtUtil.AccessTokenPayload;
        try {
            decoded = jwtUtil.verifyAccessToken(token);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            if (errorMessage.includes('expired')) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'Token has expired',
                    code: 'TOKEN_EXPIRED',
                });
                return;
            } else if (errorMessage.includes('Invalid')) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'Invalid token',
                    code: 'INVALID_TOKEN',
                });
                return;
            } else {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'Token verification failed',
                });
                return;
            }
        }

        // Get user from database
        const user = await getUserById(decoded.userId);

        if (!user) {
            res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'User not found',
            });
            return;
        }

        // Attach user to request
        req.user = user;

        // Continue to next middleware
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Authentication failed',
        });
    }
};

/**
 * Optional Authentication Middleware
 * Attaches user to req.user if valid token is provided
 * Does not return error if no token or invalid token
 * Useful for endpoints that work differently for authenticated users
 */
export const optionalAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Extract token from header
        const token = jwtUtil.extractTokenFromHeader(req.headers.authorization);

        // If no token, just continue without user
        if (!token) {
            next();
            return;
        }

        // Check if token is blacklisted
        const blacklisted = await isTokenBlacklisted(token);
        if (blacklisted) {
            next();
            return;
        }

        // Verify token
        let decoded: jwtUtil.AccessTokenPayload;
        try {
            decoded = jwtUtil.verifyAccessToken(token);
        } catch (error) {
            // Invalid token, just continue without user
            next();
            return;
        }

        // Get user from database
        const user = await getUserById(decoded.userId);

        if (user) {
            // Attach user to request if found
            req.user = user;
        }

        // Continue regardless
        next();
    } catch (error) {
        console.error('Optional auth error:', error);
        // Don't fail the request, just continue without user
        next();
    }
};

/**
 * Role-based Authorization Middleware
 * Requires authenticate middleware to be used before this
 * Checks if user has required role
 */
export const authorize = (...allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'Authentication required',
            });
            return;
        }

        if (!req.user.role) {
            res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: 'User has no role assigned',
            });
            return;
        }

        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: 'Insufficient permissions',
            });
            return;
        }

        next();
    };
};

/**
 * Refresh Token Verification
 * Separate from access token verification
 */
export const verifyRefreshToken = (token: string): jwtUtil.RefreshTokenPayload => {
    try {
        return jwtUtil.verifyRefreshToken(token);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (errorMessage.includes('expired')) {
            throw new Error('REFRESH_TOKEN_EXPIRED');
        } else if (errorMessage.includes('Invalid')) {
            throw new Error('INVALID_REFRESH_TOKEN');
        } else {
            throw new Error('REFRESH_TOKEN_VERIFICATION_FAILED');
        }
    }
};

/**
 * Generate Access Token
 */
export const generateAccessToken = (payload: { userId: string; email: string }): string => {
    return jwtUtil.generateAccessToken(payload.userId, payload.email);
};

/**
 * Generate Refresh Token
 */
export const generateRefreshToken = (payload: { userId: string; email: string }): string => {
    return jwtUtil.generateRefreshToken(payload.userId);
};

/**
 * Blacklist Token (for logout)
 * Stores token in Redis with expiration
 */
export const blacklistToken = async (token: string, expiresIn?: number): Promise<void> => {
    try {
        // Use remaining validity if expiration not provided
        const ttl = expiresIn || jwtUtil.getRemainingValidity(token);

        // Store in Redis with expiration
        await redisSet(`blacklist:${token}`, '1', ttl > 0 ? ttl : 900);
    } catch (error) {
        console.error('Error blacklisting token:', error);
        throw new Error('Failed to blacklist token');
    }
};

/**
 * Export helper to check if user is authenticated (for TypeScript type guards)
 */
export const isAuthenticated = (req: Request): req is Request & { user: AuthUser } => {
    return req.user !== undefined;
};
