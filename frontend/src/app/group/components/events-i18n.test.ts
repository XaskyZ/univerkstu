import { describe, it, expect } from 'vitest';
import { getEventsUi, isEventPast, formatEventDateTime } from './events-i18n';

describe('getEventsUi', () => {
    it('returns Russian strings for "ru"', () => {
        const ui = getEventsUi('ru');
        expect(ui.newEvent).toBe('Создать событие');
        expect(ui.titleField).toBe('Название');
        expect(ui.rsvpYes).toBe('Да');
        expect(ui.rsvpNo).toBe('Нет');
        expect(ui.rsvpMaybe).toBe('Возможно');
        expect(ui.rsvpClear).toBe('Сбросить');
        expect(ui.pastBadge).toBe('состоялось');
        expect(ui.startsAtAria('1 июн.')).toBe('Начало 1 июн.');
    });

    it('returns Kazakh strings for "kz"', () => {
        const ui = getEventsUi('kz');
        expect(ui.newEvent).toBe('Іс-шара жасау');
        expect(ui.rsvpYes).toBe('Иә');
        expect(ui.rsvpNo).toBe('Жоқ');
        expect(ui.rsvpMaybe).toBe('Мүмкін');
        expect(ui.pastBadge).toBe('өткен');
        expect(ui.startsAtAria('1 июн.')).toBe('Басталуы 1 июн.');
    });

    it('returns English strings for "en"', () => {
        const ui = getEventsUi('en');
        expect(ui.newEvent).toBe('New event');
        expect(ui.rsvpYes).toBe('Yes');
        expect(ui.rsvpNo).toBe('No');
        expect(ui.rsvpMaybe).toBe('Maybe');
        expect(ui.rsvpClear).toBe('Clear');
        expect(ui.pastBadge).toBe('past');
        expect(ui.startsAtAria('Jun 1')).toBe('Starts Jun 1');
    });

    it('produces every key for every language (locale parity)', () => {
        // Sanity check — adding a new key in one language and forgetting the
        // others would surface here as a per-language string difference.
        const ru = getEventsUi('ru');
        const kz = getEventsUi('kz');
        const en = getEventsUi('en');
        expect(Object.keys(ru).sort()).toEqual(Object.keys(kz).sort());
        expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    });

    it('exposes non-empty recurrence labels across languages', () => {
        for (const lang of ['ru', 'kz', 'en'] as const) {
            const ui = getEventsUi(lang);
            expect(ui.recurrenceField.length).toBeGreaterThan(0);
            expect(ui.recurrenceNone.length).toBeGreaterThan(0);
            expect(ui.recurrenceWeekly.length).toBeGreaterThan(0);
            expect(ui.recurrenceMonthly.length).toBeGreaterThan(0);
            expect(ui.seriesBadgeWeekly.length).toBeGreaterThan(0);
            expect(ui.seriesBadgeMonthly.length).toBeGreaterThan(0);
            expect(ui.seriesMemberBadge.length).toBeGreaterThan(0);
        }
    });
});

describe('isEventPast (pure)', () => {
    it('returns true when endsAt is in the past', () => {
        // 2026-01-01T12:00:00Z is well behind a 2026-06-01 "now"
        expect(isEventPast(
            '2026-01-01T10:00:00Z',
            '2026-01-01T12:00:00Z',
            new Date('2026-06-01T00:00:00Z').getTime(),
        )).toBe(true);
    });

    it('returns false when endsAt is in the future', () => {
        expect(isEventPast(
            '2026-12-31T10:00:00Z',
            '2026-12-31T12:00:00Z',
            new Date('2026-06-01T00:00:00Z').getTime(),
        )).toBe(false);
    });

    it('falls back to startsAt when endsAt is missing', () => {
        // No endsAt → startsAt is used. Past start with no end → past event.
        expect(isEventPast(
            '2025-01-01T10:00:00Z',
            undefined,
            new Date('2026-06-01T00:00:00Z').getTime(),
        )).toBe(true);
        expect(isEventPast(
            '2027-01-01T10:00:00Z',
            undefined,
            new Date('2026-06-01T00:00:00Z').getTime(),
        )).toBe(false);
    });

    it('treats unparseable input as not past (defensive default)', () => {
        // We never want to mark a card "past" because of a parser bug — if
        // the timestamp is corrupt, render the card as live.
        expect(isEventPast('garbage', undefined, Date.now())).toBe(false);
        expect(isEventPast('', '', Date.now())).toBe(false);
    });
});

describe('formatEventDateTime (pure)', () => {
    it('returns a non-empty formatted string for valid ISO inputs', () => {
        // We do not lock the exact formatting (locale CLDR data can change
        // between Node versions) — assert the output is non-empty and
        // contains the day component.
        const out = formatEventDateTime('2026-06-15T18:30:00Z');
        expect(out.length).toBeGreaterThan(0);
        expect(out).toMatch(/15/);
    });

    it('returns an empty string for undefined or invalid input', () => {
        expect(formatEventDateTime(undefined)).toBe('');
        expect(formatEventDateTime('')).toBe('');
        expect(formatEventDateTime('not-a-date')).toBe('');
    });
});
