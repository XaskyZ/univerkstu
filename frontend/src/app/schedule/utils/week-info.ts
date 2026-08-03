import type { useLanguage } from '@/lib/language-context';
import type { AcademicContext } from '@/lib/api';

type Messages = ReturnType<typeof useLanguage>['messages'];

export interface WeekInfo {
    text: string;
    /** Expanded wording for the parity badge tooltip / aria-label. */
    textTitle: string;
    type: 'num' | 'den';
    /**
     * false — активная чётность неизвестна: контекста нет (грузится) или
     * семестр сейчас не идёт (weekParity = null в каникулы). В этом случае
     * `type` — лишь фолбэк для фильтра сетки, а бейдж должен быть нейтральным,
     * а не изображать «Нечётную» по мёртвой сетке (№11 логик-аудита).
     */
    parityKnown: boolean;
    weekLabel: string;
    semesterLabel: string;
    activePeriodLabel: string | null;
}

/**
 * The academic-context payload is built server-side in Russian and its labels
 * can carry a raw portal counter («Каникулы (100)»). That number is an internal
 * artefact of the portal HTML, not something a student can act on, so it never
 * reaches the UI.
 */
export function stripPortalCounter(value: string | null | undefined): string {
    return (value || '').replace(/\s*\(\d+\)\s*$/, '').trim();
}

function fillValue(template: string, value: number | string): string {
    return template.replace('{value}', String(value));
}

/**
 * Localised name for an academic period. The backend hands over pre-rendered
 * Russian strings, so English/Kazakh users would otherwise read Russian —
 * we rebuild the label from the structured `activePeriodKind` instead.
 * Returns null for kinds we have no wording for (caller falls back to the
 * server label with the counter stripped).
 */
function getPeriodKindLabel(messages: Messages, kind: string | null | undefined): string | null {
    const periodKind = messages.schedule.periodKind;
    switch (kind) {
        case 'theory':
            return periodKind.theory;
        case 'practice':
            return periodKind.practice;
        case 'vacation':
            return periodKind.vacation;
        case 'midterm_1':
            return periodKind.midterm1;
        case 'midterm_2':
            return periodKind.midterm2;
        case 'exams':
            return periodKind.exams;
        case 'state_exams':
            return periodKind.stateExams;
        default:
            return null;
    }
}

const CONTROL_PERIOD_KINDS = new Set(['midterm_1', 'midterm_2', 'exams', 'state_exams']);

export function getWeekInfo(
    messages: Messages,
    academicContext?: AcademicContext | null,
): WeekInfo {
    if (!academicContext) {
        return {
            text: messages.schedule.weekUnknown,
            textTitle: messages.schedule.weekUnknown,
            type: 'num',
            parityKnown: false,
            weekLabel: messages.schedule.academicCalendar,
            semesterLabel: messages.schedule.loadingFromUniver,
            activePeriodLabel: null,
        };
    }

    const parityKnown = academicContext.weekParity === 'num' || academicContext.weekParity === 'den';
    const type = academicContext.weekParity || 'num';

    const kind = academicContext.activePeriodKind;
    const periodLabel = getPeriodKindLabel(messages, kind)
        || stripPortalCounter(academicContext.activePeriodLabel)
        || null;
    const semesterWeek = academicContext.semesterWeek;

    let weekLabel: string;
    if (kind === 'vacation' || CONTROL_PERIOD_KINDS.has(kind || '')) {
        // «Каникулы» / «Экзаменационная сессия» — a week number would be noise.
        weekLabel = periodLabel || messages.schedule.studyPeriod;
    } else if (typeof semesterWeek === 'number' && semesterWeek >= 1) {
        weekLabel = fillValue(messages.schedule.weekNumber, semesterWeek);
    } else {
        weekLabel = stripPortalCounter(academicContext.weekLabel)
            || periodLabel
            || messages.schedule.studyPeriod;
    }

    const semesterNumber = academicContext.currentSemesterNumber;
    const semesterPart = typeof semesterNumber === 'number' && semesterNumber > 0
        ? fillValue(messages.schedule.semesterNumber, semesterNumber)
        : stripPortalCounter(academicContext.currentSemesterLabel);
    // Don't repeat the period next to the semester when the headline already says it.
    const semesterPeriodPart = periodLabel && periodLabel !== weekLabel ? periodLabel : '';
    const semesterLabel = [semesterPart, semesterPeriodPart].filter(Boolean).join(' • ')
        || messages.schedule.academicCalendar;

    return {
        // Вне семестра чётности не существует — говорим об этом прямо, вместо
        // молчаливой «Нечётной» по мёртвой сетке или безымянного «—».
        text: parityKnown
            ? (type === 'num' ? messages.schedule.numerator : messages.schedule.denominator)
            : messages.schedule.offSemester,
        textTitle: parityKnown
            ? (type === 'num' ? messages.schedule.numeratorTitle : messages.schedule.denominatorTitle)
            : messages.schedule.offSemester,
        type,
        parityKnown,
        weekLabel,
        semesterLabel,
        activePeriodLabel: periodLabel,
    };
}
