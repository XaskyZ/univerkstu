import { describe, it, expect } from 'vitest';
import {
    DEFAULT_OCCURRENCES_AHEAD,
    MAX_SERIES_OCCURRENCES,
    buildOccurrencePayload,
    computeEventDurationMs,
    generateEventSeries,
    nextOccurrenceAfter,
} from './social-events-recurrence.js';
import type { SocialPayloadByKind } from '../types/social.js';

describe('generateEventSeries (pure)', () => {
    it('returns [] for unparseable base startsAt', () => {
        expect(generateEventSeries('not-a-date', { kind: 'weekly' })).toEqual([]);
    });

    it('returns [] for unsupported recurrence kind', () => {
        expect(generateEventSeries(
            '2026-06-01T10:00:00.000Z',
            // @ts-expect-error — deliberately invalid kind
            { kind: 'daily' },
        )).toEqual([]);
    });

    it('returns [] for blank base startsAt', () => {
        expect(generateEventSeries('', { kind: 'weekly' })).toEqual([]);
    });

    it('weekly: generates N future ISO timestamps spaced exactly 7 days apart', () => {
        const base = '2026-06-01T10:00:00.000Z';
        const out = generateEventSeries(base, { kind: 'weekly', occurrencesAhead: 4 });
        expect(out).toHaveLength(4);
        const baseTs = new Date(base).getTime();
        out.forEach((iso, idx) => {
            expect(new Date(iso).getTime() - baseTs).toBe((idx + 1) * 7 * 24 * 60 * 60 * 1000);
        });
    });

    it('monthly: increments the calendar month per step (UTC)', () => {
        const out = generateEventSeries('2026-01-15T08:00:00.000Z', {
            kind: 'monthly',
            occurrencesAhead: 3,
        });
        expect(out).toHaveLength(3);
        expect(out[0]).toBe('2026-02-15T08:00:00.000Z');
        expect(out[1]).toBe('2026-03-15T08:00:00.000Z');
        expect(out[2]).toBe('2026-04-15T08:00:00.000Z');
    });

    it('monthly: day overflow normalizes (Jan 31 → Mar 03 in non-leap year)', () => {
        const out = generateEventSeries('2025-01-31T00:00:00.000Z', {
            kind: 'monthly',
            occurrencesAhead: 2,
        });
        // Each step recomputes from the base via setUTCMonth(base + step).
        // For Jan 31: step=1 → Feb 31 → normalized to Mar 3 (Feb has 28
        // days in 2025). step=2 → Mar 31 (March has 31). We accept the JS
        // calendar normalization as the documented behavior.
        expect(out).toHaveLength(2);
        expect(out[0].startsWith('2025-03-')).toBe(true);
        expect(out[1].startsWith('2025-03-31')).toBe(true);
    });

    it('hard caps at MAX_SERIES_OCCURRENCES even if a larger occurrencesAhead is requested', () => {
        const out = generateEventSeries('2026-06-01T10:00:00.000Z', {
            kind: 'weekly',
            occurrencesAhead: 9999,
        });
        expect(out).toHaveLength(MAX_SERIES_OCCURRENCES);
    });

    it('uses DEFAULT_OCCURRENCES_AHEAD when occurrencesAhead is missing', () => {
        const out = generateEventSeries('2026-06-01T10:00:00.000Z', { kind: 'weekly' });
        expect(out).toHaveLength(DEFAULT_OCCURRENCES_AHEAD);
    });

    it('uses DEFAULT_OCCURRENCES_AHEAD when occurrencesAhead is non-finite or non-positive', () => {
        const a = generateEventSeries('2026-06-01T10:00:00.000Z', {
            kind: 'weekly',
            occurrencesAhead: 0,
        });
        const b = generateEventSeries('2026-06-01T10:00:00.000Z', {
            kind: 'weekly',
            occurrencesAhead: Number.NaN,
        });
        const c = generateEventSeries('2026-06-01T10:00:00.000Z', {
            kind: 'weekly',
            occurrencesAhead: -3,
        });
        expect(a).toHaveLength(DEFAULT_OCCURRENCES_AHEAD);
        expect(b).toHaveLength(DEFAULT_OCCURRENCES_AHEAD);
        expect(c).toHaveLength(DEFAULT_OCCURRENCES_AHEAD);
    });

    it('respects the until cap inclusively', () => {
        // Weekly from June 1 + occurrencesAhead 26 normally → 26 entries.
        // until = June 22 should cap to weeks 1, 2, 3 (June 8, 15, 22).
        const out = generateEventSeries('2026-06-01T10:00:00.000Z', {
            kind: 'weekly',
            occurrencesAhead: 26,
            until: '2026-06-22T10:00:00.000Z',
        });
        expect(out).toHaveLength(3);
        expect(out[2]).toBe('2026-06-22T10:00:00.000Z');
    });

    it('ignores an unparseable until value (no cap from that field)', () => {
        const out = generateEventSeries('2026-06-01T10:00:00.000Z', {
            kind: 'weekly',
            occurrencesAhead: 4,
            until: 'not-a-date',
        });
        expect(out).toHaveLength(4);
    });

    it('does not include the base startsAt in the output', () => {
        const base = '2026-06-01T10:00:00.000Z';
        const out = generateEventSeries(base, { kind: 'weekly', occurrencesAhead: 3 });
        expect(out).not.toContain(base);
    });
});

