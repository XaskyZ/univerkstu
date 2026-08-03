import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    extractSemesterValue,
    extractTermLabel,
    extractYearValue,
    getCurrentAcademicPeriod,
    normalizeArrayPayload,
    getPlatonusErrorSummary,
    getSessionHeaders,
    type PlatonusSession,
} from './platonus-client.js';

describe('extractYearValue', () => {
    it('returns sane numeric years as-is', () => {
        expect(extractYearValue(2025)).toBe(2025);
        expect(extractYearValue(2099)).toBe(2099);
    });

    it('rejects out-of-range numbers', () => {
        expect(extractYearValue(1999)).toBeNull();
        expect(extractYearValue(2101)).toBeNull();
    });

    it('parses 20xx out of strings', () => {
        expect(extractYearValue('2025/2026')).toBe(2025);
        expect(extractYearValue('Курс 2024-2025')).toBe(2024);
    });

    it('falls back to nested object fields', () => {
        expect(extractYearValue({ year: 2026 })).toBe(2026);
        expect(extractYearValue({ studyYear: '2024' })).toBe(2024);
        expect(extractYearValue({ ID: 2023 })).toBe(2023);
    });

    it('returns null when nothing usable', () => {
        expect(extractYearValue(null)).toBeNull();
        expect(extractYearValue('no year here')).toBeNull();
        expect(extractYearValue({})).toBeNull();
    });
});

describe('extractSemesterValue', () => {
    it('returns 1 or 2 numeric values directly', () => {
        expect(extractSemesterValue(1)).toBe(1);
        expect(extractSemesterValue(2)).toBe(2);
    });

    it('rejects other numbers', () => {
        expect(extractSemesterValue(3)).toBeNull();
        expect(extractSemesterValue(0)).toBeNull();
    });

    it('parses "1" and "2" strings', () => {
        expect(extractSemesterValue('1')).toBe(1);
        expect(extractSemesterValue('2')).toBe(2);
    });

    it('detects осенний/весенний keywords', () => {
        expect(extractSemesterValue('Осенний семестр')).toBe(1);
        expect(extractSemesterValue('весенний')).toBe(2);
    });

    it('walks nested object candidates', () => {
        expect(extractSemesterValue({ semester: 1 })).toBe(1);
        expect(extractSemesterValue({ ID: 2 })).toBe(2);
        expect(extractSemesterValue({ name: 'Весенний' })).toBe(2);
    });

    it('returns null when no match', () => {
        expect(extractSemesterValue('summer')).toBeNull();
        expect(extractSemesterValue({ foo: 'bar' })).toBeNull();
    });
});

describe('extractTermLabel', () => {
    it('reads label from object fields', () => {
        expect(extractTermLabel({ name: 'Осенний 2025' }, 1)).toBe('Осенний 2025');
        expect(extractTermLabel({ label: 'Spring' }, 2)).toBe('Spring');
        expect(extractTermLabel({ title: 'Term I' }, 1)).toBe('Term I');
    });

    it('falls back to default Russian label by semester', () => {
        expect(extractTermLabel(null, 1)).toBe('Осенний');
        expect(extractTermLabel(null, 2)).toBe('Весенний');
        expect(extractTermLabel({}, 1)).toBe('Осенний');
    });

    it('ignores empty/whitespace labels', () => {
        expect(extractTermLabel({ name: '   ' }, 1)).toBe('Осенний');
    });
});

