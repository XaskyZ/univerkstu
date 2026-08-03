import { CacheKeys, getFromCache } from '@/lib/cache';
import type { PlatonusGradesData, PlatonusSubjectGrade } from '@/lib/api';
import type { Schedule } from '@/lib/types';
import { parseScoreValue } from '@/app/grades/utils/grades-helpers';

/**
 * Stats are fully client-side: we aggregate from caches that other pages already
 * populated (schedule + Platonus grades). No new endpoints, no new storage.
 * If a cache slice is missing we simply omit that section.
 */

export interface ScheduleStats {
    totalSubjects: number;
    totalLessonsPerWeek: number;
    perDay: Array<{ day: string; count: number }>;
    topTeachers: Array<{ name: string; count: number }>;
    topRooms: Array<{ room: string; count: number }>;
}

export interface LetterDistributionEntry {
    letter: 'A' | 'B' | 'C' | 'D' | 'F';
    count: number;
}

export interface GradesStats {
    semesterLabel: string;
    parsedAt?: string;
    gpa?: number;
    overallGpa?: number;
    totalSubjects: number;
    averageScore: number | null;
    excellentCount: number; // >= 90
    letterDistribution: LetterDistributionEntry[];
    topSubjects: Array<{ name: string; score: number }>;
    worstSubjects: Array<{ name: string; score: number }>;
    /** Term/course GPA history pulled straight from Platonus transcript meta. */
    termGpaMap?: Record<string, number>;
    courseGpaMap?: Record<string, number>;
}

/**
 * Map a numeric percent (0..100) to a coarse letter band used in stats UI.
 * Frontend does not store letters from Platonus — this is a derived view only.
 */
export function scoreToLetter(score: number): LetterDistributionEntry['letter'] {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
}

function normalizeName(value: string | undefined | null): string {
    if (!value) return '';
    return value.trim().replace(/\s+/g, ' ');
}

/**
 * Read the cached schedule (whatever the user last loaded on `/schedule`).
 * Returns null when no cache has been written yet — caller renders empty state.
 */
export function readCachedSchedule(): Schedule | null {
    return getFromCache<Schedule>(CacheKeys.SCHEDULE);
}

/**
 * Walks `localStorage` for any `cache_platonus_grades_<year>_<sem>` blob and
 * returns the most recently cached one (newest `meta.parsedAt`). We don't
 * import `gradesCacheKey` directly because the user may have multiple
 * semesters cached and we want the freshest.
 */
export function readCachedGradesData(): PlatonusGradesData | null {
    if (typeof window === 'undefined') return null;

    let best: PlatonusGradesData | null = null;
    let bestTs = -Infinity;

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('cache_platonus_grades_')) continue;
            // strip leading "cache_" then read via cache helper to validate version
            const cacheKey = key.slice('cache_'.length);
            const data = getFromCache<PlatonusGradesData>(cacheKey);
            if (!data || !data.meta) continue;
            const parsed = Date.parse(data.meta.parsedAt || '');
            const ts = Number.isFinite(parsed) ? parsed : 0;
            if (ts >= bestTs) {
                bestTs = ts;
                best = data;
            }
        }
    } catch {
        return best;
    }

    return best;
}

export function computeScheduleStats(schedule: Schedule): ScheduleStats | null {
    if (!schedule || !Array.isArray(schedule.days)) return null;

    const subjectSet = new Set<string>();
    const teacherCounts = new Map<string, number>();
    const roomCounts = new Map<string, number>();
    const perDay: Array<{ day: string; count: number }> = [];

    let totalLessons = 0;

    for (const day of schedule.days) {
        let dayLessons = 0;
        const slots = Array.isArray(day.lessons) ? day.lessons : [];

        for (const slot of slots) {
            const lessons = Array.isArray(slot) ? slot : [];
            for (const lesson of lessons) {
                if (!lesson || !lesson.title) continue;

                const title = normalizeName(lesson.title);
                if (title) subjectSet.add(title);

                dayLessons += 1;
                totalLessons += 1;

                const teacher = normalizeName(lesson.teacherName || lesson.teacher);
                if (teacher) {
                    teacherCounts.set(teacher, (teacherCounts.get(teacher) || 0) + 1);
                }

                const room = normalizeName(lesson.room || '');
                if (room) {
                    roomCounts.set(room, (roomCounts.get(room) || 0) + 1);
                }
            }
        }

        perDay.push({ day: normalizeName(day.name) || '—', count: dayLessons });
    }

    if (totalLessons === 0 && subjectSet.size === 0) return null;

    const topTeachers = [...teacherCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 3);

    const topRooms = [...roomCounts.entries()]
        .map(([room, count]) => ({ room, count }))
        .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room))
        .slice(0, 3);

    return {
        totalSubjects: subjectSet.size,
        totalLessonsPerWeek: totalLessons,
        perDay,
        topTeachers,
        topRooms,
    };
}

