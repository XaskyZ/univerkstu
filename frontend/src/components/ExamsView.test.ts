import { describe, it, expect } from 'vitest';
import type { Exam } from '@/lib/types';
import { compareExamsForDisplay, formatMilestoneRange } from './ExamsView';

function makeExam(overrides: Partial<Exam>): Exam {
    return {
        subject: 'Subject',
        teacher: 'Teacher',
        type: '',
        format: '',
        building: '',
        room: '',
        locationRaw: '',
        groupType: '',
        datetime: null,
        ...overrides,
    };
}

function datedExam(subject: string, iso: string): Exam {
    return makeExam({
        subject,
        datetime: { date: '', time: '', displayDate: '', displayTime: '', iso },
    });
}

describe('compareExamsForDisplay', () => {
    // Компаратор списка экзаменов (№9 аудита): экзамены с датой — по возрастанию
    // даты, без даты — стабильно в конце по названию. Прежний компаратор
    // возвращал 0 при отсутствии даты у любой из сторон и ломал транзитивность.

    it('sorts dated exams ascending by iso date', () => {
        const a = datedExam('A', '2026-05-20T09:00:00');
        const b = datedExam('B', '2026-05-10T09:00:00');
        const c = datedExam('C', '2026-05-15T09:00:00');
        const sorted = [a, b, c].sort(compareExamsForDisplay);
        expect(sorted.map((e) => e.subject)).toEqual(['B', 'C', 'A']);
    });

    it('puts exams without a date after all dated exams', () => {
        const undated = makeExam({ subject: 'Математика' });
        const dated = datedExam('Физика', '2026-05-10T09:00:00');
        expect(compareExamsForDisplay(dated, undated)).toBeLessThan(0);
        expect(compareExamsForDisplay(undated, dated)).toBeGreaterThan(0);
    });

    it('orders undated exams deterministically by subject name', () => {
        const a = makeExam({ subject: 'Алгебра' });
        const b = makeExam({ subject: 'Физика' });
        expect(compareExamsForDisplay(a, b)).toBeLessThan(0);
        expect(compareExamsForDisplay(b, a)).toBeGreaterThan(0);
    });

    it('breaks equal-date ties by subject (stable across renders)', () => {
        const a = datedExam('Химия', '2026-05-10T09:00:00');
        const b = datedExam('Биология', '2026-05-10T09:00:00');
        const sorted = [a, b].sort(compareExamsForDisplay);
        expect(sorted.map((e) => e.subject)).toEqual(['Биология', 'Химия']);
    });

    it('is deterministic: any initial order produces the same result (transitivity guard)', () => {
        // Старый компаратор с `return 0` для недатированных давал разный порядок
        // в зависимости от исходного расположения элементов.
        const exams = [
            makeExam({ subject: 'Без даты Б' }),
            datedExam('Поздний', '2026-06-01T09:00:00'),
            makeExam({ subject: 'Без даты А' }),
            datedExam('Ранний', '2026-05-01T09:00:00'),
        ];
        const expected = ['Ранний', 'Поздний', 'Без даты А', 'Без даты Б'];
        expect([...exams].sort(compareExamsForDisplay).map((e) => e.subject)).toEqual(expected);
        expect([...exams].reverse().sort(compareExamsForDisplay).map((e) => e.subject)).toEqual(expected);
    });
});

describe('formatMilestoneRange', () => {
    // Formats a DD.MM.YYYY date pair into a "DD mon - DD mon YYYY" range string
    // for the exam milestones banner at the top of the exams page. Used to surface
    // the active exam window (e.g., "15 мая - 30 мая 2026").

    it('same-year range uses single year at end', () => {
        // Format: "DD mon - DD mon YYYY" (just one year at the very end).
        const result = formatMilestoneRange('15.05.2026', '30.05.2026', 'ru');
        expect(result).toBe('15 май - 30 май 2026');
    });

    it('cross-year range repeats the year on each side', () => {
        // Format: "DD mon YYYY - DD mon YYYY" — needed when the range spans
        // December → January boundary.
        const result = formatMilestoneRange('20.12.2025', '15.01.2026', 'ru');
        expect(result).toBe('20 дек 2025 - 15 янв 2026');
    });

    it('Kazakh month names (қаң/ақп/нау/...)', () => {
        const result = formatMilestoneRange('01.01.2026', '15.02.2026', 'kz');
        expect(result).toContain('қаң');
        expect(result).toContain('ақп');
    });

    it('English month names', () => {
        const result = formatMilestoneRange('05.06.2026', '20.06.2026', 'en');
        expect(result).toBe('05 Jun - 20 Jun 2026');
    });

    it('handles zero-padded vs unpadded day numbers', () => {
        // The function passes through the day part verbatim — no normalization.
        const padded = formatMilestoneRange('05.05.2026', '06.05.2026', 'ru');
        expect(padded).toBe('05 май - 06 май 2026');
    });

    it('locks in the exact short Russian month names (regression guard)', () => {
        // 12 months × short RU names from the MONTHS dictionary.
        const expected = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        for (let i = 0; i < 12; i += 1) {
            const month = String(i + 1).padStart(2, '0');
            const result = formatMilestoneRange(`01.${month}.2026`, `02.${month}.2026`, 'ru');
            expect(result).toContain(expected[i]);
        }
    });

    it('out-of-range month falls back to month 0 via Math.max(0, ...)', () => {
        // Defense: if the date column is malformed and month parses to 0 or NaN,
        // Math.max(0, Number-1) clamps to 0 → January. Documents the defensive behavior.
        const result = formatMilestoneRange('01.00.2026', '02.00.2026', 'ru');
        // Number('00') - 1 = -1 → Math.max(0, -1) = 0 → January.
        expect(result).toContain('янв');
    });
});
