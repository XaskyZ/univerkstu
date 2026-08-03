/**
 * Single source of truth for lesson-type labels on the schedule screen.
 *
 * The KSTU/Platonus portal sends `Lesson.type` as a terse code
 * (`groupTypeShortName`: "Л", "ЛЗ", "ПЗ", "СПЗ", "сем", "практ", "СРСП", …).
 * Printing that code straight into a badge is unreadable, so every consumer
 * (mobile lesson card, legacy lesson card, lesson notifications) resolves the
 * code through the helpers below instead of keeping its own copy of the table.
 *
 * Two classifications live here and are deliberately kept apart:
 *   - the *academic form* of the class (lecture / seminar / lab / practice);
 *   - the *self-study* forms СРСП and СРС, which are NOT the same thing:
 *     СРСП is a scheduled session with the tutor that the student has to
 *     attend, СРС is unsupervised self-study with nothing to attend. They must
 *     never collapse into one label.
 */

type Lang = 'ru' | 'kz' | 'en';

export type LessonTypeKind = 'lecture' | 'seminar' | 'laboratory' | 'practice' | 'other';
export type SelfStudyKind = 'srsp' | 'srs';

type KnownLessonTypeKind = Exclude<LessonTypeKind, 'other'>;

/**
 * Substring markers. Checked in declaration order, so a value that mentions
 * several forms ("Лекция / Семинар") resolves to the first one listed.
 */
const LESSON_TYPE_MARKERS: Record<KnownLessonTypeKind, readonly string[]> = {
    lecture: ['lecture', 'лекция', 'лек', 'дәріс'],
    seminar: ['seminar', 'семинар', 'сем'],
    laboratory: ['laboratory', 'lab', 'лабораторное занятие', 'лаб', 'зертхана'],
    practice: ['practice', 'практика', 'практ'],
};

/**
 * Portal short codes. Matched on the whole (trimmed) type value only — as
 * substrings they are far too greedy ("л" would match everything).
 * "СПЗ" is the portal's code for `groupTypeFullName: "Практики, Семинары"`,
 * so it resolves to the practice label.
 */
const EXACT_TYPE_CODES: Record<string, KnownLessonTypeKind> = {
    'л': 'lecture',
    'лк': 'lecture',
    'лз': 'laboratory',
    'лб': 'laboratory',
    'пз': 'practice',
    'спз': 'practice',
};

/** СРСП markers come first — "срс" is a prefix of "срсп" and would swallow it. */
const SELF_STUDY_MARKERS: Record<SelfStudyKind, readonly string[]> = {
    srsp: ['срсп', 'srsp', 'сөжм'],
    srs: ['срс', 'srs', 'сөж'],
};

/**
 * Russian lab wording stays abbreviated on purpose: the badge sits next to the
 * week-parity badge and «Лабораторное занятие» does not fit at 360px.
 */
const LESSON_TYPE_LABELS: Record<Lang, Record<KnownLessonTypeKind, string>> = {
    ru: {
        lecture: 'Лекция',
        seminar: 'Семинар',
        laboratory: 'Лаб. занятие',
        practice: 'Практика',
    },
    kz: {
        lecture: 'Дәріс',
        seminar: 'Семинар',
        laboratory: 'Зертханалық',
        practice: 'Практика',
    },
    en: {
        lecture: 'Lecture',
        seminar: 'Seminar',
        laboratory: 'Lab',
        practice: 'Practice',
    },
};

/**
 * Self-study badges keep the short code (the full phrase overflows the badge
 * row on mobile) and carry the full wording in `description`, which callers
 * put into `title` + `aria-label`.
 */
