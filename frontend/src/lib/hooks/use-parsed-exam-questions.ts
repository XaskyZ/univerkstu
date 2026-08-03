'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    fetchParsedExamQuestions,
    type ParsedExamQuestionsResponse,
} from '@/lib/api/umkd-parsed';

/**
 * SWR-style hook for `fetchParsedExamQuestions`.
 *
 * Caches successful payloads in `sessionStorage` under
 * `umkd_parsed_${fileId}` so a re-mount within the same tab paints
 * immediately while a background refetch revalidates. Failures are surfaced
 * via `status: 'fail'` and never throw.
 */

const CACHE_PREFIX = 'umkd_parsed_';

export type UseParsedExamQuestionsStatus = 'idle' | 'loading' | 'ok' | 'fail';

export interface UseParsedExamQuestionsResult {
    status: UseParsedExamQuestionsStatus;
    data: ParsedExamQuestionsResponse | null;
    refetch: () => void;
}

interface HookState {
    fileId: string | null;
    status: UseParsedExamQuestionsStatus;
    data: ParsedExamQuestionsResponse | null;
}

function readCache(fileId: string): ParsedExamQuestionsResponse | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${fileId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ParsedExamQuestionsResponse;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.questions)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeCache(fileId: string, value: ParsedExamQuestionsResponse): void {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(`${CACHE_PREFIX}${fileId}`, JSON.stringify(value));
    } catch {
        // Quota / private-mode → ignore; cache is best-effort.
    }
}

function deriveInitialState(fileId: string | null): HookState {
    if (!fileId) return { fileId: null, status: 'idle', data: null };
    const cached = readCache(fileId);
    return cached
        ? { fileId, status: 'ok', data: cached }
        : { fileId, status: 'loading', data: null };
}

export function useParsedExamQuestions(fileId: string | null): UseParsedExamQuestionsResult {
    const [state, setState] = useState<HookState>(() => deriveInitialState(fileId));

    // Force-refetch counter — incrementing `refetch()` re-runs the network call
    // without changing the visible status.
    const [refetchTick, setRefetchTick] = useState(0);

    // Detect the case where the consumer just switched files: surface the new
    // file's cached snapshot (or `loading`) during render instead of waiting
    // for the effect, which would otherwise need a forbidden in-effect setState.
    if (state.fileId !== fileId) {
        setState(deriveInitialState(fileId));
    }

    // Track the active id so a late-resolving promise can't overwrite state
    // for a different file the caller has since switched to. We update the
    // ref inside an effect (refs must not be mutated during render).
    const activeFileIdRef = useRef<string | null>(fileId);
    useEffect(() => {
        activeFileIdRef.current = fileId;
    }, [fileId]);

    useEffect(() => {
        if (!fileId) {
            // Make sure a stale id doesn't keep accepting late responses
            // after the consumer switched to `null`.
            activeFileIdRef.current = null;
            return;
        }
        activeFileIdRef.current = fileId;

        let cancelled = false;
        (async () => {
            try {
                const response = await fetchParsedExamQuestions(fileId);
                if (cancelled || activeFileIdRef.current !== fileId) return;
                // Only cache successful payloads — failed ones might recover
                // after the backend deploys.
                if (response.ok) {
                    writeCache(fileId, response);
                }
                setState({
                    fileId,
                    data: response,
                    status: response.ok ? 'ok' : 'fail',
                });
            } catch {
                if (cancelled || activeFileIdRef.current !== fileId) return;
                setState((prev) => (prev.fileId === fileId
                    ? { ...prev, status: 'fail' }
                    : prev));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [fileId, refetchTick]);

    const refetch = useCallback(() => {
        setRefetchTick((t) => t + 1);
    }, []);

    return { status: state.status, data: state.data, refetch };
}
