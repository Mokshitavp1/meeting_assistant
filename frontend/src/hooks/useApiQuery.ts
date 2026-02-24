import { useQuery, useMutation, useQueryClient, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';
import apiClient from '../api/axios.config';
import type { AxiosError } from 'axios';
import toast from 'react-hot-toast';

/**
 * Reusable API hooks built on React Query
 * Provides consistent error handling, caching, and optimistic updates
 */

type ApiEnvelope<T> = { success: boolean; data: T; message?: string };

/** Query key factory — ensures consistent cache keys */
export const queryKeys = {
    meetings: {
        all: ['meetings'] as const,
        list: (params?: Record<string, string>) => ['meetings', 'list', params] as const,
        detail: (id: string) => ['meetings', 'detail', id] as const,
    },
    tasks: {
        all: ['tasks'] as const,
        list: (params?: Record<string, string>) => ['tasks', 'list', params] as const,
        detail: (id: string) => ['tasks', 'detail', id] as const,
        my: (params?: Record<string, string>) => ['tasks', 'my', params] as const,
    },
    workspaces: {
        all: ['workspaces'] as const,
        list: () => ['workspaces', 'list'] as const,
        detail: (id: string) => ['workspaces', 'detail', id] as const,
        members: (id: string) => ['workspaces', 'members', id] as const,
    },
    user: {
        me: ['user', 'me'] as const,
    },
} as const;

/**
 * Generic GET hook
 */
export function useApiGet<T>(
    queryKey: readonly unknown[],
    url: string,
    options?: Omit<UseQueryOptions<T, AxiosError>, 'queryKey' | 'queryFn'>
) {
    return useQuery<T, AxiosError>({
        queryKey,
        queryFn: async () => {
            const { data } = await apiClient.get<ApiEnvelope<T>>(url);
            return data.data;
        },
        ...options,
    });
}

/**
 * Generic POST/PUT/DELETE mutation hook
 */
export function useApiMutation<TData, TVariables>(
    method: 'post' | 'put' | 'patch' | 'delete',
    url: string | ((vars: TVariables) => string),
    options?: UseMutationOptions<TData, AxiosError, TVariables> & {
        /** Query keys to invalidate on success */
        invalidateKeys?: readonly unknown[][];
        /** Success toast message */
        successMessage?: string;
    }
) {
    const queryClient = useQueryClient();

    return useMutation<TData, AxiosError, TVariables>({
        mutationFn: async (variables) => {
            const resolvedUrl = typeof url === 'function' ? url(variables) : url;
            const { data } = method === 'delete'
                ? await apiClient.delete<ApiEnvelope<TData>>(resolvedUrl)
                : await apiClient[method]<ApiEnvelope<TData>>(resolvedUrl, variables);
            return data.data;
        },
        onSuccess: (...args) => {
            // Invalidate related caches
            if (options?.invalidateKeys) {
                options.invalidateKeys.forEach((key) => {
                    queryClient.invalidateQueries({ queryKey: key });
                });
            }
            if (options?.successMessage) {
                toast.success(options.successMessage);
            }
            options?.onSuccess?.(...args);
        },
        onError: (error, ...rest) => {
            const message =
                (error.response?.data as { message?: string })?.message ||
                error.message ||
                'Something went wrong';
            toast.error(message);
            options?.onError?.(error, ...rest);
        },
        ...options,
    });
}

export default { queryKeys, useApiGet, useApiMutation };
