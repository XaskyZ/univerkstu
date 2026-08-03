import { describe, it, expect } from 'vitest';
import { toPgDoc } from './platonus-grades.js';
import type { GradesData } from '../types/grades.js';

describe('toPgDoc', () => {
    // Row→typed-PlatonusGradesCacheDoc mapper. Year + semester come as separate
    // columns (composite cache key with user_id), data_json carries the full
    // grades blob, and cached_at/expires_at are TTL timestamps.

    const rawData: GradesData = {
        success: true,
        subjects: [],
        meta: {
            year: 2026,
            semester: 1,
            parsedAt: '2026-05-13T00:00:00Z',
            login: 'student_login',
        },
    } as unknown as GradesData;

    it('maps year + semester columns to top-level fields', () => {
        const result = toPgDoc({
            user_id: 'user123',
            year: 2026,
            semester: 1,
            data_json: rawData,
            cached_at: new Date('2026-05-13T10:00:00.000Z'),
            expires_at: new Date('2026-05-14T10:00:00.000Z'),
        });
        expect(result.year).toBe(2026);
        expect(result.semester).toBe(1);
    });

    it('maps user_id → userId', () => {
        const result = toPgDoc({
            user_id: 'real-user',
            year: 2026,
            semester: 1,
            data_json: rawData,
            cached_at: new Date(),
            expires_at: new Date(),
        });
        expect(result.userId).toBe('real-user');
    });

    it('forwards data_json as `data` (renamed field)', () => {
        // Important: column is `data_json`, output field is `data` — locks in
        // the rename, which downstream code depends on.
        const result = toPgDoc({
            user_id: 'u',
            year: 2026,
            semester: 1,
            data_json: rawData,
            cached_at: new Date(),
            expires_at: new Date(),
        });
        expect(result.data).toBe(rawData);
    });

    it('wraps cached_at + expires_at as Date instances', () => {
        const cachedAt = new Date('2026-05-13T10:00:00.000Z');
        const expiresAt = new Date('2026-05-13T22:00:00.000Z');
        const result = toPgDoc({
            user_id: 'u',
            year: 2026,
            semester: 1,
            data_json: rawData,
            cached_at: cachedAt,
            expires_at: expiresAt,
        });
        expect(result.cachedAt).toBeInstanceOf(Date);
        expect(result.expiresAt).toBeInstanceOf(Date);
        expect(result.cachedAt.toISOString()).toBe(cachedAt.toISOString());
        expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    });

    it('preserves the composite key (userId + year + semester) verbatim', () => {
        // The cache key in Postgres is (user_id, year, semester). Tests that all
        // 3 round-trip correctly so a regression doesn't accidentally swap them.
        const result = toPgDoc({
            user_id: 'student-001',
            year: 2024,
            semester: 2,
            data_json: rawData,
            cached_at: new Date(),
            expires_at: new Date(),
        });
        expect(result.userId).toBe('student-001');
        expect(result.year).toBe(2024);
        expect(result.semester).toBe(2);
    });
});