describe('nextOccurrenceAfter (pure)', () => {
    it('weekly adds 7 days', () => {
        expect(nextOccurrenceAfter('2026-06-01T10:00:00.000Z', 'weekly'))
            .toBe('2026-06-08T10:00:00.000Z');
    });

    it('monthly increments the calendar month', () => {
        expect(nextOccurrenceAfter('2026-06-15T10:00:00.000Z', 'monthly'))
            .toBe('2026-07-15T10:00:00.000Z');
    });

    it('returns null for unsupported kind', () => {
        expect(nextOccurrenceAfter(
            '2026-06-01T10:00:00.000Z',
            // @ts-expect-error — deliberately invalid kind
            'daily',
        )).toBeNull();
    });

    it('returns null for unparseable anchor', () => {
        expect(nextOccurrenceAfter('not-a-date', 'weekly')).toBeNull();
    });
});

describe('computeEventDurationMs (pure)', () => {
    it('returns the millisecond delta between startsAt and endsAt', () => {
        const ms = computeEventDurationMs({
            startsAt: '2026-06-01T10:00:00.000Z',
            endsAt: '2026-06-01T11:30:00.000Z',
        });
        expect(ms).toBe(90 * 60 * 1000);
    });

    it('returns null when endsAt is missing', () => {
        expect(computeEventDurationMs({ startsAt: '2026-06-01T10:00:00.000Z' })).toBeNull();
    });

    it('returns null when endsAt is not after startsAt', () => {
        expect(computeEventDurationMs({
            startsAt: '2026-06-01T10:00:00.000Z',
            endsAt: '2026-06-01T10:00:00.000Z',
        })).toBeNull();
    });

    it('returns null for unparseable dates', () => {
        expect(computeEventDurationMs({
            startsAt: 'not-a-date',
            endsAt: '2026-06-01T11:30:00.000Z',
        })).toBeNull();
    });
});

describe('buildOccurrencePayload (pure)', () => {
    const base: SocialPayloadByKind['event'] = {
        title: 'Weekly seminar',
        body: 'Bring slides',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:30:00.000Z',
        location: 'Room 301',
        recurrence: { kind: 'weekly' },
        rsvpStatus: { someone: 'yes' },
    };

    it('strips recurrence + rsvpStatus and keeps shared metadata', () => {
        const next = buildOccurrencePayload(
            base,
            '2026-06-08T10:00:00.000Z',
            'series-abc',
            90 * 60 * 1000,
        );
        expect(next.title).toBe('Weekly seminar');
        expect(next.body).toBe('Bring slides');
        expect(next.location).toBe('Room 301');
        expect(next.startsAt).toBe('2026-06-08T10:00:00.000Z');
        expect(next.endsAt).toBe('2026-06-08T11:30:00.000Z');
        expect(next.seriesId).toBe('series-abc');
        expect((next as Record<string, unknown>).recurrence).toBeUndefined();
        expect((next as Record<string, unknown>).rsvpStatus).toBeUndefined();
    });

    it('omits endsAt when offset is null', () => {
        const next = buildOccurrencePayload(
            { title: 't', startsAt: '2026-06-01T10:00:00.000Z' },
            '2026-06-08T10:00:00.000Z',
            'series-abc',
            null,
        );
        expect(next.endsAt).toBeUndefined();
    });

    it('omits optional fields when blank on the base payload', () => {
        const next = buildOccurrencePayload(
            { title: 't', startsAt: '2026-06-01T10:00:00.000Z', body: '', location: '' },
            '2026-06-08T10:00:00.000Z',
            'series-abc',
            null,
        );
        expect(next.body).toBeUndefined();
        expect(next.location).toBeUndefined();
    });
});
