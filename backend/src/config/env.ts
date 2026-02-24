import { z } from 'zod';
import { config } from 'dotenv';

/**
 * Environment Variable Validation
 * Fails fast at startup if required vars are missing, with clear error messages
 */

config();

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('4000'),
    HOST: z.string().default('0.0.0.0'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.string().default('6379'),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_URL: z.string().optional(),

    // JWT (critical for auth)
    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
    JWT_ISSUER: z.string().default('ai-meeting-assistant'),
    JWT_AUDIENCE: z.string().default('api'),
    JWT_ACCESS_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_EXPIRATION: z.string().default('7d'),

    // CORS
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
    CORS_CREDENTIALS: z.string().default('true'),

    // Rate Limiting
    RATE_LIMIT_ENABLED: z.string().default('false'),
    RATE_LIMIT_WINDOW_MINUTES: z.string().default('15'),
    RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),

    // Storage (S3/R2 — optional, degrades gracefully)
    AWS_REGION: z.string().default('us-east-1'),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_S3_BUCKET: z.string().default('meeting-recordings'),

    // Email (optional)
    SENDGRID_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),

    // AI Services (optional)
    OPENAI_API_KEY: z.string().optional(),
    ASSEMBLYAI_API_KEY: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let validatedEnv: Env;

try {
    validatedEnv = envSchema.parse(process.env);
} catch (error) {
    if (error instanceof z.ZodError) {
        const missing = error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
        console.error(`\n❌ Environment validation failed:\n${missing}\n`);
        console.error('Check your .env file against .env.example\n');
    }
    process.exit(1);
}

export const env = validatedEnv;
export default env;
