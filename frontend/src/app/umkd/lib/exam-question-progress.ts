'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { markReviewed as markFileReviewed } from './exam-progress';

/**
 * Local-only per-question progress tracker for parsed UMKD exam-question files.
 *
 * Stored under `umkd_exam_question_progress_v1` as:
 *   { [fileId]: { questions: { [qIndex]: { reviewedAt: ISO string } } } }
 *
 * Independent of `exam-progress.ts` (per-file checkmarks) — but when every
 * question of a file becomes reviewed, we ALSO mark the whole file as
 * reviewed so the legacy file-row UI stays in sync.
 */

export const EXAM_QUESTION_PROGRESS_STORAGE_KEY = 'umkd_exam_question_progress_v1';

export interface QuestionEntry {
    reviewedAt: string;
}

export interface FileQuestionEntry {
    questions: Record<string, QuestionEntry>;
}

export type ExamQuestionProgressMap = Record<string, FileQuestionEntry>;

function readStorage(): ExamQuestionProgressMap {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(EXAM_QUESTION_PROGRESS_STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const out: ExamQuestionProgressMap = {};
        for (const [fileId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!fileId) continue;
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const inner = (value as { questions?: unknown }).questions;
            if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
            const questions: Record<string, QuestionEntry> = {};
            for (const [qKey, qValue] of Object.entries(inner as Record<string, unknown>)) {
                if (!qKey) continue;
                if (
                    qValue
                    && typeof qValue === 'object'
                    && !Array.isArray(qValue)
                    && typeof (qValue as { reviewedAt?: unknown }).reviewedAt === 'string'
                ) {
                    questions[qKey] = { reviewedAt: (qValue as { reviewedAt: string }).reviewedAt };
                }
            }
            out[fileId] = { questions };
        }
        return out;
    } catch {
        return {};
    }
}

function writeStorage(map: ExamQuestionProgressMap): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(EXAM_QUESTION_PROGRESS_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Quota / private-mode — swallow; progress is best-effort.
    }
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
    for (const listener of listeners) {
        try {
            listener();
        } catch {
            // ignore listener errors
        }
    }
}

export function isQuestionReviewed(fileId: string, index: number): boolean {
    if (!fileId) return false;
    const map = readStorage();
    return Boolean(map[fileId]?.questions[String(index)]);
}

export function markQuestionReviewed(fileId: string, index: number): void {
    if (!fileId) return;
    const map = readStorage();
    const fileEntry: FileQuestionEntry = map[fileId] ?? { questions: {} };
    fileEntry.questions[String(index)] = { reviewedAt: new Date().toISOString() };
    map[fileId] = fileEntry;
    writeStorage(map);
    emit();
}

export function unmarkQuestionReviewed(fileId: string, index: number): void {
    if (!fileId) return;
    const map = readStorage();
    const fileEntry = map[fileId];
    if (!fileEntry) return;
    const key = String(index);
    if (!(key in fileEntry.questions)) return;
    delete fileEntry.questions[key];
    if (Object.keys(fileEntry.questions).length === 0) {
        delete map[fileId];
    } else {
        map[fileId] = fileEntry;
    }
    writeStorage(map);
    emit();
}

export function getFileQuestionProgress(
    fileId: string,
    totalQuestions: number,
): { done: number; total: number } {
    const total = Math.max(0, totalQuestions);
    if (!fileId || total === 0) return { done: 0, total };
    const map = readStorage();
    const entry = map[fileId];
    if (!entry) return { done: 0, total };
    const done = Object.keys(entry.questions).length;
    return { done: Math.min(done, total), total };
}

export interface UseFileQuestionProgressResult {
    reviewed: Record<number, boolean>;
    summary: { done: number; total: number };
    toggle: (index: number) => void;
}

export function useFileQuestionProgress(
    fileId: string,
    totalQuestions: number,
): UseFileQuestionProgressResult {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const onChange: Listener = () => setTick((t) => t + 1);
        listeners.add(onChange);
        const onStorage = (event: StorageEvent) => {
            if (event.key === EXAM_QUESTION_PROGRESS_STORAGE_KEY) onChange();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', onStorage);
        }
        return () => {
            listeners.delete(onChange);
            if (typeof window !== 'undefined') {
                window.removeEventListener('storage', onStorage);
            }
        };
    }, []);

    // Including `tick` forces re-derivation after any in-tab mutation; the
    // storage read inside happens fresh, so the listener-triggered re-render
    // surfaces the new state.
    const reviewed = useMemo<Record<number, boolean>>(() => {
        void tick;
        const map = readStorage();
        const entry = map[fileId];
        const out: Record<number, boolean> = {};
        if (!entry) return out;
        for (const key of Object.keys(entry.questions)) {
            const num = Number(key);
            if (Number.isFinite(num)) out[num] = true;
        }
        return out;
    }, [fileId, tick]);

    const summary = useMemo(() => {
        void tick;
        return getFileQuestionProgress(fileId, totalQuestions);
    }, [fileId, totalQuestions, tick]);

    const toggle = useCallback((index: number) => {
        if (!fileId) return;
        if (isQuestionReviewed(fileId, index)) {
            unmarkQuestionReviewed(fileId, index);
            return;
        }
        markQuestionReviewed(fileId, index);
        // Auto-completion side effect: when EVERY question is marked, also
        // mark the whole file reviewed via the legacy per-file API.
        if (totalQuestions > 0) {
            const after = getFileQuestionProgress(fileId, totalQuestions);
            if (after.done === after.total) {
                markFileReviewed(fileId);
            }
        }
    }, [fileId, totalQuestions]);

    return { reviewed, summary, toggle };
}
