/**
 * Pure helpers for the GPA timeline chart.
 *
 * Input shape comes from Platonus /rest/transcript/load via GradesMeta:
 * - termGpaMap: Record<"2024-1" | "2024-2" | ..., number>
 * - courseGpaMap: Record<"1" | "2" | "3" | "4", number>
 *
 * We normalize keys into a sortable form and emit chart-ready points.
 */

export type TimelineMode = 'term' | 'course';

export interface TimelinePoint {
    rawKey: string;
    label: string;
    value: number;
    /** Normalized x position 0..1 used to lay out the polyline. */
    x: number;
    /** Normalized y position 0..1 with 0 at bottom of plot (gpa 0) and 1 at top (gpa 4). */
    y: number;
    sortKey: number;
}

/**
 * Parse the term key Platonus emits. Common patterns:
 *   "2024-1"  → { year: 2024, semester: 1 }
 *   "2024-2"  → { year: 2024, semester: 2 }
 *   "2024/1"  → same
 *   single number like "1" → fall back so we still get a sortable result
 */
export function parseTermKey(raw: string): { year: number; semester: number } | null {
    const match = raw.match(/^(\d{4})[\s\-_/.](\d)$/);
    if (match) {
        return { year: Number(match[1]), semester: Number(match[2]) };
    }
    const singleNumeric = raw.match(/^\d+$/);
    if (singleNumeric) {
        // Cannot parse as term — caller should treat as course-style label.
        return null;
    }
    return null;
}

export function formatTermLabel(parsed: { year: number; semester: number }): string {
    return `${parsed.year}/${parsed.semester}`;
}

/**
 * Build a sorted, normalized list of points from a raw GPA map.
 *
 * mode='term' parses keys as "YYYY-S"; mode='course' treats keys as course
 * numbers (1..4). Invalid entries are dropped silently. Returns [] if no
 * usable entries — caller renders an empty state.
 *
 * yMax defaults to 4 (KSTU 4.0 scale); pass a different ceiling if needed.
 */
export function buildTimelinePoints(
    map: Record<string, number> | undefined | null,
    mode: TimelineMode,
    yMax: number = 4,
): TimelinePoint[] {
    if (!map) return [];

    const entries: Array<{ rawKey: string; label: string; value: number; sortKey: number }> = [];

    for (const [rawKey, rawValue] of Object.entries(map)) {
        const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        if (!Number.isFinite(value) || value <= 0) continue;

        if (mode === 'term') {
            const parsed = parseTermKey(rawKey);
            if (!parsed) continue;
            entries.push({
                rawKey,
                label: formatTermLabel(parsed),
                value,
                sortKey: parsed.year * 10 + parsed.semester,
            });
        } else {
            // course mode: key is a single number
            const courseNumber = Number(rawKey);
            if (!Number.isFinite(courseNumber) || courseNumber <= 0) continue;
            entries.push({
                rawKey,
                label: `${courseNumber} курс`,
                value,
                sortKey: courseNumber,
            });
        }
    }

    if (entries.length === 0) return [];

    entries.sort((a, b) => a.sortKey - b.sortKey);

    const denominator = Math.max(1, entries.length - 1);
    return entries.map((entry, i) => ({
        rawKey: entry.rawKey,
        label: entry.label,
        value: entry.value,
        sortKey: entry.sortKey,
        x: entries.length === 1 ? 0.5 : i / denominator,
        y: Math.min(1, Math.max(0, entry.value / yMax)),
    }));
}

type Language = 'ru' | 'kz' | 'en';

export interface GpaTimelineUi {
    title: string;
    sectionTitle: string;
    termTab: string;
    courseTab: string;
    empty: string;
    legendCurrent: string;
    legendAverage: string;
    yAxisLabel: string;
}

export function getGpaTimelineUi(language: Language): GpaTimelineUi {
    if (language === 'kz') {
        return {
            title: 'GPA динамикасы',
            sectionTitle: 'GPA уақыт бойынша',
            termTab: 'Семестрлер',
            courseTab: 'Курстар',
            empty: 'Platonus әлі тарихты қайтармады',
            legendCurrent: 'Ағымдағы',
            legendAverage: 'Орташа',
            yAxisLabel: 'GPA',
        };
    }
    if (language === 'en') {
        return {
            title: 'GPA over time',
            sectionTitle: 'GPA timeline',
            termTab: 'By term',
            courseTab: 'By course year',
            empty: 'Platonus has not returned history yet',
            legendCurrent: 'Current',
            legendAverage: 'Average',
            yAxisLabel: 'GPA',
        };
    }
    return {
        title: 'Динамика GPA',
        sectionTitle: 'GPA по времени',
        termTab: 'По семестрам',
        courseTab: 'По курсам',
        empty: 'Platonus пока не вернул историю',
        legendCurrent: 'Текущий',
        legendAverage: 'Средний',
        yAxisLabel: 'GPA',
    };
}

/**
 * Average value across points — used as a horizontal reference line on the chart.
 * Returns null if no points.
 */
export function averageOf(points: TimelinePoint[]): number | null {
    if (points.length === 0) return null;
    const sum = points.reduce((acc, p) => acc + p.value, 0);
    return sum / points.length;
}
