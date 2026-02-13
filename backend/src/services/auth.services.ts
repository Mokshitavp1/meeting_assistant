import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { get as redisGet, set as redisSet, del as redisDel } from '../config/redis';
import {
    AuthenticationError,
    ConflictError,
    NotFoundError,
    BadRequestError,
} from '../middleware/error.middleware';
import * as jwtUtil from '../utils/jwt.util';

/**
 * Authentication Service
 * Handles all authentication-related business logic
 */

/**
 * Interfaces
 */

export interface RegisterUserData {
    email: string;
    password: string;
    name: string;
}

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

export interface TokenPayload {
    userId: string;
    email: string;
    iat?: number;
    exp?: number;
}

export interface UserResponse {
    id: string;
    email: string;
    name: string | null;
    role: string | null;
    isEmailVerified: boolean;
    createdAt: Date;
    lastLoginAt: Date | null;
}

export interface RefreshTokenRecord {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    isRevoked: boolean;
    createdAt: Date;
}

/**
 * Configuration
 */
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;

/**
 * User Registration
 * Creates a new user with hashed password
 */
export async function registerUser(data: RegisterUserData): Promise<{
    user: UserResponse;
    tokens: TokenPair;
    verificationToken: string;
}> {
    const { email, password, name } = data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });

    if (existingUser) {
        throw new ConflictError('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Generate email verification token
    const verificationToken = generateSecureToken();
    const verificationTokenExpiry = new Date(
        Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000
    );

    // Create user
    const user = await prisma.user.create({
        data: {
            email: email.toLowerCase(),
            password: hashedPassword,
            name,
            emailVerificationToken: verificationToken,
            emailVerificationExpiry: verificationTokenExpiry,
            isEmailVerified: false,
        },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isEmailVerified: true,
            createdAt: true,
            lastLoginAt: true,
        },
    });

    // Generate JWT tokens
    const tokens = await generateTokenPair({ userId: user.id, email: user.email });

    return {
        user,
        tokens,
        verificationToken,
    };
}

/**
 * User Login
 * Verifies credentials and returns JWT tokens
 */
export async function loginUser(credentials: LoginCredentials): Promise<{
    user: UserResponse;
    tokens: TokenPair;
}> {
    const { email, password } = credentials;

    // Find user by email
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });

    if (!user) {
        throw new AuthenticationError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Check if account is active
    if (user.isActive === false) {
        throw new AuthenticationError('Account is disabled', 'ACCOUNT_DISABLED');
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password);

    if (!isPasswordValid) {
        throw new AuthenticationError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Update last login timestamp
    await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
    });

    // Generate JWT tokens
    const tokens = await generateTokenPair({ userId: user.id, email: user.email });

    return {
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isEmailVerified: user.isEmailVerified,
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt,
        },
        tokens,
    };
}

/**
 * Generate JWT Access Token
 */
export function generateAccessToken(userId: string, email: string): string {
    return jwtUtil.generateAccessToken(userId, email);
}

/**
 * Generate JWT Refresh Token
 */
export function generateRefreshToken(userId: string, email: string): string {
    return jwtUtil.generateRefreshToken(userId);
}

/**
 * Generate Token Pair (Access + Refresh)
 * Stores refresh token in database for rotation
 */
export async function generateTokenPair(payload: { userId: string; email: string }): Promise<TokenPair> {
    const accessToken = jwtUtil.generateAccessToken(payload.userId, payload.email);
    const refreshToken = jwtUtil.generateRefreshToken(payload.userId);

    // Calculate refresh token expiration
    const decoded = jwtUtil.decodeToken(refreshToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Store refresh token in database
    await prisma.refreshToken.create({
        data: {
            token: refreshToken,
            userId: payload.userId,
            expiresAt,
            isRevoked: false,
        },
    });

    return {
        accessToken,
        refreshToken,
    };
}

/**
 * Verify Access Token
 */
export function verifyAccessToken(token: string): TokenPayload {
    return jwtUtil.verifyAccessToken(token);
}

/**
 * Verify Refresh Token
 */
export function verifyRefreshToken(token: string): TokenPayload {
    const decoded = jwtUtil.verifyRefreshToken(token);
    // Convert RefreshTokenPayload to TokenPayload by adding email as empty string if needed
    return {
        userId: decoded.userId,
        email: '', // Refresh tokens don't have email in jwt.util.ts
        iat: decoded.iat,
        exp: decoded.exp,
    };
}

/**
 * Refresh Token Rotation
 * Validates old refresh token and issues new token pair
 */
export async function rotateRefreshToken(oldRefreshToken: string): Promise<TokenPair> {
    // Verify refresh token
    const payload = verifyRefreshToken(oldRefreshToken);

    // Check if refresh token exists in database and is not revoked
    const storedToken = await prisma.refreshToken.findUnique({
        where: { token: oldRefreshToken },
    });

    if (!storedToken) {
        throw new AuthenticationError('Refresh token not found', 'TOKEN_NOT_FOUND');
    }

    if (storedToken.isRevoked) {
        throw new AuthenticationError('Refresh token has been revoked', 'TOKEN_REVOKED');
    }

    if (storedToken.expiresAt < new Date()) {
        throw new AuthenticationError('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
    }

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
        where: { id: payload.userId },
    });

    if (!user) {
        throw new NotFoundError('User');
    }

    if (user.isActive === false) {
        throw new AuthenticationError('Account is disabled', 'ACCOUNT_DISABLED');
    }

    // Revoke old refresh token
    await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true },
    });

    // Generate new token pair
    const tokens = await generateTokenPair({
        userId: user.id,
        email: user.email,
    });

    return tokens;
}

