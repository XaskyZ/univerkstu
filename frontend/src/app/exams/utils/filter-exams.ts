import type { Exam } from '@/lib/types';

/** Lowercased, concatenated searchable text for one exam. */
function examHaystack(exam: Exam): string {
    return [exam.subject, exam.teacher, exam.room, exam.building, exam.type, exam.format]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

/**
 * Filter exams by a free-text query matched against subject, teacher, room,
 * building, type and format. Every whitespace-separated token must be present
 * (AND semantics), so "math 305" matches an exam whose text contains both.
 * An empty/whitespace query returns the list unchanged.
 */
export function filterExams(exams: Exam[], query: string): Exam[] {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return exams;
    return exams.filter((exam) => {
        const text = examHaystack(exam);
        return tokens.every((token) => text.includes(token));
    });
}
