import { describe, it, expect } from 'vitest';
import {
    buildExamReminderTitle,
    buildExamReminderBody,
} from './push-i18n.js';

describe('buildExamReminderTitle', () => {
    it('returns the Russian 1-day title for lang=ru', () => {
        expect(buildExamReminderTitle('1day', 'ru')).toBe('Завтра экзамен');
    });

    it('returns the Kazakh 1-day title for lang=kz', () => {
        expect(buildExamReminderTitle('1day', 'kz')).toBe('Ертең емтихан');
    });

    it('returns the English 1-day title for lang=en', () => {
        expect(buildExamReminderTitle('1day', 'en')).toBe('Exam tomorrow');
    });

    it('returns the Russian 1-hour title for lang=ru', () => {
        expect(buildExamReminderTitle('1hour', 'ru')).toBe('Через час экзамен');
    });

    it('returns the Kazakh 1-hour title for lang=kz', () => {
        expect(buildExamReminderTitle('1hour', 'kz')).toBe('Бір сағаттан кейін емтихан');
    });

    it('returns the English 1-hour title for lang=en', () => {
        expect(buildExamReminderTitle('1hour', 'en')).toBe('Exam in one hour');
    });

    it('falls back to Russian for unknown lang', () => {
        // @ts-expect-error — intentionally passing invalid lang to exercise fallback.
        expect(buildExamReminderTitle('1day', 'fr')).toBe('Завтра экзамен');
        expect(buildExamReminderTitle('1hour', null)).toBe('Через час экзамен');
        expect(buildExamReminderTitle('1day', undefined)).toBe('Завтра экзамен');
    });
});

describe('buildExamReminderBody', () => {
    const params = { subject: 'Высшая математика II', time: '09:00', room: 'Ауд. 5-208' };
    const paramsNoRoom = { subject: 'Физика', time: '14:00', room: '' };

    it('builds the Russian 1-day body with room', () => {
        expect(buildExamReminderBody('1day', 'ru', params))
            .toBe('Высшая математика II — завтра в 09:00 · Ауд. 5-208');
    });

    it('builds the Kazakh 1-day body with room', () => {
        expect(buildExamReminderBody('1day', 'kz', params))
            .toBe('Высшая математика II — ертең сағат 09:00 · Ауд. 5-208');
    });

    it('builds the English 1-day body with room', () => {
        expect(buildExamReminderBody('1day', 'en', params))
            .toBe('Высшая математика II — tomorrow at 09:00 · Ауд. 5-208');
    });

    it('builds the Russian 1-hour body with room', () => {
        expect(buildExamReminderBody('1hour', 'ru', params))
            .toBe('В 09:00 — Высшая математика II · Ауд. 5-208');
    });

    it('builds the Kazakh 1-hour body with room', () => {
        expect(buildExamReminderBody('1hour', 'kz', params))
            .toBe('Сағат 09:00 — Высшая математика II · Ауд. 5-208');
    });

    it('builds the English 1-hour body with room', () => {
        expect(buildExamReminderBody('1hour', 'en', params))
            .toBe('At 09:00 — Высшая математика II · Ауд. 5-208');
    });

    it('omits the " · " room suffix when room is empty', () => {
        expect(buildExamReminderBody('1hour', 'ru', paramsNoRoom))
            .toBe('В 14:00 — Физика');
        expect(buildExamReminderBody('1day', 'en', paramsNoRoom))
            .toBe('Физика — tomorrow at 14:00');
    });

    it('omits the " · " room suffix when room is null/undefined/whitespace', () => {
        expect(buildExamReminderBody('1hour', 'ru', { subject: 'Физика', time: '14:00', room: null }))
            .toBe('В 14:00 — Физика');
        expect(buildExamReminderBody('1hour', 'kz', { subject: 'Физика', time: '14:00' }))
            .toBe('Сағат 14:00 — Физика');
        expect(buildExamReminderBody('1hour', 'en', { subject: 'Физика', time: '14:00', room: '   ' }))
            .toBe('At 14:00 — Физика');
    });

    it('falls back to Russian for unknown lang', () => {
        // @ts-expect-error — intentionally passing invalid lang to exercise fallback.
        expect(buildExamReminderBody('1day', 'de', params))
            .toBe('Высшая математика II — завтра в 09:00 · Ауд. 5-208');
        expect(buildExamReminderBody('1hour', null, paramsNoRoom))
            .toBe('В 14:00 — Физика');
        expect(buildExamReminderBody('1hour', undefined, params))
            .toBe('В 09:00 — Высшая математика II · Ауд. 5-208');
    });
});
