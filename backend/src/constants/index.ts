/**
 * Application Constants
 * Centralizes magic numbers and strings into named constants
 */

/** Cache TTLs in seconds */
export const CACHE_TTL = {
    /** Short-lived: listings that change frequently (2 min) */
    SHORT: 120,
    /** Medium: dashboards, aggregations (5 min) */
    MEDIUM: 300,
    /** Long: reference data, profiles (15 min) */
    LONG: 900,
    /** Very long: static config, enums (1 hour) */
    STATIC: 3600,
} as const;

/** Pagination defaults */
export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
} as const;

/** Rate limit presets (requests per window) */
export const RATE_LIMITS = {
    AUTH: { windowMs: 15 * 60 * 1000, max: 5 },
    API: { windowMs: 15 * 60 * 1000, max: 100 },
    FILE_UPLOAD: { windowMs: 15 * 60 * 1000, max: 10 },
} as const;

/** Meeting status transitions (valid next states) */
export const MEETING_STATUS_TRANSITIONS: Record<string, string[]> = {
    scheduled: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
};

/** Task status transitions */
export const TASK_STATUS_TRANSITIONS: Record<string, string[]> = {
    pending: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'pending'],
    completed: [],
    cancelled: ['pending'],
};

/** File upload limits */
export const FILE_LIMITS = {
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100 MB
    MAX_RECORDING_SIZE: 500 * 1024 * 1024, // 500 MB
    MAX_FILES_PER_REQUEST: 5,
    ALLOWED_FILE_TYPES: ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.mp3', '.mp4', '.wav', '.m4a'],
    ALLOWED_AUDIO_TYPES: ['.mp3', '.wav', '.m4a', '.webm', '.ogg'],
} as const;

/** Token expiration settings */
export const TOKEN_EXPIRY = {
    ACCESS_TOKEN_MINUTES: 15,
    REFRESH_TOKEN_DAYS: 7,
    PASSWORD_RESET_HOURS: 1,
    EMAIL_VERIFICATION_HOURS: 24,
} as const;

/** Redis key prefixes for namespacing */
export const REDIS_KEYS = {
    BLACKLIST: 'blacklist',
    CACHE: 'cache',
    RATE_LIMIT: 'rl',
    SESSION: 'session',
    NOTIFICATION: 'notification',
    REMINDER: 'reminder',
    EMAIL_STATUS: 'email_status',
} as const;
