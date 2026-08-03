import { describe, it, expect } from 'vitest';
import { getUmkdPeriodOverrides } from './umkd.js';
import type { AcademicContextResponse } from '../services/academic-context.js';

const ctx = (overrides: Partial<AcademicContextResponse>): AcademicContextResponse => ({
    source: 'univer_academic_calendar',
    userId: 'u1',
    formOfEducation: null,
    educationLevel: null,
    specialty: null,
    totalSemesters: 8,
    admissionYear: 2024,
    currentSemesterNumber: 1,
    currentSemesterLabel: null,
    semesterStart: '2026-09-01',
    semesterEnd: '2027-01-15',
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
});

describe('getUmkdPeriodOverrides', () => {
    // Resolves the UMKD page's `year`/`semester` query parameters from the user's
    // academic context. Critical: this is the **only** signal that tells KSTU's
    // UMKD endpoint WHICH semester's course list to return.
    //
    // Mapping (semester number → KSTU "semester" param):
    //   - odd semester (1, 3, 5, 7)  → "1" (fall)
    //   - even semester (2, 4, 6, 8) → "2" (spring)
    //
    // Academic year resolution:
    //   - For fall semesters, year = semesterStart.getFullYear()
    //   - For spring semesters, year = semesterStart.getFullYear() - 1
    //     (because a spring semester is in calendar year N+1 of academic year N)

    it('returns {} when context is null', () => {
        expect(getUmkdPeriodOverrides(null)).toEqual({});
    });

    it('returns {} when semesterStart is missing', () => {
        expect(getUmkdPeriodOverrides(ctx({ semesterStart: null }))).toEqual({});
    });

    it('returns {} when currentSemesterNumber is missing', () => {
        expect(getUmkdPeriodOverrides(ctx({ currentSemesterNumber: null }))).toEqual({});
    });

    it('returns {} when semesterStart is unparseable', () => {
        expect(getUmkdPeriodOverrides(ctx({ semesterStart: 'not a date' }))).toEqual({});
    });

    it('semester 1 (fall, 1st-year start) → year=2026, semester="1"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 1,
            semesterStart: '2026-09-01',
        }));
        expect(result).toEqual({ year: '2026', semester: '1' });
    });

    it('semester 2 (spring of 1st year) → year=2026, semester="2" (year is academic-year-start, not calendar)', () => {
        // A 1st-year student in spring 2027 has academic year "2026" (Sept 2026 to June 2027).
        // The function subtracts 1 from semesterStart's calendar year because the spring
        // semester runs in calendar year N+1 of the academic year.
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 2,
            semesterStart: '2027-02-01',
        }));
        expect(result).toEqual({ year: '2026', semester: '2' });
    });

    it('semester 3 (fall, 2nd-year) → year=2027, semester="1"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 3,
            semesterStart: '2027-09-01',
        }));
        expect(result).toEqual({ year: '2027', semester: '1' });
    });

    it('semester 4 (spring, 2nd-year) → year=2027, semester="2"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 4,
            semesterStart: '2028-02-01',
        }));
        expect(result).toEqual({ year: '2027', semester: '2' });
    });

    it('semester 8 (graduating senior) → year=2030, semester="2"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 8,
            semesterStart: '2031-02-01',
        }));
        expect(result).toEqual({ year: '2030', semester: '2' });
    });

    it('locks in the odd→fall (sem "1") / even→spring (sem "2") mapping across all 8 semesters', () => {
        // Regression guard. Flipping the modulo check would invert every student's
        // UMKD view and they'd silently see the wrong course list.
        for (let n = 1; n <= 8; n += 1) {
            const result = getUmkdPeriodOverrides(ctx({
                currentSemesterNumber: n,
                semesterStart: n % 2 === 1 ? '2026-09-01' : '2027-02-01',
            }));
            expect(result.semester).toBe(n % 2 === 1 ? '1' : '2');
        }
    });
});
