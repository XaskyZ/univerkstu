import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AcademicContext, PlatonusSemester } from './api';
import {
    getCachedAcademicContext,
    getCurrentAcademicSemesterFromContext,
    getCurrentAcademicSemesterFromDate,
    getPreferredPlatonusSemester,
} from './platonus-semesters';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
    key(index: number): string | null {
        return Array.from(this.store.keys())[index] ?? null;
    }
    get length() {
        return this.store.size;
    }
}

function makeContext(overrides: Partial<AcademicContext>): AcademicContext {
    return {
        source: 'platonus_calendar',
        userId: 'test-user',
        formOfEducation: null,
        educationLevel: null,
        specialty: null,
        totalSemesters: null,
        admissionYear: null,
        currentSemesterNumber: null,
        currentSemesterLabel: null,
        semesterStart: null,
        semesterEnd: null,
        semesterWeek: null,
        weekLabel: null,
        weekParity: null,
        activePeriodLabel: null,
        activePeriodKind: null,
        periods: [],
        semesters: [],
        cachedAt: '',
        expiresAt: '',
        ...overrides,
    };
}

function makeSemester(year: number, semester: number): PlatonusSemester {
    return { year, semester, label: `${year}/${year + 1} — sem ${semester}` };
}

// Semantics must mirror backend getCurrentAcademicPeriod (platonus-client.ts):
// Sep-Dec → autumn {Y,1}; Jan → autumn {Y-1,1}; Feb-Jun → spring {Y-1,2};
// Jul-Aug → upcoming autumn {Y,1}.
describe('getCurrentAcademicSemesterFromDate', () => {
    it('treats Feb-Jun as second semester of previous academic year', () => {
        const february = new Date(2025, 1, 1);
        expect(getCurrentAcademicSemesterFromDate(february)).toEqual({ year: 2024, semester: 2 });
        const march = new Date(2025, 2, 15);
        expect(getCurrentAcademicSemesterFromDate(march)).toEqual({ year: 2024, semester: 2 });
        const june = new Date(2025, 5, 30);
        expect(getCurrentAcademicSemesterFromDate(june)).toEqual({ year: 2024, semester: 2 });
    });

    it('treats July-August as the UPCOMING autumn semester (backend parity)', () => {
        const july = new Date(2025, 6, 15);
        expect(getCurrentAcademicSemesterFromDate(july)).toEqual({ year: 2025, semester: 1 });
        const august = new Date(2025, 7, 1);
        expect(getCurrentAcademicSemesterFromDate(august)).toEqual({ year: 2025, semester: 1 });
    });

    it('keeps autumn through September-December', () => {
        const september = new Date(2025, 8, 1);
        expect(getCurrentAcademicSemesterFromDate(september)).toEqual({ year: 2025, semester: 1 });
        const november = new Date(2025, 10, 30);
        expect(getCurrentAcademicSemesterFromDate(november)).toEqual({ year: 2025, semester: 1 });
        // December = winter exam session of the AUTUMN semester, not spring.
        const december = new Date(2025, 11, 25);
        expect(getCurrentAcademicSemesterFromDate(december)).toEqual({ year: 2025, semester: 1 });
    });

    it('January is still the autumn semester of the previous calendar year', () => {
        // Winter exam session tail — spring starts ~20 Jan, итоги ещё выставляют.
        const january = new Date(2026, 0, 15);
        expect(getCurrentAcademicSemesterFromDate(january)).toEqual({ year: 2025, semester: 1 });
    });

    it('uses the system clock when no argument is passed', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2025, 9, 1)); // October 2025
            expect(getCurrentAcademicSemesterFromDate()).toEqual({ year: 2025, semester: 1 });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('getCurrentAcademicSemesterFromContext', () => {
    it('returns null for missing or bogus context', () => {
        expect(getCurrentAcademicSemesterFromContext(null)).toBeNull();
        expect(getCurrentAcademicSemesterFromContext(undefined)).toBeNull();
        expect(getCurrentAcademicSemesterFromContext(makeContext({}))).toBeNull(); // admissionYear+semesterNumber null
    });

    it('returns null when admissionYear is unreasonably low', () => {
        const ctx = makeContext({ admissionYear: 1899, currentSemesterNumber: 1 });
        expect(getCurrentAcademicSemesterFromContext(ctx)).toBeNull();
    });

    it('returns null when semesterNumber is < 1', () => {
        const ctx = makeContext({ admissionYear: 2022, currentSemesterNumber: 0 });
        expect(getCurrentAcademicSemesterFromContext(ctx)).toBeNull();
    });

    it('maps semester 1 to the admission year, fall semester', () => {
        const ctx = makeContext({ admissionYear: 2022, currentSemesterNumber: 1 });
        expect(getCurrentAcademicSemesterFromContext(ctx)).toEqual({ year: 2022, semester: 1 });
    });

    it('maps semester 2 to the admission year, spring semester', () => {
        const ctx = makeContext({ admissionYear: 2022, currentSemesterNumber: 2 });
        expect(getCurrentAcademicSemesterFromContext(ctx)).toEqual({ year: 2022, semester: 2 });
    });

    it('maps semester 5 (3rd year fall) correctly', () => {
        // admissionYear 2022 + semester 5 → year 2024, semester 1
        const ctx = makeContext({ admissionYear: 2022, currentSemesterNumber: 5 });
        expect(getCurrentAcademicSemesterFromContext(ctx)).toEqual({ year: 2024, semester: 1 });
    });

    it('maps semester 8 (4th year spring) correctly', () => {
        // admissionYear 2022 + semester 8 → year 2025, semester 2
        const ctx = makeContext({ admissionYear: 2022, currentSemesterNumber: 8 });
        expect(getCurrentAcademicSemesterFromContext(ctx)).toEqual({ year: 2025, semester: 2 });
    });
});

describe('getPreferredPlatonusSemester', () => {
    const semesters = [
        makeSemester(2025, 1),
        makeSemester(2024, 2),
        makeSemester(2024, 1),
    ];

    it('picks the academic-context match when present', () => {
        const ctx = makeContext({ admissionYear: 2022, currentSemesterNumber: 7 }); // 2025/sem 1
        const result = getPreferredPlatonusSemester(semesters, ctx);
        expect(result.year).toBe(2025);
        expect(result.semester).toBe(1);
    });

    it('falls back to date-derived semester when context is null', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2025, 2, 1)); // March 2025 → 2024/sem 2
            const result = getPreferredPlatonusSemester(semesters, null);
            expect(result.year).toBe(2024);
            expect(result.semester).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back to the LATEST semester not after the preferred one (not blindly [0])', () => {
        vi.useFakeTimers();
        try {
            // Now points to a semester that's not in the list
            vi.setSystemTime(new Date(2030, 9, 1)); // Oct 2030 → 2030/sem 1
            const result = getPreferredPlatonusSemester(semesters, null);
            // Latest available ≤ preferred: 2025/sem 1.
            expect(result.year).toBe(2025);
            expect(result.semester).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('nearest-past fallback does not depend on list ordering', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2030, 9, 1)); // preferred 2030/sem 1, not in list
            // Список нарочно перемешан и начинается со СТАРОГО семестра —
            // раньше слепой `semesters[0]` вернул бы 2024/sem 1.
            const shuffled = [
                makeSemester(2024, 1),
                makeSemester(2025, 1),
                makeSemester(2024, 2),
            ];
            const result = getPreferredPlatonusSemester(shuffled, null);
            expect(result.year).toBe(2025);
            expect(result.semester).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('regression: autumn 2026 preferred vs outdated list ending at spring 2025/26 → picks spring, not [0] surprises', () => {
        vi.useFakeTimers();
        try {
            // Ровно наблюдённый баг: сентябрь 2026, список кончается на 2025/sem 2.
            vi.setSystemTime(new Date(2026, 8, 10)); // Sep 2026 → preferred 2026/sem 1
            const outdated = [
                makeSemester(2025, 2),
                makeSemester(2025, 1),
                makeSemester(2024, 2),
            ];
            const result = getPreferredPlatonusSemester(outdated, null);
            // Ближайший разумный ≤ текущего: весна 2025/26 — последний прошедший.
            expect(result.year).toBe(2025);
            expect(result.semester).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('picks the EARLIEST available semester when every list entry is in the future', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2020, 9, 1)); // Oct 2020 → preferred 2020/sem 1
            const result = getPreferredPlatonusSemester(semesters, null);
            expect(result.year).toBe(2024);
            expect(result.semester).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back gracefully when context has bogus admissionYear', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2025, 9, 1)); // Oct 2025 → 2025/sem 1
            const ctx = makeContext({ admissionYear: 1800, currentSemesterNumber: 3 });
            const result = getPreferredPlatonusSemester(semesters, ctx);
            // Should fall through to date-based — 2025/sem 1, found in list
            expect(result.year).toBe(2025);
            expect(result.semester).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('getCachedAcademicContext', () => {
    // Reads the cached academic context from localStorage via the cache helper.
    // Used by the bottom-nav exam-session check and other components that want
    // synchronous access to the user's academic period without an async fetch.

    beforeEach(() => {
        const storage = new MemoryStorage();
        vi.stubGlobal('window', { localStorage: storage });
        vi.stubGlobal('localStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns null when no cached context exists', () => {
        expect(getCachedAcademicContext()).toBe(null);
    });

    it('returns null when cache has unrelated data', () => {
        localStorage.setItem('some_other_key', JSON.stringify({ foo: 'bar' }));
        expect(getCachedAcademicContext()).toBe(null);
    });

    it('returns the cached context when present with correct version', () => {
        const ctx = makeContext({ admissionYear: 2024, currentSemesterNumber: 1 });
        // Match the cache.ts format: { data, timestamp, version: 'v1' }.
        localStorage.setItem('cache_academic_context', JSON.stringify({
            data: ctx,
            timestamp: Date.now(),
            version: 'v1',
        }));
        const result = getCachedAcademicContext();
        expect(result).not.toBe(null);
        expect(result!.admissionYear).toBe(2024);
        expect(result!.currentSemesterNumber).toBe(1);
    });

    it('returns null on corrupt JSON', () => {
        localStorage.setItem('cache_academic_context', 'not valid json{');
        expect(getCachedAcademicContext()).toBe(null);
    });

    it('ignores a context older than the 12h TTL (stale context must not beat the date)', () => {
        const ctx = makeContext({ admissionYear: 2024, currentSemesterNumber: 2 });
        localStorage.setItem('cache_academic_context', JSON.stringify({
            data: ctx,
            timestamp: Date.now() - 13 * 60 * 60 * 1000, // 13 hours old
            version: 'v1',
        }));
        expect(getCachedAcademicContext()).toBe(null);
    });

    it('still returns a context younger than the TTL', () => {
        const ctx = makeContext({ admissionYear: 2024, currentSemesterNumber: 2 });
        localStorage.setItem('cache_academic_context', JSON.stringify({
            data: ctx,
            timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours old
            version: 'v1',
        }));
        expect(getCachedAcademicContext()).not.toBe(null);
    });
});
