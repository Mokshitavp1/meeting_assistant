import jwt, { SignOptions, VerifyOptions, JwtPayload } from 'jsonwebtoken';

/**
 * JWT Utility Module
 * Provides JWT token generation, verification, and decoding utilities
 */

/**
 * Token Payload Interfaces
 */
export interface AccessTokenPayload {
    userId: string;
    email: string;
    iat?: number;
    exp?: number;
}

export interface RefreshTokenPayload {
    userId: string;
    iat?: number;
    exp?: number;
}

export interface DecodedToken extends JwtPayload {
    userId: string;
    email?: string;
}

/**
 * Token Expiration Constants
 */
export const TOKEN_EXPIRATION = {
    ACCESS_TOKEN: process.env.JWT_ACCESS_EXPIRATION || '15m',
    REFRESH_TOKEN: process.env.JWT_REFRESH_EXPIRATION || '7d',
    ACCESS_TOKEN_SECONDS: 15 * 60, // 15 minutes
    REFRESH_TOKEN_SECONDS: 7 * 24 * 60 * 60, // 7 days
} as const;

/**
 * Token Secret Constants
 */
export const TOKEN_SECRETS = {
    ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '',
    REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
} as const;

/**
 * Validate JWT secrets on module load
 */
if (!TOKEN_SECRETS.ACCESS_SECRET || !TOKEN_SECRETS.REFRESH_SECRET) {
    throw new Error('JWT secrets must be configured. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in environment.');
}

/**
 * Generate Access Token
 * Creates a short-lived JWT access token for API authentication
 *
 * @param userId - User ID to encode in token
 * @param email - User email to encode in token
 * @returns Signed JWT access token (default: 15 minute expiration)
 *
 * @example
 * ```typescript
 * const token = generateAccessToken('user123', 'user@example.com');
 * ```
 */
export function generateAccessToken(userId: string, email: string): string {
    const payload: AccessTokenPayload = {
        userId,
        email,
    };

    const options: SignOptions = {
        expiresIn: TOKEN_EXPIRATION.ACCESS_TOKEN as SignOptions['expiresIn'],
        issuer: process.env.JWT_ISSUER || 'ai-meeting-assistant',
        audience: process.env.JWT_AUDIENCE || 'api',
    };

    return jwt.sign(payload, TOKEN_SECRETS.ACCESS_SECRET, options);
}

/**
 * Generate Refresh Token
 * Creates a long-lived JWT refresh token for obtaining new access tokens
 *
 * @param userId - User ID to encode in token
 * @returns Signed JWT refresh token (default: 7 day expiration)
 *
 * @example
 * ```typescript
 * const refreshToken = generateRefreshToken('user123');
 * ```
 */
export function generateRefreshToken(userId: string): string {
    const payload: RefreshTokenPayload = {
        userId,
    };

    const options: SignOptions = {
        expiresIn: TOKEN_EXPIRATION.REFRESH_TOKEN as SignOptions['expiresIn'],
        issuer: process.env.JWT_ISSUER || 'ai-meeting-assistant',
        audience: process.env.JWT_AUDIENCE || 'api',
    };

    return jwt.sign(payload, TOKEN_SECRETS.REFRESH_SECRET, options);
}

/**
 * Verify Token
 * Verifies JWT token signature and expiration using the provided secret
 *
 * @param token - JWT token to verify
 * @param secret - Secret key to verify token with (ACCESS_SECRET or REFRESH_SECRET)
 * @returns Decoded token payload if valid
 * @throws Error if token is invalid, expired, or verification fails
 *
 * @example
 * ```typescript
 * try {
 *   const decoded = verifyToken(token, TOKEN_SECRETS.ACCESS_SECRET);
 *   console.log('User ID:', decoded.userId);
 * } catch (error) {
 *   console.error('Token verification failed:', error.message);
 * }
 * ```
 */
export function verifyToken<T extends JwtPayload = DecodedToken>(
    token: string,
    secret: string
): T {
    const options: VerifyOptions = {
        issuer: process.env.JWT_ISSUER || 'ai-meeting-assistant',
        audience: process.env.JWT_AUDIENCE || 'api',
    };

    try {
        return jwt.verify(token, secret, options) as T;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error('Token has expired');
        } else if (error instanceof jwt.JsonWebTokenError) {
            throw new Error('Invalid token');
        } else if (error instanceof jwt.NotBeforeError) {
            throw new Error('Token not yet valid');
        } else {
            throw new Error('Token verification failed');
        }
    }
}

/**
 * Decode Token Without Verification
 * Decodes JWT token payload without verifying signature or expiration
 * Useful for reading token data when verification is not needed
 *
 * @param token - JWT token to decode
 * @returns Decoded token payload or null if decoding fails
 *
 * @example
 * ```typescript
 * const decoded = decodeToken(token);
 * if (decoded) {
 *   console.log('User ID:', decoded.userId);
 *   console.log('Expires at:', new Date(decoded.exp! * 1000));
 * }
 * ```
 */
export function decodeToken(token: string): DecodedToken | null {
    try {
        const decoded = jwt.decode(token);

        if (!decoded || typeof decoded !== 'object') {
            return null;
        }

        return decoded as DecodedToken;
    } catch (error) {
        console.error('Error decoding token:', error);
        return null;
    }
}

/**
 * Additional Helper Functions
 */

/**
 * Verify Access Token
 * Convenience wrapper for verifying access tokens specifically
 *
 * @param token - Access token to verify
 * @returns Decoded access token payload
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
    return verifyToken<AccessTokenPayload>(token, TOKEN_SECRETS.ACCESS_SECRET);
}

/**
 * Verify Refresh Token
 * Convenience wrapper for verifying refresh tokens specifically
 *
 * @param token - Refresh token to verify
 * @returns Decoded refresh token payload
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
    return verifyToken<RefreshTokenPayload>(token, TOKEN_SECRETS.REFRESH_SECRET);
}

/**
 * Get Token Expiration Date
 * Extracts the expiration timestamp from a token and returns it as a Date
 *
 * @param token - JWT token
 * @returns Expiration date or null if not found
 */
export function getTokenExpiration(token: string): Date | null {
    const decoded = decodeToken(token);

    if (!decoded || !decoded.exp) {
        return null;
    }

    return new Date(decoded.exp * 1000);
}

/**
 * Check if Token is Expired
 * Checks if a token is expired without verifying its signature
 *
 * @param token - JWT token
 * @returns True if token is expired, false otherwise
 */
export function isTokenExpired(token: string): boolean {
    const expiration = getTokenExpiration(token);

    if (!expiration) {
        return true;
    }

    return expiration.getTime() < Date.now();
}

/**
 * Get Remaining Token Validity
 * Calculates how many seconds until the token expires
 *
 * @param token - JWT token
 * @returns Remaining seconds until expiration, or 0 if expired/invalid
 */
export function getRemainingValidity(token: string): number {
    const expiration = getTokenExpiration(token);

    if (!expiration) {
        return 0;
    }

    const remaining = Math.floor((expiration.getTime() - Date.now()) / 1000);

    return Math.max(0, remaining);
}

/**
 * Extract Token from Authorization Header
 * Supports both "Bearer <token>" and "<token>" formats
 *
 * @param authHeader - Authorization header value
 * @returns Extracted token or null if not found
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
        return null;
    }

    // Check if it's Bearer token format
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Otherwise return the entire header value
    return authHeader;
}
