'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import type { ApiResponse } from './api/core';

/**
 * Thin wrapper around SWR for our `ApiResponse<T>` shape.
 *
 * Each domain endpoint returns `{ success, data, error, statusCode }` instead of
 * throwing. This adapter unwraps the success path into `data`, throws the error
 * for SWR's `error` channel, and lets the caller pass a stable cache key.
 *
 * Example:
 *   const { data, error, isLoading, mutate } = useApiQuery('exams', () => getExams());
 */
export function useApiQuery<T>(
    key: string | null,
    fetcher: () => Promise<ApiResponse<T>>,
    options?: SWRConfiguration<T>,
) {
    return useSWR<T>(
        key,
        async () => {
            const result = await fetcher();
            if (!result.success || !result.data) {
                throw new Error(result.error || 'Request failed');
            }
            return result.data;
        },
        {
            // Reasonable defaults: dedupe identical requests within 5s, don't
            // poll, but do refetch when the user comes back to the tab.
            dedupingInterval: 5000,
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            shouldRetryOnError: false,
            ...options,
        },
    );
}