/**
 * Blacklist Token (for logout)
 * Stores token in Redis with expiration
 */
export async function blacklistToken(token: string, expiresIn: number = 900): Promise<void> {
    try {
        await redisSet(`blacklist:${token}`, '1', expiresIn);
    } catch (error) {
        console.error('Error blacklisting token:', error);
        throw new Error('Failed to blacklist token');
    }
}

/**
 * Check if Token is Blacklisted
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
    try {
        const blacklisted = await redisGet(`blacklist:${token}`);
        return blacklisted !== null;
    } catch (error) {
        console.error('Error checking token blacklist:', error);
        // Fail open - if Redis is down, allow the request
        return false;
    }
}

/**
 * Revoke Refresh Token
 */
export async function revokeRefreshToken(token: string): Promise<void> {
    const storedToken = await prisma.refreshToken.findUnique({
        where: { token },
    });

    if (storedToken) {
        await prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { isRevoked: true },
        });
    }
}

/**
 * Revoke All Refresh Tokens for User
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: {
            userId,
            isRevoked: false,
        },
        data: {
            isRevoked: true,
        },
    });
}

/**
 * Generate Password Reset Token
 */
export async function generatePasswordResetToken(email: string): Promise<string | null> {
    // Find user by email
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });

    // Don't reveal if user exists (return null silently)
    if (!user) {
        return null;
    }

    // Generate secure token
    const resetToken = generateSecureToken();
    const resetTokenExpiry = new Date(
        Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000
    );

    // Save reset token to database
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordResetToken: resetToken,
            passwordResetExpiry: resetTokenExpiry,
        },
    });

    return resetToken;
}

/**
 * Validate Password Reset Token
 */
export async function validatePasswordResetToken(token: string): Promise<UserResponse> {
    const user = await prisma.user.findFirst({
        where: {
            passwordResetToken: token,
            passwordResetExpiry: {
                gt: new Date(), // Token not expired
            },
        },
    });

    if (!user) {
        throw new BadRequestError('Invalid or expired password reset token');
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
    };
}

/**
 * Reset Password
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
    // Validate token and get user
    const user = await validatePasswordResetToken(token);

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and clear reset token
    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashedPassword,
            passwordResetToken: null,
            passwordResetExpiry: null,
        },
    });

    // Revoke all existing refresh tokens for security
    await revokeAllRefreshTokens(user.id);
}

/**
 * Generate Email Verification Token
 */
export async function generateEmailVerificationToken(email: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });

    if (!user) {
        return null;
    }

    // Check if already verified
    if (user.isEmailVerified) {
        throw new BadRequestError('Email is already verified');
    }

    // Generate new verification token
    const verificationToken = generateSecureToken();
    const verificationTokenExpiry = new Date(
        Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000
    );

    // Save to database
    await prisma.user.update({
        where: { id: user.id },
        data: {
            emailVerificationToken: verificationToken,
            emailVerificationExpiry: verificationTokenExpiry,
        },
    });

    return verificationToken;
}

/**
 * Validate Email Verification Token
 */
export async function validateEmailVerificationToken(token: string): Promise<UserResponse> {
    const user = await prisma.user.findFirst({
        where: {
            emailVerificationToken: token,
            emailVerificationExpiry: {
                gt: new Date(), // Token not expired
            },
            isEmailVerified: false,
        },
    });

    if (!user) {
        throw new BadRequestError('Invalid or expired email verification token');
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
    };
}

/**
 * Verify Email Address
 */
export async function verifyEmail(token: string): Promise<UserResponse> {
    // Validate token and get user
    const user = await validateEmailVerificationToken(token);

    // Update user as verified
    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
            isEmailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpiry: null,
        },
    });

    return {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        isEmailVerified: updatedUser.isEmailVerified,
        createdAt: updatedUser.createdAt,
        lastLoginAt: updatedUser.lastLoginAt,
    };
}

/**
 * Change Password for Authenticated User
 */
export async function changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
): Promise<void> {
    // Get user
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new NotFoundError('User');
    }

    // Verify current password
    const isPasswordValid = await verifyPassword(currentPassword, user.password);

    if (!isPasswordValid) {
        throw new AuthenticationError('Current password is incorrect', 'INVALID_PASSWORD');
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
    });

    // Optionally revoke all refresh tokens (force re-login on all devices)
    // await revokeAllRefreshTokens(userId);
}

/**
 * Helper: Hash Password
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Helper: Verify Password
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
}

/**
 * Helper: Generate Secure Random Token
 */
export function generateSecureToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Clean Up Expired Refresh Tokens
 * Should be run periodically (e.g., via cron job)
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
        where: {
            expiresAt: {
                lt: new Date(),
            },
        },
    });

    return result.count;
}

/**
 * Get User Refresh Tokens
 */
export async function getUserRefreshTokens(userId: string): Promise<RefreshTokenRecord[]> {
    const tokens = await prisma.refreshToken.findMany({
        where: {
            userId,
            isRevoked: false,
            expiresAt: {
                gt: new Date(),
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    return tokens;
}