/**
 * Pick the "best" displayable score for a subject for stats purposes:
 *   1. `total` if numeric (final score),
 *   2. otherwise `rating` if numeric (current semester rating),
 *   3. otherwise null — subject is skipped from averages/distributions.
 *
 * We intentionally ignore single RK columns so we don't double-count subjects
 * that already have a `total`.
 */
function pickSubjectScore(subject: PlatonusSubjectGrade): number | null {
    const total = parseScoreValue(subject.total);
    if (total.kind === 'number' && total.value !== null && total.value > 0) {
        return total.value;
    }
    const rating = parseScoreValue(subject.rating);
    if (rating.kind === 'number' && rating.value !== null && rating.value > 0) {
        return rating.value;
    }
    return null;
}

function buildSemesterLabel(year: number, semester: number, season: string): string {
    return `${year}/${year + 1} · ${season} (${semester})`;
}

export function computeGradesStats(
    data: PlatonusGradesData | null,
    seasonLabels: { autumn: string; spring: string }
): GradesStats | null {
    if (!data || !Array.isArray(data.subjects) || data.subjects.length === 0) return null;

    const scored: Array<{ name: string; score: number }> = [];
    const letterCounts: Record<LetterDistributionEntry['letter'], number> = {
        A: 0,
        B: 0,
        C: 0,
        D: 0,
        F: 0,
    };

    for (const subject of data.subjects) {
        const score = pickSubjectScore(subject);
        if (score === null) continue;
        const name = normalizeName(subject.name) || '—';
        scored.push({ name, score });
        const letter = scoreToLetter(score);
        letterCounts[letter] += 1;
    }

    if (scored.length === 0) {
        // Subjects exist but no numeric scores — skip the section entirely.
        return null;
    }

    const sum = scored.reduce((acc, item) => acc + item.score, 0);
    const averageScore = sum / scored.length;

    const sortedByScore = [...scored].sort(
        (a, b) => b.score - a.score || a.name.localeCompare(b.name)
    );
    const topSubjects = sortedByScore.slice(0, 3);
    const worstSubjects = [...scored]
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
        .slice(0, 3);

    const letterDistribution: LetterDistributionEntry[] = (
        ['A', 'B', 'C', 'D', 'F'] as const
    ).map((letter) => ({ letter, count: letterCounts[letter] }));

    const season = data.meta.semester === 1 ? seasonLabels.autumn : seasonLabels.spring;
    const semesterLabel = buildSemesterLabel(data.meta.year, data.meta.semester, season);

    return {
        semesterLabel,
        parsedAt: data.meta.parsedAt,
        gpa: data.meta.gpa,
        overallGpa: data.meta.overallGpa,
        totalSubjects: data.meta.totalSubjects ?? data.subjects.length,
        averageScore,
        excellentCount: letterCounts.A,
        letterDistribution,
        topSubjects,
        worstSubjects,
        termGpaMap: data.meta.termGpaMap,
        courseGpaMap: data.meta.courseGpaMap,
    };
}

/**
 * Tone tokens for letter buckets in the donut + chips. We map to the same
 * semantic status tokens the grades page already uses so a colorblind
 * accessibility tweak there propagates here for free.
 */
export function letterTone(letter: LetterDistributionEntry['letter']) {
    if (letter === 'A') {
        return {
            bg: 'var(--status-success-bg)',
            color: 'var(--status-success-color)',
            border: 'var(--status-success-border)',
            solid: 'rgba(var(--status-success-rgb), 0.85)',
        };
    }
    if (letter === 'B') {
        return {
            bg: 'var(--status-info-bg)',
            color: 'var(--status-info-color)',
            border: 'var(--status-info-border)',
            solid: 'rgba(var(--status-info-rgb), 0.85)',
        };
    }
    if (letter === 'C') {
        return {
            bg: 'var(--status-warning-bg)',
            color: 'var(--status-warning-color)',
            border: 'var(--status-warning-border)',
            solid: 'rgba(var(--status-warning-rgb), 0.85)',
        };
    }
    if (letter === 'D') {
        return {
            bg: 'var(--status-warning-bg)',
            color: 'var(--status-warning-color)',
            border: 'var(--status-warning-border)',
            solid: 'rgba(var(--status-warning-rgb), 0.65)',
        };
    }
    return {
        bg: 'var(--status-danger-bg)',
        color: 'var(--status-danger-color)',
        border: 'var(--status-danger-border)',
        solid: 'rgba(var(--status-danger-rgb), 0.85)',
    };
}
