'use client';

import type { Lesson, TimeSlot } from './types';

const STORAGE_PREFIX = 'schedule-notes:';

function getStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`;
}

function normalizePart(value: string | null | undefined): string {
    return (value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, 200);
}

export function buildScheduleLessonNoteKey(params: {
    dayKey: string;
    slot: TimeSlot;
    lesson: Lesson;
    lessonIndex: number;
}): string {
    const customId = params.lesson.rawParams?.startsWith('__custom__:') ? params.lesson.rawParams.slice(11) : '';
    return [
        params.dayKey,
        `${params.slot.start}-${params.slot.end}`,
        String(params.lessonIndex),
        params.lesson.parity,
        normalizePart(params.lesson.title),
        normalizePart(params.lesson.teacherName || params.lesson.teacher),
        normalizePart(params.lesson.room),
        normalizePart(customId),
    ].join('|');
}

export function getScheduleNotes(userId: string): Record<string, string> {
    if (typeof window === 'undefined' || !userId) return {};
    try {
        const raw = window.localStorage.getItem(getStorageKey(userId));
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (!parsed || typeof parsed !== 'object') return {};
        return Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
        );
    } catch {
        return {};
    }
}

function writeScheduleNotes(userId: string, notes: Record<string, string>) {
    if (typeof window === 'undefined' || !userId) return;
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(notes));
}

export function saveScheduleNote(userId: string, noteKey: string, value: string): Record<string, string> {
    const trimmed = value.trim();
    const current = getScheduleNotes(userId);
    if (!trimmed) {
        delete current[noteKey];
    } else {
        current[noteKey] = trimmed.slice(0, 500);
    }
    writeScheduleNotes(userId, current);
    return current;
}

export function removeScheduleNote(userId: string, noteKey: string): Record<string, string> {
    const current = getScheduleNotes(userId);
    delete current[noteKey];
    writeScheduleNotes(userId, current);
    return current;
}
