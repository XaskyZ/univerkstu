/**
 * Типы данных для UniverSchedule v4.0
 */

// === User Types ===
export interface User {
    _id?: string;
    userId: string; // username (логин KSTU)
    passwordEncrypted: string;
    createdAt: Date;
    lastLogin: Date;
    settings?: UserSettings;
}

export interface ExamRemindersSettings {
    enabled: boolean;
    oneDay: boolean;
    oneHour: boolean;
}

export type AppThemeId =
    | 'light'
    | 'dark'
    | 'system'
    | 'deep-blue'
    | 'aurora'
    | 'sunset'
    | 'matrix'
    | 'pastel'
    | 'referral-nebula'
    | 'referral-sherbet'
    | 'supporter-midnight'
    | 'supporter-paper';

export interface UserSettings {
    language: 'ru' | 'kz' | 'en';
    notifications: boolean;
    theme: AppThemeId;
    leaderboardDisplayName?: string;
    leaderboardContacts?: {
        telegram?: string;
        instagram?: string;
    };
    dmPrivacy?: 'friends_only' | 'open';
    /** Opt out of the subject grade leaderboard (default: shown). */
    gradesLeaderboardOptOut?: boolean;
    examReminders?: ExamRemindersSettings;
}

export const DEFAULT_EXAM_REMINDERS: ExamRemindersSettings = {
    enabled: true,
    oneDay: true,
    oneHour: true,
};

// === Schedule Types ===
export interface TimeSlot {
    start: string; // "08:00"
    end: string;   // "09:50"
    raw?: string;
    segments?: Array<{
        start: string;
        end: string;
    }>;
}

export interface Lesson {
    title: string;
    type: string | null;    // "Лек", "Практ", "Лаб"
    teacher: string;
    teacherName?: string;
    teacherUrl?: string;
    room: string | null;
    faculty: string | null;
    parity: 'all' | 'num' | 'den';  // все/числитель/знаменатель
    period: string | null;
    rawParams?: string;
}

export interface DaySchedule {
    name: string;  // "mon", "tue", etc.
    lessons: Lesson[][];  // Массив слотов, каждый слот может иметь несколько занятий
}

export interface ScheduleMeta {
    tz: string;
    parsedAt: string;
    userId: string;
    /**
     * Откуда спарсено расписание: всегда 'platonus' (v7 REST) — univer.kstu.kz
     * закрыт, фолбэка нет. Опционально — старые записи в кэше этого поля не
     * имеют (они были спарсены с Univer).
     */
    source?: 'platonus';
    /**
     * Информация о семестре, из которого спарсено расписание (новая разметка
     * myschedule: /student/myschedule/{год}/{семестр}). Опционально — старые
     * записи в кэше этого поля не имеют.
     */
    semester?: {
        year: number;          // учебный год (2026 = 2026-2027)
        term: number;          // 1 = осенний, 2 = весенний
        title?: string;        // заголовок семестра с портала
        /** false, если текущий семестр не опубликован и показан фолбэк (прошлый семестр). */
        isCurrent?: boolean;
    };
}

export interface Schedule {
    _id?: string;
    userId: string;
    meta: ScheduleMeta;
    timeSlots: TimeSlot[];
    days: DaySchedule[];
    cachedAt: Date;
    expiresAt: Date;
}

// === Exams Types ===
export interface ExamDateTime {
    date: string;       // "2025-01-15"
    time: string;       // "09:00"
    displayDate: string;  // "15.01.2025"
    displayTime: string;  // "09:00"
    iso: string;        // ISO timestamp
}

export interface ExamFlags {
    online?: boolean;
    additional?: boolean;
    final?: boolean;
    state?: boolean;
}

export interface Exam {
    subject: string;
    teacher: string;
    type: string;       // "Экзамен", "Диф.зачёт"
    format: string;     // "письменный", "устный"
    building: string;
    room: string;
    locationRaw: string;
    groupType: string;
    datetime: ExamDateTime | null;
    /**
     * Boolean flags surfaced by Platonus v7 (`onlineExam`, `additional`,
     * `finalExam`, `stateExam`). Optional for backward compatibility with
     * cached payloads that predate this field.
     */
    flags?: ExamFlags;
}

export interface ExamsMeta {
    parsedAt: string;
    totalExams: number;
    semesterInfo?: {
        title?: string;
    };
    academicMilestones?: Array<{
        label: string;
        kind: 'midterm_1' | 'midterm_2' | 'exams' | 'state_exams';
        start: string;
        end: string;
        weeks: number | null;
        segmentLabel: string;
        active: boolean;
        upcoming: boolean;
    }>;
    userId: string;
}

export interface Exams {
    _id?: string;
    userId: string;
    exams: Exam[];
    meta: ExamsMeta;
    cachedAt: Date;
    expiresAt: Date;
}

// === UMKD Types ===
export interface UmkdFile {
    name: string;
    url: string;
    type: string;
}

export interface UmkdSection {
    title: string;
    files: UmkdFile[];
}

export interface UmkdSubject {
    id: string;
    name: string;
    sections: UmkdSection[];
}

export interface Umkd {
    _id?: string;
    userId: string;
    subjects: UmkdSubject[];
    cachedAt: Date;
    expiresAt: Date;
}

// === Parser Types ===
export interface ParseResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    html?: string;
    screenshotPath?: string;
}

// === Cache Config ===
export const CACHE_TTL = {
    SCHEDULE: 7 * 24 * 60 * 60 * 1000,  // 7 дней (расписание меняется редко)
    EXAMS: 7 * 24 * 60 * 60 * 1000,     // 7 дней
    UMKD: 30 * 24 * 60 * 60 * 1000,     // 30 дней (UMKD почти не меняется)
} as const;
