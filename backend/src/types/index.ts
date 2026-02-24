/**
 * Shared Backend Types
 * Centralizes TypeScript interfaces used across the application
 */

/** Standard paginated query parameters */
export interface PaginationParams {
    page: number;
    limit: number;
    skip: number;
}

/** Standard pagination metadata in responses */
export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
}

/** Standard API success response envelope */
export interface ApiResponse<T = unknown> {
    success: true;
    message?: string;
    data: T;
    pagination?: PaginationMeta;
}

/** Standard API error response envelope */
export interface ApiErrorResponse {
    success: false;
    error: string;
    message: string;
    code?: string;
    details?: unknown;
    timestamp: string;
}

/** Meeting status enum values */
export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

/** Task status enum values */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** Task priority enum values */
export type TaskPriority = 'low' | 'medium' | 'high';

/** Workspace member roles */
export type WorkspaceRole = 'admin' | 'member';

/** User roles */
export type UserRole = 'admin' | 'user';

/**
 * Helper: Build PaginationMeta from query result
 */
export function buildPaginationMeta(
    page: number,
    limit: number,
    total: number
): PaginationMeta {
    const totalPages = Math.ceil(total / limit);
    return {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
    };
}

/**
 * Helper: Parse and clamp pagination query params
 */
export function parsePagination(
    rawPage?: string | number,
    rawLimit?: string | number,
    maxLimit = 100
): PaginationParams {
    const page = Math.max(Number(rawPage) || 1, 1);
    const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), maxLimit);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}
