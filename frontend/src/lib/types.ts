/**
 * Типы данных для frontend
 */

export interface TimeSlot {
    start: string;
    end: string;
    raw: string;
    segments?: Array<{
        start: string;
        end: string;
    }>;
}

export interface Lesson {
    title: string;
    type: string | null;
    teacher: string;
    teacherName?: string;
    teacherUrl?: string;
    room: string | null;
    faculty: string | null;
    parity: 'all' | 'num' | 'den';
    period: string | null;
    rawParams?: string;
    customTime?: {
        start: string;
        end: string;
    } | null;
}

export interface DaySchedule {
    name: string;
    lessons: Lesson[][];
}

export interface Schedule {
    meta: {
        tz: string;
        parsedAt: string;
        userId: string;
    };
    timeSlots: TimeSlot[];
    days: DaySchedule[];
    cachedAt: string;
    expiresAt: string;
}

export interface ExamDateTime {
    date: string;
    time: string;
    displayDate: string;
    displayTime: string;
    iso: string;
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
    type: string;
    format: string;
    building: string;
    room: string;
    locationRaw: string;
    groupType: string;
    datetime: ExamDateTime | null;
    /**
     * Boolean meta flags propagated by the backend exams parser
     * (Platonus v7: `onlineExam`, `additional`, `finalExam`, `stateExam`).
     * Optional — older cached payloads may not include this field.
     */
    flags?: ExamFlags;
}

export interface Exams {
    exams: Exam[];
    meta: {
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
    };
    cachedAt: string;
    expiresAt: string;
}

export interface User {
    userId: string;
    settings?: {
        language: 'ru' | 'kz' | 'en';
        notifications: boolean;
        theme: 'light' | 'dark' | 'system';
        leaderboardDisplayName?: string;
    };
}

// Названия дней недели
export const DAY_NAMES: Record<string, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
};

// Цвета для типов занятий
export const LESSON_TYPE_COLORS: Record<string, string> = {
    Lecture: 'bg-blue-100 text-blue-800 border-blue-200',
    Seminar: 'bg-green-100 text-green-800 border-green-200',
    Laboratory: 'bg-purple-100 text-purple-800 border-purple-200',
    Practice: 'bg-orange-100 text-orange-800 border-orange-200',
    'Лекция': 'bg-blue-100 text-blue-800 border-blue-200',
    'Семинар': 'bg-green-100 text-green-800 border-green-200',
    'Лабораторное занятие': 'bg-purple-100 text-purple-800 border-purple-200',
    'Практика': 'bg-orange-100 text-orange-800 border-orange-200',
};

// Цвета для чётности недели
export const PARITY_COLORS: Record<string, string> = {
    all: '',
    num: 'border-l-4 border-l-green-500',
    den: 'border-l-4 border-l-orange-500',
};

export const PARITY_LABELS: Record<string, string> = {
    all: '',
    num: 'Numerator',
    den: 'Denominator',
};

// === UMKD Types ===

export interface UMKDFile {
    id: string;
    name: string;
    url: string;
    fileId?: string;        // ID файла в GridFS
    downloadUrl?: string;   // URL для скачивания с нашего сервера (GridFS)
    localUrl?: string;      // Устаревшее - для обратной совместимости
    teacher?: string;
    type?: string;
    lang?: string;
    size?: string;
    uploaded?: string;
    downloads?: string;
    downloadStatus?: string;
    /**
     * Phase 2 classifier output. Backend tags every file with the result of
     * `classifyUmkdMaterial` so the frontend can surface "Экз. вопросы" badges
     * without re-running the heuristic.
     */
    examClassification?: {
        kind: 'exam-questions' | 'other';
        confidence: 'strong' | 'medium' | 'weak' | 'none';
        reason: string;
    };
}

export interface UMKDCourse {
    id: string;
    name: string;
    kind?: string;
    files: UMKDFile[];
    isEmpty?: boolean;
}

export interface UMKD {
    courses: UMKDCourse[];
    /**
     * Optional pre-classified bucket of exam-question files grouped by subject.
     * Populated by the backend (Agent A, Phase 2). May be `undefined` while the
     * feature is rolling out — consumers should treat absence as "no data".
     */
    examQuestionsBySubject?: UmkdExamQuestionsForSubject[];
    meta: {
        parsedAt: string;
        totalCourses: number;
        totalFiles: number;
        userId: string;
    };
    cachedAt?: string;
    expiresAt?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// UMKD Exam Questions (Phase 2)
//
// These types mirror the backend classifier output. If Agent A (backend) lands
// the same `UmkdExamQuestionFile` / `UmkdExamQuestionsForSubject` definitions
// here, this stub and Agent A's version must remain structurally identical.
// ──────────────────────────────────────────────────────────────────────────

export type UmkdExamQuestionConfidence = 'strong' | 'medium' | 'weak';

export interface UmkdExamQuestionFile {
    id?: string;       // KSTU row id (e.g. "388803") — display/key only
    fileId?: string;   // Storage ObjectId — used for /parsed endpoint + downloads
    title: string;
    filename?: string;
    category?: string;
    extension?: string;
    mimeType?: string;
    size?: string;
    updatedAt?: string;
    downloadUrl?: string;
    openUrl?: string;
    confidence: UmkdExamQuestionConfidence;
    matchReason: string;
}

export interface UmkdExamQuestionsForSubject {
    subjectId?: string;
    subjectName: string;
    subjectCode?: string;
    fileCount: number;
    files: UmkdExamQuestionFile[];
}
