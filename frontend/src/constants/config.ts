/**
 * Application-wide configuration constants
 */

export const APP_CONFIG = {
    APP_NAME: 'Meeting Assistant',
    APP_VERSION: '1.0.0',
    API_BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1',
    SOCKET_URL: import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000',
    /** Default page size for paginated lists */
    DEFAULT_PAGE_SIZE: 20,
    /** Max allowed page size */
    MAX_PAGE_SIZE: 100,
    /** Debounce delay for search inputs (ms) */
    SEARCH_DEBOUNCE_MS: 300,
    /** Toast auto-dismiss duration (ms) */
    TOAST_DURATION: 4000,
    /** Stale time for react-query caches (ms) */
    QUERY_STALE_TIME: 2 * 60 * 1000, // 2 minutes
} as const;

export const PRIORITY_COLORS: Record<string, string> = {
    HIGH: 'bg-red-100 text-red-700',
    MEDIUM: 'bg-amber-100 text-amber-700',
    LOW: 'bg-green-100 text-green-700',
};

export const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-slate-100 text-slate-600',
    TODO: 'bg-slate-100 text-slate-600',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    DONE: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-600',
    OVERDUE: 'bg-red-100 text-red-700',
};
