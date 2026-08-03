import { describe, it, expect } from 'vitest';
import { getWeekInfo, stripPortalCounter } from './week-info';
import type { AcademicContext } from '@/lib/api';

const messages = {
    schedule: {
        weekUnknown: 'Неделя неизвестна',
        academicCalendar: 'Учебный календарь',
        loadingFromUniver: 'Загрузка из университета…',
        studyPeriod: 'Учебный период',
        numerator: 'Нечётная',
        denominator: 'Чётная',
        numeratorTitle: 'Нечётная неделя (числитель)',
        denominatorTitle: 'Чётная неделя (знаменатель)',
        offSemester: 'Вне семестра',
        weekNumber: 'Неделя {value}',
        semesterNumber: '{value} семестр',
        periodKind: {
            theory: 'Теоретическое обучение',
            practice: 'Практика',
            vacation: 'Каникулы',
            midterm1: 'Рубежный контроль 1',
            midterm2: 'Рубежный контроль 2',
            exams: 'Экзаменационная сессия',
            stateExams: 'Государственные экзамены',
        },
    },
} as unknown as Parameters<typeof getWeekInfo>[0];

const context = (overrides: Partial<AcademicContext> = {}): AcademicContext => ({
    weekParity: 'num',
    weekLabel: '',
    activePeriodLabel: null,
    activePeriodKind: null,
    currentSemesterLabel: '',
    currentSemesterNumber: null,
    semesterWeek: null,
    ...overrides,
} as AcademicContext);

describe('stripPortalCounter', () => {
    it('removes the trailing raw portal counter', () => {
        expect(stripPortalCounter('Каникулы (100)')).toBe('Каникулы');
        expect(stripPortalCounter('2 семестр  (100) ')).toBe('2 семестр');
    });

    it('keeps meaningful parentheses that are not a bare number', () => {
        expect(stripPortalCounter('Практика (учебная)')).toBe('Практика (учебная)');
    });

    it('handles null/undefined', () => {
        expect(stripPortalCounter(null)).toBe('');
        expect(stripPortalCounter(undefined)).toBe('');
    });
});

describe('getWeekInfo', () => {
    describe('no academicContext', () => {
        it('returns fallback labels', () => {
            const info = getWeekInfo(messages, null);
            expect(info).toEqual({
                text: 'Неделя неизвестна',
                textTitle: 'Неделя неизвестна',
                type: 'num',
                parityKnown: false,
                weekLabel: 'Учебный календарь',
                semesterLabel: 'Загрузка из университета…',
                activePeriodLabel: null,
            });
        });

        it('treats undefined the same as null', () => {
            expect(getWeekInfo(messages)).toEqual(getWeekInfo(messages, null));
        });
    });

    describe('parity badge', () => {
        it('uses the odd-week label for weekParity=num', () => {
            const info = getWeekInfo(messages, context({ weekParity: 'num' }));
            expect(info.text).toBe('Нечётная');
            expect(info.textTitle).toBe('Нечётная неделя (числитель)');
            expect(info.type).toBe('num');
            expect(info.parityKnown).toBe(true);
        });

        it('uses the even-week label for weekParity=den', () => {
            const info = getWeekInfo(messages, context({ weekParity: 'den' }));
            expect(info.text).toBe('Чётная');
            expect(info.textTitle).toBe('Чётная неделя (знаменатель)');
            expect(info.type).toBe('den');
            expect(info.parityKnown).toBe(true);
        });

        it('says "off-semester" instead of a bare dash when parity is unknown', () => {
            const info = getWeekInfo(messages, context({ weekParity: '' as 'num' }));
            expect(info.type).toBe('num');
            expect(info.parityKnown).toBe(false);
            expect(info.text).toBe('Вне семестра');
        });

        it('does not fake an odd-week badge during vacation (weekParity=null)', () => {
            const info = getWeekInfo(messages, context({
                weekParity: null,
                weekLabel: null,
                activePeriodKind: 'vacation',
                activePeriodLabel: 'Каникулы',
            }));
            expect(info.parityKnown).toBe(false);
            expect(info.text).toBe('Вне семестра');
            expect(info.weekLabel).toBe('Каникулы');
        });
    });

    describe('week label', () => {
        it('builds the week label from the structured week number', () => {
            const info = getWeekInfo(messages, context({
                semesterWeek: 7,
                activePeriodKind: 'theory',
                weekLabel: '7-я неделя',
            }));
            expect(info.weekLabel).toBe('Неделя 7');
        });

        it('localizes vacation from activePeriodKind, ignoring the server string', () => {
            const info = getWeekInfo(messages, context({
                activePeriodKind: 'vacation',
                activePeriodLabel: 'Каникулы (100)',
            }));
            expect(info.weekLabel).toBe('Каникулы');
        });

        it('shows the control-period name instead of a week number', () => {
            for (const [kind, expected] of [
                ['midterm_1', 'Рубежный контроль 1'],
                ['midterm_2', 'Рубежный контроль 2'],
                ['exams', 'Экзаменационная сессия'],
                ['state_exams', 'Государственные экзамены'],
            ] as const) {
                const info = getWeekInfo(messages, context({ activePeriodKind: kind, semesterWeek: 12 }));
                expect(info.weekLabel).toBe(expected);
            }
        });

        it('falls back to the server label with the raw counter stripped', () => {
            const info = getWeekInfo(messages, context({
                activePeriodKind: 'other',
                weekLabel: 'Особый период (100)',
            }));
            expect(info.weekLabel).toBe('Особый период');
        });

        it('falls back to studyPeriod when nothing is available', () => {
            expect(getWeekInfo(messages, context({})).weekLabel).toBe('Учебный период');
        });
    });

    describe('semester label', () => {
        it('builds the semester name from the structured number', () => {
            const info = getWeekInfo(messages, context({
                currentSemesterNumber: 2,
                currentSemesterLabel: '2 Семестр (100)',
                semesterWeek: 3,
                activePeriodKind: 'theory',
            }));
            expect(info.semesterLabel).toBe('2 семестр • Теоретическое обучение');
        });

        it('does not repeat the period when the week headline already shows it', () => {
            const info = getWeekInfo(messages, context({
                currentSemesterNumber: 2,
                activePeriodKind: 'vacation',
                activePeriodLabel: 'Каникулы',
            }));
            expect(info.weekLabel).toBe('Каникулы');
            expect(info.semesterLabel).toBe('2 семестр');
        });

        it('strips the raw counter from the server semester label when there is no number', () => {
            const info = getWeekInfo(messages, context({ currentSemesterLabel: 'Семестр 2 (100)' }));
            expect(info.semesterLabel).toBe('Семестр 2');
        });

        it('falls back to academicCalendar when the headline already carries the only label', () => {
            const info = getWeekInfo(messages, context({ activePeriodKind: 'exams' }));
            expect(info.semesterLabel).toBe('Учебный календарь');
        });

        it('falls back to academicCalendar when neither is set', () => {
            expect(getWeekInfo(messages, context({})).semesterLabel).toBe('Учебный календарь');
        });
    });

    it('mirrors the localized period label on the result', () => {
        const info = getWeekInfo(messages, context({ activePeriodKind: 'practice', activePeriodLabel: 'Практика' }));
        expect(info.activePeriodLabel).toBe('Практика');
    });
});