describe('normalizeArrayPayload', () => {
    it('returns the input when it is already an array', () => {
        expect(normalizeArrayPayload([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('finds the first nested array in an object', () => {
        expect(normalizeArrayPayload({ data: [1, 2], meta: 'x' })).toEqual([1, 2]);
        expect(normalizeArrayPayload({ ok: true, items: ['a', 'b'] })).toEqual(['a', 'b']);
    });

    it('returns empty array when nothing array-like', () => {
        expect(normalizeArrayPayload(null)).toEqual([]);
        expect(normalizeArrayPayload({})).toEqual([]);
        expect(normalizeArrayPayload('string')).toEqual([]);
    });
});

describe('getCurrentAcademicPeriod', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('Sep-Nov → autumn semester of current year', () => {
        vi.setSystemTime(new Date('2025-09-15'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
        vi.setSystemTime(new Date('2025-11-30'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
    });

    it('Feb-Jun → spring semester of previous calendar year', () => {
        vi.setSystemTime(new Date('2026-02-01'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 2 });
        vi.setSystemTime(new Date('2026-06-30'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 2 });
    });

    it('December → still autumn semester (winter exam session), current year', () => {
        // Декабрь — конец теории и зимняя сессия ОСЕННЕГО семестра, не каникулы.
        vi.setSystemTime(new Date('2025-12-15'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
        vi.setSystemTime(new Date('2025-12-31'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
    });

    it('January → autumn semester tail (session/итоги), previous calendar year', () => {
        vi.setSystemTime(new Date('2026-01-15'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
        vi.setSystemTime(new Date('2026-01-31'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
    });

    it('July-August → summer break, show upcoming autumn semester', () => {
        vi.setSystemTime(new Date('2025-07-15'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
        vi.setSystemTime(new Date('2025-08-31'));
        expect(getCurrentAcademicPeriod()).toEqual({ year: 2025, semester: 1 });
    });
});

describe('getPlatonusErrorSummary', () => {
    // Used by `logPlatonusRequestError` to choose console.warn (401, silenced)
    // vs console.error (everything else). Wrong status detection → spam in error logs.

    it('Axios-shaped error with response.status + statusText', () => {
        // Construct an Axios-compatible error shape without making a real HTTP call.
        const err = Object.assign(new Error('Request failed with status code 401'), {
            isAxiosError: true,
            response: { status: 401, statusText: 'Unauthorized' },
        });
        // axios.isAxiosError checks for `isAxiosError === true`.
        const result = getPlatonusErrorSummary(err);
        expect(result.status).toBe(401);
        expect(result.message).toBe('HTTP 401: Unauthorized');
    });

    it('Axios-shaped error with response but no statusText falls back to error.message', () => {
        const err = Object.assign(new Error('Network unreachable'), {
            isAxiosError: true,
            response: { status: 500, statusText: '' },
        });
        const result = getPlatonusErrorSummary(err);
        expect(result.status).toBe(500);
        expect(result.message).toBe('Network unreachable');
    });

    it('Axios-shaped error with no response (no network reach) → null status, error.message', () => {
        const err = Object.assign(new Error('ECONNREFUSED'), {
            isAxiosError: true,
            response: undefined,
        });
        const result = getPlatonusErrorSummary(err);
        expect(result.status).toBe(null);
        expect(result.message).toBe('ECONNREFUSED');
    });

    it('Axios-shaped error with no message anywhere → fallback string', () => {
        const err = Object.assign(new Error(''), {
            isAxiosError: true,
            response: undefined,
        });
        const result = getPlatonusErrorSummary(err);
        expect(result.message).toBe('Axios request failed');
    });

    it('plain Error → null status + message', () => {
        const err = new Error('Something went wrong');
        const result = getPlatonusErrorSummary(err);
        expect(result.status).toBe(null);
        expect(result.message).toBe('Something went wrong');
    });

    it('non-Error inputs → null status + String() coercion', () => {
        expect(getPlatonusErrorSummary('plain string')).toEqual({ status: null, message: 'plain string' });
        expect(getPlatonusErrorSummary(42)).toEqual({ status: null, message: '42' });
        expect(getPlatonusErrorSummary(null)).toEqual({ status: null, message: 'null' });
        expect(getPlatonusErrorSummary(undefined)).toEqual({ status: null, message: 'undefined' });
    });

    it('object without isAxiosError marker is treated as non-Error', () => {
        // Defense: a plain object with `response.status` should NOT be misclassified
        // as an Axios error. Only `isAxiosError === true` qualifies.
        const fake = { response: { status: 401, statusText: 'Forbidden' } };
        const result = getPlatonusErrorSummary(fake);
        // Falls through to String() coercion since it's not an Error instance.
        expect(result.status).toBe(null);
        expect(result.message).toBe('[object Object]');
    });
});

describe('getSessionHeaders', () => {
    // Builds the HTTP headers attached to every Platonus API call after login.

    const session: PlatonusSession = {
        token: 'eyJhbG...AUTHTOKEN',
        sid: 'sess123',
        personID: 'p987',
        cookieString: 'plt_sid=sess123; XSRF-TOKEN=abc',
    };

    it('includes token and sid as bespoke headers', () => {
        const result = getSessionHeaders(session);
        expect(result.token).toBe('eyJhbG...AUTHTOKEN');
        expect(result.sid).toBe('sess123');
    });

    it('uses session.cookieString verbatim when present', () => {
        const result = getSessionHeaders(session);
        expect(result.Cookie).toBe('plt_sid=sess123; XSRF-TOKEN=abc');
    });

    it('falls back to "plt_sid=<sid>" when cookieString missing', () => {
        const { cookieString: _unused, ...withoutCookie } = session;
        const result = getSessionHeaders(withoutCookie as PlatonusSession);
        expect(result.Cookie).toBe('plt_sid=sess123');
    });

    it('falls back to "plt_sid=<sid>" when cookieString is empty string', () => {
        // Empty string is falsy → fallback kicks in. Documents that we DON'T pass
        // an empty Cookie header to Platonus (would confuse some session servers).
        const result = getSessionHeaders({ ...session, cookieString: '' });
        expect(result.Cookie).toBe('plt_sid=sess123');
    });

    it('always sets the Accept header for JSON+text+wildcard', () => {
        expect(getSessionHeaders(session).Accept).toBe('application/json, text/plain, */*');
    });

    it('does NOT leak personID into headers (only token+sid+cookie are sent)', () => {
        // Privacy guard: personID is the internal user-id within Platonus and stays
        // in the session object only; it must never end up in outbound HTTP headers.
        const result = getSessionHeaders(session);
        const headerValues = Object.values(result).join('|');
        expect(headerValues).not.toContain('p987');
    });
});
