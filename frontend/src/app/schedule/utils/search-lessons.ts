import type { Lesson } from '@/lib/types';

/** A lesson that matched a search query, with its position in the week. */
export interface LessonSearchHit {
    /** Day key, e.g. 'mon'. */
    dayKey: string;
    /** Index into `schedule.timeSlots`. */
    slotIndex: number;
    /** Index of the lesson within its time slot (for stable note keys). */
    lessonIndex: number;
    lesson: Lesson;
}

/** Lowercased, concatenated searchable text for one lesson. */
function lessonHaystack(lesson: Lesson): string {
    return [lesson.title, lesson.type, lesson.teacher, lesson.teacherName, lesson.room, lesson.faculty]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

/**
 * True when the lesson matches every whitespace-separated token in `query`
 * (AND semantics), matched against title, type, teacher, room and faculty.
 * An empty query matches nothing (search is considered inactive).
 */
export function lessonMatchesQuery(lesson: Lesson, query: string): boolean {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const text = lessonHaystack(lesson);
    return tokens.every((token) => text.includes(token));
}

/**
 * Flatten the week's lessons to those matching the query, preserving day and
 * time-slot order. Returns an empty array for an empty/whitespace query so the
 * caller can fall back to the normal weekly/daily view.
 */
export function searchLessons(
    days: ReadonlyArray<{ name: string; lessons: Lesson[][] }>,
    query: string,
): LessonSearchHit[] {
    if (query.trim().length === 0) return [];
    const hits: LessonSearchHit[] = [];
    for (const day of days) {
        day.lessons.forEach((slot, slotIndex) => {
            slot.forEach((lesson, lessonIndex) => {
                if (lessonMatchesQuery(lesson, query)) {
                    hits.push({ dayKey: day.name, slotIndex, lessonIndex, lesson });
                }
            });
        });
    }
    return hits;
}
