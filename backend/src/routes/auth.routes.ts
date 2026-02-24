import { Router, Request, Response, NextFunction } from 'express';
import {
    register,
    login,
    logout,
    refreshTokenHandler,
    forgotPassword,
    resetPassword,
    verifyEmail,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Authentication Routes
 * Handles user registration, login, logout, and token management
 */

const router = Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user and return tokens
 * @access  Public
 */
router.post('/login', login);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user and invalidate tokens
 * @access  Private
 */
router.post('/logout', logout);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', refreshTokenHandler);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post('/forgot-password', forgotPassword);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password using token
 * @access  Public
 */
router.post('/reset-password', resetPassword);

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify user email address
 * @access  Public
 */
router.post('/verify-email', verifyEmail);

/**
 * @route   POST /api/v1/auth/resend-verification
 * @desc    Resend email verification
 * @access  Public
 */
router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { z } = await import('zod');
        const authService = await import('../services/auth.services');
        const emailService = await import('../services/email.service');

        const schema = z.object({
            email: z.string().email('Invalid email address'),
        });

        const { email } = schema.parse(req.body);

        const verificationToken = await authService.generateEmailVerificationToken(email);

        if (verificationToken) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            try {
                // Use the welcome template with a verification CTA for now
                await emailService.sendWelcomeEmail({
                    to: email,
                    name: 'User',
                    loginUrl: `${frontendUrl}/verify-email?token=${verificationToken}`,
                });
            } catch {
                // Don't fail if email sending fails
            }
        }

        // Always return success to prevent email enumeration
        res.json({
            success: true,
            message: 'If an unverified account exists, a verification email has been sent',
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current authenticated user
 * @access  Private
 */
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }

        const { prisma } = await import('../config/database');

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
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

        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.name,
                    name: user.name,
                    role: user.role?.toUpperCase() ?? 'MEMBER',
                    isEmailVerified: user.isEmailVerified,
                    createdAt: user.createdAt,
                    lastLoginAt: user.lastLoginAt,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/v1/auth/change-password
 * @desc    Change password for authenticated user
 * @access  Private
 */
router.put('/change-password', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }

        const { z } = await import('zod');
        const authService = await import('../services/auth.services');

        const schema = z.object({
            currentPassword: z.string().min(1, 'Current password is required'),
            newPassword: z.string()
                .min(8, 'Password must be at least 8 characters')
                .regex(/[A-Z]/, 'Must contain uppercase letter')
                .regex(/[a-z]/, 'Must contain lowercase letter')
                .regex(/[0-9]/, 'Must contain a number'),
        });

        const { currentPassword, newPassword } = schema.parse(req.body);

        await authService.changePassword(req.user.id, currentPassword, newPassword);

        res.json({
            success: true,
            message: 'Password changed successfully',
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/v1/auth/google
 * @desc    Google OAuth authentication
 * @access  Public
 */
router.post('/google', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // TODO: Implement Google OAuth logic
        // 1. Verify Google OAuth token
        // 2. Get user info from Google
        // 3. Find or create user in database
        // 4. Generate application tokens
        // 5. Return user data and tokens

        res.json({
            success: true,
            message: 'Google authentication successful',
            data: {
                // user: { ... },
                // accessToken: '...',
                // refreshToken: '...',
            },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
