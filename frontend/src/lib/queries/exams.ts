'use client';

import { getExams, refreshExams } from '@/lib/api';
import { useApiQuery } from '@/lib/swr';

/**
 * Example SWR-backed query for the exams endpoint.
 *
 * Replaces the manual `useState + useEffect + cache` plumbing in pages.
 * Other queries can be ported the same way: define a key + fetcher, return
 * the SWR result. Components just consume `data | error | isLoading`.
 *
 * Usage:
 *   const { data: exams, error, isLoading, refresh } = useExamsQuery();
 */
export function useExamsQuery() {
    const swr = useApiQuery('exams', () => getExams());

    return {
        ...swr,
        /** Force a server-side refresh that bypasses the backend cache. */
        refresh: async () => {
            const result = await refreshExams();
            if (result.success && result.data) {
                await swr.mutate(result.data, { revalidate: false });
            }
            return result;
        },
    };
}
