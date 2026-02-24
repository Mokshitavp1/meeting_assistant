export type ID = string;

export type ISODateString = string;

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    meta: PaginationMeta;
}

export interface ApiError {
    message: string;
    statusCode?: number;
    details?: unknown;
}

export interface ApiResponse<T> {
    data: T;
    message?: string;
}
