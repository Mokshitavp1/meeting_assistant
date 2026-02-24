import bcrypt from 'bcrypt';
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';

jest.mock('../../src/config/database', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        refreshToken: {
            create: jest.fn(),
        },
    },
}));

jest.mock('../../src/config/redis', () => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
}));

import { prisma } from '../../src/config/database';

type MockedPrisma = {
    user: {
        findUnique: ReturnType<typeof jest.fn>;
        create: ReturnType<typeof jest.fn>;
        update: ReturnType<typeof jest.fn>;
    };
    refreshToken: {
        create: ReturnType<typeof jest.fn>;
    };
};

const mockedPrisma = prisma as unknown as MockedPrisma;

let authService: typeof import('../../src/services/auth.services');

describe('Auth Service', () => {
    beforeAll(async () => {
        process.env.JWT_ACCESS_SECRET = 'unit-test-access-secret';
        process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret';
        process.env.JWT_ISSUER = 'ai-meeting-assistant';
        process.env.JWT_AUDIENCE = 'api';

        authService = await import('../../src/services/auth.services');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('registers user with valid data', async () => {
        const now = new Date('2026-02-24T10:00:00.000Z');

        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedPrisma.user.create.mockResolvedValue({
            id: 'user_1',
            email: 'new@example.com',
            name: 'New User',
            role: 'user',
            isEmailVerified: false,
            createdAt: now,
            lastLoginAt: null,
        });
        mockedPrisma.refreshToken.create.mockResolvedValue({ id: 'rt_1' });

        const result = await authService.registerUser({
            email: 'new@example.com',
            password: 'StrongPass123!',
            name: 'New User',
        });

        expect(result.user.email).toBe('new@example.com');
        expect(result.tokens.accessToken).toEqual(expect.any(String));
        expect(result.tokens.refreshToken).toEqual(expect.any(String));
        expect(result.verificationToken).toEqual(expect.any(String));

        expect(mockedPrisma.user.create).toHaveBeenCalledTimes(1);
        const createInput = mockedPrisma.user.create.mock.calls[0][0];
        expect(createInput.data.password).toEqual(expect.any(String));
        expect(createInput.data.password).not.toBe('StrongPass123!');
    });

    it('fails registration for duplicate email', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'user_existing',
            email: 'existing@example.com',
        });

        await expect(
            authService.registerUser({
                email: 'existing@example.com',
                password: 'StrongPass123!',
                name: 'Existing User',
            })
        ).rejects.toThrow('User with this email already exists');

        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('logs in user with correct credentials', async () => {
        const hashed = await bcrypt.hash('CorrectPass123!', 4);
        const now = new Date('2026-02-24T10:10:00.000Z');

        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'user_login_1',
            email: 'login@example.com',
            password: hashed,
            name: 'Login User',
            role: 'user',
            isActive: true,
            isEmailVerified: true,
            createdAt: now,
            lastLoginAt: null,
        });
        mockedPrisma.user.update.mockResolvedValue({});
        mockedPrisma.refreshToken.create.mockResolvedValue({ id: 'rt_login_1' });

        const result = await authService.loginUser({
            email: 'login@example.com',
            password: 'CorrectPass123!',
        });

        expect(result.user.id).toBe('user_login_1');
        expect(result.tokens.accessToken).toEqual(expect.any(String));
        expect(result.tokens.refreshToken).toEqual(expect.any(String));
        expect(mockedPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'user_login_1' },
                data: { lastLoginAt: expect.any(Date) },
            })
        );
    });

    it('fails login with incorrect password', async () => {
        const hashed = await bcrypt.hash('CorrectPass123!', 4);

        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'user_login_2',
            email: 'login2@example.com',
            password: hashed,
            name: 'Login User 2',
            role: 'user',
            isActive: true,
            isEmailVerified: true,
            createdAt: new Date('2026-02-24T10:20:00.000Z'),
            lastLoginAt: null,
        });

        await expect(
            authService.loginUser({
                email: 'login2@example.com',
                password: 'WrongPass!123',
            })
        ).rejects.toThrow('Invalid email or password');

        expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('generates and verifies JWT access token', () => {
        const token = authService.generateAccessToken('user_jwt_1', 'jwt@example.com');
        const payload = authService.verifyAccessToken(token);

        expect(payload.userId).toBe('user_jwt_1');
        expect(payload.email).toBe('jwt@example.com');
        expect(payload.iat).toBeDefined();
        expect(payload.exp).toBeDefined();
    });

    it('generates password reset token and stores it', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'user_reset_1',
            email: 'reset@example.com',
        });
        mockedPrisma.user.update.mockResolvedValue({ id: 'user_reset_1' });

        const token = await authService.generatePasswordResetToken('reset@example.com');

        expect(token).toEqual(expect.any(String));
        expect(token?.length).toBeGreaterThan(10);
        expect(mockedPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'user_reset_1' },
                data: expect.objectContaining({
                    passwordResetToken: token,
                    passwordResetExpiry: expect.any(Date),
                }),
            })
        );
    });
});
