import type { Exam } from '@/lib/types';

export interface CountdownParts {
    days: number;
    hours: number;
    minutes: number;
}

export type CountdownSeverity = 'imminent' | 'soon' | 'far';

export interface NextExamInfo {
    exam: Exam;
    iso: string;
    msUntil: number;
    parts: CountdownParts;
    severity: CountdownSeverity;
}

export function findNextExam(exams: Exam[], now: number = Date.now()): NextExamInfo | null {
    let best: { exam: Exam; iso: string; ms: number } | null = null;
    for (const exam of exams) {
        const iso = exam.datetime?.iso;
        if (!iso) continue;
        const ts = Date.parse(iso);
        if (Number.isNaN(ts)) continue;
        if (ts <= now) continue;
        if (!best || ts < best.ms) {
            best = { exam, iso, ms: ts };
        }
    }
    if (!best) return null;
    const msUntil = best.ms - now;
    return {
        exam: best.exam,
        iso: best.iso,
        msUntil,
        parts: msToParts(msUntil),
        severity: classifySeverity(msUntil),
    };
}

export function msToParts(ms: number): CountdownParts {
    const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
    const minutes = totalMinutes - days * 60 * 24 - hours * 60;
    return { days, hours, minutes };
}

export function classifySeverity(ms: number): CountdownSeverity {
    if (ms <= 24 * 60 * 60 * 1000) return 'imminent';
    if (ms <= 3 * 24 * 60 * 60 * 1000) return 'soon';
    return 'far';
}

type Language = 'ru' | 'kz' | 'en';

export interface ExamCountdownUi {
    titleUpcoming: string;
    titleImminent: string;
    inLabel: string;
    daysShort: string;
    hoursShort: string;
    minutesShort: string;
    roomLabel: string;
}

export function getExamCountdownUi(language: Language): ExamCountdownUi {
    if (language === 'kz') {
        return {
            titleUpcoming: 'Жақын емтихан',
            titleImminent: 'Емтиханға аз қалды',
            inLabel: 'қалды',
            daysShort: 'күн',
            hoursShort: 'сағ',
            minutesShort: 'мин',
            roomLabel: 'Аудитория',
        };
    }
    if (language === 'en') {
        return {
            titleUpcoming: 'Next exam',
            titleImminent: 'Exam is close',
            inLabel: 'in',
            daysShort: 'd',
            hoursShort: 'h',
            minutesShort: 'm',
            roomLabel: 'Room',
        };
    }
    return {
        titleUpcoming: 'Ближайший экзамен',
        titleImminent: 'Экзамен скоро',
        inLabel: 'через',
        daysShort: 'дн',
        hoursShort: 'ч',
        minutesShort: 'мин',
        roomLabel: 'Аудитория',
    };
}

export function formatCountdown(parts: CountdownParts, ui: ExamCountdownUi): string {
    const tokens: string[] = [];
    if (parts.days > 0) tokens.push(`${parts.days} ${ui.daysShort}`);
    if (parts.hours > 0 || parts.days > 0) tokens.push(`${parts.hours} ${ui.hoursShort}`);
    tokens.push(`${parts.minutes} ${ui.minutesShort}`);
    return tokens.join(' ');
}
