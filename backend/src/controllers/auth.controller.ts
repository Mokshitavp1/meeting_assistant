import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    ValidationError,
    BadRequestError,
} from '../middleware/error.middleware';
import * as authService from '../services/auth.services';
import * as emailService from '../services/email.service';

/**
 * Validation Schemas
 */

const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
});

const forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});

const verifyEmailSchema = z.object({
    token: z.string().min(1, 'Verification token is required'),
});

/**
 * Register - Create new user account with email/password
 * POST /api/v1/auth/register
 */
export const register = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Validate input
        const validatedData = registerSchema.parse(req.body);

        const { email, password, name } = validatedData;

        // Call service to register user
        const result = await authService.registerUser({ email, password, name });

        // Send verification email
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        try {
            await emailService.sendWelcomeEmail({
                to: result.user.email,
                name: result.user.name || 'User',
                loginUrl: `${frontendUrl}/login`,
            });
        } catch {
            // Don't fail registration if email fails
        }

        res.status(201).json({
            success: true,
            message: 'User registered successfully. Please verify your email.',
            data: {
                user: result.user,
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken,
            },
        });
    }
);

/**
 * Login - Authenticate user and return JWT tokens
 * POST /api/v1/auth/login
 */
export const login = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Validate input
        const validatedData = loginSchema.parse(req.body);

        const { email, password } = validatedData;

        // Call service to login user
        const result = await authService.loginUser({ email, password });

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: result.user,
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken,
            },
        });
    }
);

/**
 * Logout - Invalidate refresh token
 * POST /api/v1/auth/logout
 */
export const logout = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Get access token from header
        const authHeader = req.headers.authorization;
        const accessToken = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : authHeader;

        // Get refresh token from body (optional)
        const { refreshToken } = req.body;

        if (accessToken) {
            // Blacklist access token (expires in 15 minutes by default)
            const expiresIn = parseInt(process.env.JWT_ACCESS_EXPIRATION_SECONDS || '900');
            await authService.blacklistToken(accessToken, expiresIn);
        }

        if (refreshToken) {
            // Revoke refresh token
            await authService.revokeRefreshToken(refreshToken);
        }

        res.status(200).json({
            success: true,
            message: 'Logout successful',
        });
    }
);

/**
 * Refresh Token - Generate new access token from refresh token
 * POST /api/v1/auth/refresh
 */
export const refreshTokenHandler = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Validate input
        const validatedData = refreshTokenSchema.parse(req.body);

        const { refreshToken } = validatedData;

        // Rotate refresh token (validates and issues new tokens)
        const tokens = await authService.rotateRefreshToken(refreshToken);

        res.status(200).json({
            success: true,
            message: 'Access token refreshed successfully',
            data: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            },
        });
    }
);

/**
 * Forgot Password - Send password reset email
 * POST /api/v1/auth/forgot-password
 */
export const forgotPassword = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Validate input
        const validatedData = forgotPasswordSchema.parse(req.body);

        const { email } = validatedData;

        // Generate password reset token (returns null if user doesn't exist)
        const resetToken = await authService.generatePasswordResetToken(email);

        if (resetToken) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            try {
                const user = await authService.validatePasswordResetToken(resetToken);
                await emailService.sendPasswordResetEmail({
                    to: email,
                    name: user.name || 'User',
                    resetUrl: `${frontendUrl}/forgot-password?token=${resetToken}`,
                    expiresInMinutes: 60,
                });
            } catch {
                // Don't fail the response if sending fails
            }
        }

        // Always return success to prevent email enumeration
        res.status(200).json({
            success: true,
            message: 'If an account exists with this email, a password reset link has been sent',
        });
    }
);

/**
 * Reset Password - Reset password with token
 * POST /api/v1/auth/reset-password
 */
export const resetPassword = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Validate input
        const validatedData = resetPasswordSchema.parse(req.body);

        const { token, password } = validatedData;

        // Reset password (validates token, updates password, revokes tokens)
        await authService.resetPassword(token, password);

        // Password changed confirmation is implicit — user must re-login

        res.status(200).json({
            success: true,
            message: 'Password reset successful. Please login with your new password.',
        });
    }
);

/**
 * Verify Email - Verify email address with token
 * POST /api/v1/auth/verify-email
 */
export const verifyEmail = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Validate input
        const validatedData = verifyEmailSchema.parse(req.body);

        const { token } = validatedData;

        // Verify email (validates token and updates user)
        const user = await authService.verifyEmail(token);

        // Send welcome email on successful verification
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        try {
            await emailService.sendWelcomeEmail({
                to: user.email,
                name: user.name || 'User',
                loginUrl: `${frontendUrl}/login`,
            });
        } catch {
            // Non-critical
        }

        res.status(200).json({
            success: true,
            message: 'Email verified successfully',
            data: {
                user,
            },
        });
    }
);
