import type { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io/dist/namespace';
import * as jwtUtil from '../utils/jwt.util';
import { prisma } from '../config/database';
import { get as redisGet } from '../config/redis';
import logger from '../utils/logger';

/**
 * Authenticated socket user — attached to socket.data
 */
export interface SocketUser {
    id: string;
    email: string;
    name?: string;
    role?: string;
}

/**
 * Socket.IO authentication middleware
 *
 * Clients must send the JWT access token in one of:
 *   1. `auth.token`            — socket.io built-in auth payload
 *   2. `handshake.headers.authorization` — standard Bearer header
 *
 * On success: `socket.data.user` is populated with the user info.
 * On failure: the connection is rejected with a meaningful error.
 */
export function socketAuthMiddleware(
    socket: Socket,
    next: (err?: ExtendedError) => void
): void {
    const token = extractToken(socket);

    if (!token) {
        logger.warn('Socket auth failed: no token', { socketId: socket.id });
        return next(createAuthError('Authentication token is required'));
    }

    // Verify token asynchronously
    verifySocketToken(token, socket)
        .then((user) => {
            socket.data.user = user;
            logger.debug('Socket authenticated', {
                socketId: socket.id,
                userId: user.id,
            });
            next();
        })
        .catch((err) => {
            logger.warn('Socket auth failed', {
                socketId: socket.id,
                error: err instanceof Error ? err.message : String(err),
            });
            next(createAuthError('Invalid or expired authentication token'));
        });
}

/**
 * Extract the JWT token from the socket handshake
 */
function extractToken(socket: Socket): string | null {
    // 1. Auth payload (recommended — `io({ auth: { token } })`)
    const authToken = (socket.handshake.auth as Record<string, unknown>)?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
        return authToken;
    }

    // 2. Authorization header
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    return null;
}

/**
 * Verify the token, check blacklist, and look up the user
 */
async function verifySocketToken(token: string, socket: Socket): Promise<SocketUser> {
    // Decode & verify JWT
    const payload = jwtUtil.verifyAccessToken(token);

    if (!payload || !payload.userId) {
        throw new Error('Invalid token payload');
    }

    // Check Redis blacklist
    try {
        const blacklisted = await redisGet(`blacklist:${token}`);
        if (blacklisted !== null) {
            throw new Error('Token has been revoked');
        }
    } catch (err) {
        // If Redis is down, fail open for availability (same as HTTP auth)
        if ((err as Error).message === 'Token has been revoked') {
            throw err;
        }
    }

    // Fetch user from DB
    const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
        },
    });

    if (!user) {
        throw new Error('User not found');
    }

    if (!user.isActive) {
        throw new Error('Account is disabled');
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        role: user.role ?? undefined,
    };
}

/**
 * Create a Socket.IO-compatible authentication error
 */
function createAuthError(message: string): ExtendedError {
    const err = new Error(message) as ExtendedError;
    (err as any).data = { type: 'AUTH_ERROR', message };
    return err;
}

/**
 * Helper: get authenticated user from a socket (for use in event handlers)
 */
export function getSocketUser(socket: Socket): SocketUser | null {
    return (socket.data?.user as SocketUser) ?? null;
}

/**
 * Helper: require authentication in an event handler.
 * Disconnects the socket if not authenticated.
 */
export function requireSocketAuth(socket: Socket): SocketUser {
    const user = getSocketUser(socket);
    if (!user) {
        socket.disconnect(true);
        throw new Error('Socket not authenticated');
    }
    return user;
}
