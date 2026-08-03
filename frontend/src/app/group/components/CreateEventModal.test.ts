import { describe, it, expect } from 'vitest';
import {
    datetimeLocalToIso,
    validateCreateEventForm,
} from './CreateEventModal';

const ui = {
    errorTitleRequired: 'TITLE_REQ',
    errorStartsAtRequired: 'STARTS_REQ',
    errorEndsBeforeStart: 'ENDS_BEFORE',
};

describe('datetimeLocalToIso (pure)', () => {
    it('returns "" for empty input', () => {
        expect(datetimeLocalToIso('')).toBe('');
    });

    it('returns "" for unparseable input', () => {
        expect(datetimeLocalToIso('not-a-date')).toBe('');
    });

    it('returns an ISO string for a 16-char local-time input', () => {
        // datetime-local on browsers surfaces 16 chars like "2026-06-15T18:30".
        // We append ":00" internally so the output is a full ISO string.
        const out = datetimeLocalToIso('2026-06-15T18:30');
        expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(out.endsWith('Z') || out.includes('+') || out.includes('-')).toBe(true);
    });

    it('parses already-ISO inputs idempotently', () => {
        const iso = '2026-06-15T18:30:00.000Z';
        // Round-trips through Date — the result is still the same instant.
        expect(new Date(datetimeLocalToIso(iso)).getTime()).toBe(new Date(iso).getTime());
    });
});

describe('validateCreateEventForm (pure)', () => {
    it('returns null for a valid form', () => {
        expect(validateCreateEventForm({
            title: 'Brief',
            startsAt: '2026-06-15T18:30',
            endsAt: '2026-06-15T19:30',
        }, ui)).toBeNull();
    });

    it('flags missing title', () => {
        expect(validateCreateEventForm({
            title: '   ',
            startsAt: '2026-06-15T18:30',
            endsAt: '',
        }, ui)).toBe('TITLE_REQ');
    });

    it('flags missing startsAt', () => {
        expect(validateCreateEventForm({
            title: 'Brief',
            startsAt: '',
            endsAt: '',
        }, ui)).toBe('STARTS_REQ');
    });

    it('flags endsAt before startsAt', () => {
        expect(validateCreateEventForm({
            title: 'Brief',
            startsAt: '2026-06-15T18:30',
            endsAt: '2026-06-15T17:00',
        }, ui)).toBe('ENDS_BEFORE');
    });

    it('does not flag endsAt when both startsAt and endsAt are well-ordered', () => {
        expect(validateCreateEventForm({
            title: 'Brief',
            startsAt: '2026-06-15T18:30',
            endsAt: '2026-06-15T18:31',
        }, ui)).toBeNull();
    });
});
