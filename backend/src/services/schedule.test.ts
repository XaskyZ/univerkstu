import { describe, it, expect } from 'vitest';
import { toPgSchedule } from './schedule.js';
import type { Schedule } from '../types/index.js';

describe('toPgSchedule', () => {
    // Converts a postgres row into a typed Schedule. Same shape as toPgExams —
    // grafts user_id onto top-level + meta, wraps date columns as Date instances.

    const rawData: Schedule = {
        userId: 'unused',
        meta: {
            tz: 'Asia/Almaty',
            parsedAt: '2026-05-13T00:00:00Z',
            userId: 'unused-meta',
        },
        timeSlots: [],
        days: [],
        cachedAt: new Date('1970-01-01'),
        expiresAt: new Date('1970-01-01'),
    };

    it('grafts user_id onto top-level userId field', () => {
        const result = toPgSchedule({
            user_id: 'real-user',
            data_json: rawData,
            cached_at: new Date('2026-05-13'),
            expires_at: new Date('2026-05-14'),
        });
        expect(result.userId).toBe('real-user');
    });

    it('grafts user_id onto meta.userId (overrides whatever was in data_json)', () => {
        // Identical safety guarantee to toPgExams — the row's user_id is authoritative.
        // Never trust data_json's embedded userId since rows could theoretically get
        // cross-wired (defensive even if the DB schema prevents it).
        const result = toPgSchedule({
            user_id: 'real-user',
            data_json: rawData,
            cached_at: new Date('2026-05-13'),
            expires_at: new Date('2026-05-14'),
        });
        expect(result.meta.userId).toBe('real-user');
    });

    it('preserves tz from meta (does NOT override)', () => {
        // Documents that meta.tz is forwarded verbatim — only userId is overridden.
        const result = toPgSchedule({
            user_id: 'u',
            data_json: { ...rawData, meta: { ...rawData.meta, tz: 'Europe/Moscow' } },
            cached_at: new Date(),
            expires_at: new Date(),
        });
        expect(result.meta.tz).toBe('Europe/Moscow');
    });

    it('wraps cached_at/expires_at as Date instances', () => {
        const cachedAt = new Date('2026-05-13T10:00:00Z');
        const expiresAt = new Date('2026-05-13T22:00:00Z');
        const result = toPgSchedule({
            user_id: 'u',
            data_json: rawData,
            cached_at: cachedAt,
            expires_at: expiresAt,
        });
        expect(result.cachedAt).toBeInstanceOf(Date);
        expect(result.expiresAt).toBeInstanceOf(Date);
        expect(result.cachedAt.toISOString()).toBe(cachedAt.toISOString());
        expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    });

    it('forwards timeSlots + days verbatim', () => {
        const timeSlots: Schedule['timeSlots'] = [{ index: 1, start: '08:00', end: '08:45' }];
        const days: Schedule['days'] = [{ dayIndex: 0, dayName: 'Понедельник', lessons: [] }];
        const result = toPgSchedule({
            user_id: 'u',
            data_json: { ...rawData, timeSlots, days },
            cached_at: new Date(),
            expires_at: new Date(),
        });
        expect(result.timeSlots).toEqual(timeSlots);
        expect(result.days).toEqual(days);
    });
});
