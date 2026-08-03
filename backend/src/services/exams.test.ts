import { describe, it, expect } from 'vitest';
import { toPgExams } from './exams.js';
import type { Exams } from '../types/index.js';

describe('toPgExams', () => {
    // Converts a postgres row into a typed Exams object. Mutates dates from
    // serialized JSON strings to real Date instances and grafts the user_id
    // onto both the top-level and meta.

    const rawData: Exams = {
        userId: 'unused',
        exams: [],
        meta: {
            parsedAt: '2026-05-13T00:00:00Z',
            totalExams: 0,
            userId: 'unused-meta',
        } as Exams['meta'],
        cachedAt: new Date('1970-01-01'),
        expiresAt: new Date('1970-01-01'),
    };

    it('grafts user_id onto top-level userId field', () => {
        const result = toPgExams({
            user_id: 'real-user',
            data_json: rawData,
            cached_at: new Date('2026-05-13'),
            expires_at: new Date('2026-05-14'),
        });
        expect(result.userId).toBe('real-user');
    });

    it('grafts user_id onto meta.userId (overrides whatever was in data_json)', () => {
        // Important: the row's user_id is authoritative — never trust data_json.
        // A regression that drops the meta override could leak one user's userId
        // into another user's cached blob if rows got cross-wired.
        const result = toPgExams({
            user_id: 'real-user',
            data_json: rawData,
            cached_at: new Date('2026-05-13'),
            expires_at: new Date('2026-05-14'),
        });
        expect(result.meta.userId).toBe('real-user');
    });

    it('wraps cached_at/expires_at as Date instances (not raw strings)', () => {
        const cachedAt = new Date('2026-05-13T10:00:00Z');
        const expiresAt = new Date('2026-05-13T22:00:00Z');
        const result = toPgExams({
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

    it('forwards exams + meta verbatim (apart from userId override)', () => {
        const exams: Exams['exams'] = [
            {
                subject: 'Math',
                teacher: 'Иванов',
                type: '',
                format: '',
                building: '',
                room: '',
                locationRaw: '',
                groupType: '',
                datetime: null,
            },
        ];
        const result = toPgExams({
            user_id: 'u',
            data_json: { ...rawData, exams },
            cached_at: new Date(),
            expires_at: new Date(),
        });
        expect(result.exams).toEqual(exams);
        expect(result.meta.parsedAt).toBe('2026-05-13T00:00:00Z');
        expect(result.meta.totalExams).toBe(0);
    });
});
