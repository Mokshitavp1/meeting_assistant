import rateLimit from 'express-rate-limit';

/**
 * Rate Limiting Configuration
 * Extracted to its own module to avoid circular dependencies.
 */
const createRateLimiter = (windowMs: number, max: number, message: string) => {
    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => process.env.RATE_LIMIT_ENABLED !== 'true',
    });
};

// Global rate limiter
export const globalLimiter = createRateLimiter(
    parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000,
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    'Too many requests from this IP, please try again later'
);

// Auth rate limiter (stricter for login/registration)
export const authLimiter = createRateLimiter(
    parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000,
    parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5'),
    'Too many authentication attempts, please try again later'
);
