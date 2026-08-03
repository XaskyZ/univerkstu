/**
 * Push notifications i18n — inline copy for ru/kz/en.
 *
 * Backend has no general i18n system; for web-push payloads we keep a tiny
 * inline lookup here. No JSON files, no dotenv, no runtime config — copy
 * lives next to the only consumer (`jobs/exam-reminders.ts`).
 *
 * Conceptually corresponds to the `notifications.*` namespace:
 *   - notifications.examOneDayTitle
 *   - notifications.examOneDayBody
 *   - notifications.examOneHourTitle
 *   - notifications.examOneHourBody
 *
 * Unknown / unsupported languages silently fall back to Russian (the project's
 * primary locale), matching `UserSettings.language` default.
 */

export type PushLang = 'ru' | 'kz' | 'en';
export type ExamReminderKind = '1day' | '1hour';

export interface ExamPayloadParams {
    subject: string;
    time: string;        // HH:mm
    room?: string | null;
}

interface LangCopy {
    oneDayTitle: string;
    oneHourTitle: string;
    oneDayBody: (p: ExamPayloadParams) => string;
    oneHourBody: (p: ExamPayloadParams) => string;
}

function roomSuffix(room: string | null | undefined): string {
    const trimmed = room?.trim();
    return trimmed ? ` · ${trimmed}` : '';
}

const COPY: Record<PushLang, LangCopy> = {
    ru: {
        oneDayTitle: 'Завтра экзамен',
        oneHourTitle: 'Через час экзамен',
        oneDayBody: ({ subject, time, room }) =>
            `${subject} — завтра в ${time}${roomSuffix(room)}`,
        oneHourBody: ({ subject, time, room }) =>
            `В ${time} — ${subject}${roomSuffix(room)}`,
    },
    kz: {
        oneDayTitle: 'Ертең емтихан',
        oneHourTitle: 'Бір сағаттан кейін емтихан',
        oneDayBody: ({ subject, time, room }) =>
            `${subject} — ертең сағат ${time}${roomSuffix(room)}`,
        oneHourBody: ({ subject, time, room }) =>
            `Сағат ${time} — ${subject}${roomSuffix(room)}`,
    },
    en: {
        oneDayTitle: 'Exam tomorrow',
        oneHourTitle: 'Exam in one hour',
        oneDayBody: ({ subject, time, room }) =>
            `${subject} — tomorrow at ${time}${roomSuffix(room)}`,
        oneHourBody: ({ subject, time, room }) =>
            `At ${time} — ${subject}${roomSuffix(room)}`,
    },
};

const FALLBACK_LANG: PushLang = 'ru';

function resolveLang(lang: string | null | undefined): PushLang {
    if (lang === 'ru' || lang === 'kz' || lang === 'en') return lang;
    return FALLBACK_LANG;
}

/**
 * Title for an exam reminder push (`notifications.examOneDayTitle` /
 * `notifications.examOneHourTitle`). Unknown lang → ru.
 */
export function buildExamReminderTitle(kind: ExamReminderKind, lang: string | null | undefined): string {
    const copy = COPY[resolveLang(lang)];
    return kind === '1day' ? copy.oneDayTitle : copy.oneHourTitle;
}

/**
 * Body for an exam reminder push (`notifications.examOneDayBody` /
 * `notifications.examOneHourBody`). Unknown lang → ru.
 */
export function buildExamReminderBody(
    kind: ExamReminderKind,
    lang: string | null | undefined,
    params: ExamPayloadParams
): string {
    const copy = COPY[resolveLang(lang)];
    return kind === '1day' ? copy.oneDayBody(params) : copy.oneHourBody(params);
}
