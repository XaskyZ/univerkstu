/**
 * Personal lessons stored in localStorage and merged with the main schedule.
 */

export type CustomLessonType = 'srsp' | 'curator_hour' | 'other';

const LEGACY_TYPE_MAP: Record<string, CustomLessonType> = {
    'СРСП': 'srsp',
    'Кураторский час': 'curator_hour',
    'Другое': 'other',
};

export interface CustomLesson {
    id: string;
    title: string;
    type: CustomLessonType;
    teacher: string;
    room: string;
    dayIndex: number;
    timeSlotIndex: number;
    customStart?: string;
    customEnd?: string;
    parity: 'all' | 'num' | 'den';
    createdAt: number;
}

const STORAGE_KEY = 'custom-lessons-v1';

function normalizeLessonType(value: unknown): CustomLessonType {
    if (value === 'srsp' || value === 'curator_hour' || value === 'other') {
        return value;
    }
    if (typeof value === 'string' && value in LEGACY_TYPE_MAP) {
        return LEGACY_TYPE_MAP[value];
    }
    return 'other';
}

function normalizeLesson(raw: unknown): CustomLesson | null {
    if (!raw || typeof raw !== 'object') return null;
    const lesson = raw as Partial<CustomLesson> & { type?: unknown };
    if (typeof lesson.id !== 'string' || typeof lesson.title !== 'string') return null;

    return {
        id: lesson.id,
        title: lesson.title,
        type: normalizeLessonType(lesson.type),
        teacher: typeof lesson.teacher === 'string' ? lesson.teacher : '',
        room: typeof lesson.room === 'string' ? lesson.room : '',
        dayIndex: typeof lesson.dayIndex === 'number' ? lesson.dayIndex : 0,
        timeSlotIndex: typeof lesson.timeSlotIndex === 'number' ? lesson.timeSlotIndex : 0,
        customStart: typeof lesson.customStart === 'string' ? lesson.customStart : undefined,
        customEnd: typeof lesson.customEnd === 'string' ? lesson.customEnd : undefined,
        parity: lesson.parity === 'num' || lesson.parity === 'den' ? lesson.parity : 'all',
        createdAt: typeof lesson.createdAt === 'number' ? lesson.createdAt : Date.now(),
    };
}

function readAll(): CustomLesson[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const normalized = parsed.map(normalizeLesson).filter(Boolean) as CustomLesson[];
        if (normalized.length !== parsed.length || JSON.stringify(normalized) !== JSON.stringify(parsed)) {
            writeAll(normalized);
        }
        return normalized;
    } catch {
        return [];
    }
}

function writeAll(lessons: CustomLesson[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons));
    } catch {
        // localStorage full
    }
}

export function getCustomLessons(): CustomLesson[] {
    return readAll();
}

export function addCustomLesson(lesson: Omit<CustomLesson, 'id' | 'createdAt'>): CustomLesson {
    const all = readAll();
    const newLesson: CustomLesson = {
        ...lesson,
        type: normalizeLessonType(lesson.type),
        id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
    };
    all.push(newLesson);
    writeAll(all);
    return newLesson;
}

export function updateCustomLesson(id: string, updates: Partial<Omit<CustomLesson, 'id' | 'createdAt'>>): CustomLesson | null {
    const all = readAll();
    const index = all.findIndex(l => l.id === id);
    if (index === -1) return null;
    all[index] = {
        ...all[index],
        ...updates,
        type: updates.type !== undefined ? normalizeLessonType(updates.type) : all[index].type,
    };
    writeAll(all);
    return all[index];
}

export function deleteCustomLesson(id: string): boolean {
    const all = readAll();
    const filtered = all.filter(l => l.id !== id);
    if (filtered.length === all.length) return false;
    writeAll(filtered);
    return true;
}