const SELF_STUDY_LABELS: Record<Lang, Record<SelfStudyKind, { label: string; description: string }>> = {
    ru: {
        srsp: { label: 'СРСП', description: 'Самостоятельная работа с преподавателем' },
        srs: { label: 'СРС', description: 'Самостоятельная работа' },
    },
    kz: {
        srsp: { label: 'СӨЖМ', description: 'Оқытушымен өздік жұмыс' },
        srs: { label: 'СӨЖ', description: 'Өздік жұмыс' },
    },
    en: {
        srsp: { label: 'SRSP', description: 'Self-study with tutor' },
        srs: { label: 'SRS', description: 'Self-study' },
    },
};

/** CSS accent classes already defined for the mobile badge. */
const LESSON_TYPE_CLASSES: Record<KnownLessonTypeKind, string> = {
    lecture: 'lecture',
    seminar: 'seminar',
    laboratory: 'lab',
    practice: '',
};

export interface LessonTypeBadge {
    /** Short text rendered inside the badge. */
    label: string;
    /** Expanded wording for `title` / `aria-label`, or null when the label already says it all. */
    description: string | null;
}

/** Detects СРСП / СРС in any of the given texts. Returns null when neither applies. */
export function detectSelfStudyKind(...texts: (string | null | undefined)[]): SelfStudyKind | null {
    const combined = texts.filter(Boolean).join(' ').toLowerCase();
    if (!combined.trim()) return null;
    if (SELF_STUDY_MARKERS.srsp.some((marker) => combined.includes(marker))) return 'srsp';
    if (SELF_STUDY_MARKERS.srs.some((marker) => combined.includes(marker))) return 'srs';
    return null;
}

/**
 * Resolves the academic form of a lesson. `extraText` (usually the subject
 * title) is only consulted for the substring markers — short codes are matched
 * against `rawType` alone.
 */
export function detectLessonTypeKind(
    rawType: string | null | undefined,
    extraText?: string | null,
): LessonTypeKind {
    const normalized = (rawType || '').trim().toLowerCase().replace(/[.\s]+$/, '');
    const exact = normalized ? EXACT_TYPE_CODES[normalized] : undefined;
    if (exact) return exact;

    const combined = `${rawType || ''} ${extraText || ''}`.toLowerCase();
    if (!combined.trim()) return 'other';

    for (const kind of Object.keys(LESSON_TYPE_MARKERS) as KnownLessonTypeKind[]) {
        if (LESSON_TYPE_MARKERS[kind].some((marker) => combined.includes(marker))) return kind;
    }
    return 'other';
}

/**
 * Badge content for a lesson. Returns null when there is nothing to show
 * (no type at all and no self-study marker).
 *
 * @param fallbackLabel shown for a non-empty but unrecognised code — pass
 *        `messages.schedule.lessonFallbackType` so the raw portal code never leaks.
 */
export function getLessonTypeBadge(
    rawType: string | null | undefined,
    extraText: string | null | undefined,
    language: Lang,
    fallbackLabel: string,
): LessonTypeBadge | null {
    const selfStudy = detectSelfStudyKind(rawType, extraText);
    if (selfStudy) return { ...SELF_STUDY_LABELS[language][selfStudy] };

    if (!(rawType || '').trim()) return null;

    const kind = detectLessonTypeKind(rawType, extraText);
    if (kind === 'other') {
        return fallbackLabel ? { label: fallbackLabel, description: null } : null;
    }
    return { label: LESSON_TYPE_LABELS[language][kind], description: null };
}

/** Plain display label for contexts without a badge (notifications, copy-to-clipboard). */
export function getLessonTypeLabel(
    rawType: string | null | undefined,
    language: Lang,
    fallbackLabel: string,
): string {
    return getLessonTypeBadge(rawType, null, language, fallbackLabel)?.label ?? '';
}

/** Accent CSS class for the mobile badge (`''` when the type has no accent). */
export function getLessonTypeClass(
    rawType: string | null | undefined,
    extraText?: string | null,
): string {
    if (detectSelfStudyKind(rawType, extraText)) return 'srs';
    const kind = detectLessonTypeKind(rawType, extraText);
    return kind === 'other' ? '' : LESSON_TYPE_CLASSES[kind];
}
