import { UMKDCourse, UMKDFile } from '@/lib/types';
import { classifyMime, UmkdFileType } from './file-type';

export const UMKD_FILE_TYPES: readonly UmkdFileType[] = [
    'pdf',
    'doc',
    'ppt',
    'excel',
    'archive',
    'other',
] as const;

export type UmkdSort =
    | 'name-asc'
    | 'date-desc'
    | 'date-asc'
    | 'size-desc'
    | 'size-asc';

export const UMKD_SORTS: readonly UmkdSort[] = [
    'name-asc',
    'date-desc',
    'date-asc',
    'size-desc',
    'size-asc',
] as const;

export interface UmkdFilterState {
    query: string;
    types: UmkdFileType[]; // empty array means "all types" (same as full set)
    sort: UmkdSort;
}

export const DEFAULT_FILTER_STATE: UmkdFilterState = {
    query: '',
    types: [],
    sort: 'name-asc',
};

/* ─────────────────────────────────────────────────────────────
 * URL <-> state serialization
 * ───────────────────────────────────────────────────────────── */

export function parseFilterState(params: URLSearchParams): UmkdFilterState {
    const query = (params.get('q') ?? '').trim();

    const rawType = params.get('type') ?? '';
    const requested = rawType
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is UmkdFileType =>
            (UMKD_FILE_TYPES as readonly string[]).includes(s)
        );
    // Deduplicate while preserving the canonical order.
    const types = UMKD_FILE_TYPES.filter((t) => requested.includes(t));

    const rawSort = params.get('sort');
    const sort: UmkdSort = (UMKD_SORTS as readonly string[]).includes(rawSort ?? '')
        ? (rawSort as UmkdSort)
        : DEFAULT_FILTER_STATE.sort;

    return { query, types, sort };
}

/**
 * Write the filter state to a URLSearchParams clone, removing keys when their
 * value is the default (so the URL stays clean when no filter is active).
 */
export function serializeFilterState(
    base: URLSearchParams,
    state: UmkdFilterState
): URLSearchParams {
    const out = new URLSearchParams(base);

    if (state.query) {
        out.set('q', state.query);
    } else {
        out.delete('q');
    }

    const allSelected =
        state.types.length === 0 || state.types.length === UMKD_FILE_TYPES.length;
    if (allSelected) {
        out.delete('type');
    } else {
        out.set('type', state.types.join(','));
    }

    if (state.sort && state.sort !== DEFAULT_FILTER_STATE.sort) {
        out.set('sort', state.sort);
    } else {
        out.delete('sort');
    }

    return out;
}

/* ─────────────────────────────────────────────────────────────
 * Parsing helpers for sort by size/date
 * ───────────────────────────────────────────────────────────── */

/**
 * Parse a free-form "size" string (e.g. "120 KB", "1,5 МБ", "2.3 MB") into a
 * byte count. Returns 0 when the value can't be interpreted — callers treat 0
 * as "unknown" for sort fallback purposes.
 */
export function parseSizeToBytes(raw: string | undefined | null): number {
    if (!raw) return 0;
    const normalized = String(raw).replace(',', '.').trim();
    const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([a-zа-яА-Я]*)/i);
    if (!match) return 0;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) return 0;
    const unit = (match[2] || '').toLowerCase();

    if (!unit || unit.startsWith('b') || unit.startsWith('б')) return value;
    if (unit.startsWith('k') || unit.startsWith('к')) return value * 1024;
    if (unit.startsWith('m') || unit.startsWith('м')) return value * 1024 * 1024;
    if (unit.startsWith('g') || unit.startsWith('г')) return value * 1024 * 1024 * 1024;
    return value;
}

/**
 * Parse a date-ish string (ISO, or "DD.MM.YYYY HH:MM") into a unix-ms timestamp.
 * Returns 0 if it can't be parsed.
 */
export function parseDateToMs(raw: string | undefined | null): number {
    if (!raw) return 0;
    const trimmed = String(raw).trim();
    if (!trimmed) return 0;

    // DD.MM.YYYY or DD.MM.YYYY HH:MM
    const dotMatch = trimmed.match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (dotMatch) {
        const [, d, mo, y, h, mi, s] = dotMatch;
        const ts = Date.UTC(
            Number(y),
            Number(mo) - 1,
            Number(d),
            Number(h ?? '0'),
            Number(mi ?? '0'),
            Number(s ?? '0')
        );
        return Number.isFinite(ts) ? ts : 0;
    }

    const ts = Date.parse(trimmed);
    return Number.isFinite(ts) ? ts : 0;
}

/* ─────────────────────────────────────────────────────────────
 * Filtering & sorting
 * ───────────────────────────────────────────────────────────── */

function normalize(s: string | undefined | null): string {
    return (s ?? '').toLocaleLowerCase().trim();
}

function fileMatchesType(file: UMKDFile, allowed: Set<UmkdFileType>): boolean {
    if (allowed.size === 0) return true;
    const kind = classifyMime(file.type, file.name);
    return allowed.has(kind);
}

function fileMatchesQuery(file: UMKDFile, query: string, courseName: string): boolean {
    if (!query) return true;
    const q = normalize(query);
    return (
        normalize(file.name).includes(q) ||
        normalize(courseName).includes(q)
    );
}

/**
 * Apply filter+sort to a list of UMKD courses. Returns:
 *  - `courses` — visible courses (each with its files narrowed to those that
 *    still pass the file-type filter), in the requested sort order
 *  - `visibleFileCount` / `totalFileCount` — counts for the toolbar status row
 */
export interface FilterResult {
    courses: UMKDCourse[];
    visibleFileCount: number;
    totalFileCount: number;
}

export function applyFilter(
    courses: readonly UMKDCourse[],
    state: UmkdFilterState
): FilterResult {
    const allowed = new Set<UmkdFileType>(
        state.types.length === UMKD_FILE_TYPES.length ? [] : state.types
    );
    const q = state.query.trim();
    const courseNameQueryActive = q.length > 0;

    let totalFileCount = 0;
    let visibleFileCount = 0;

    const filtered: UMKDCourse[] = [];
    for (const course of courses) {
        totalFileCount += course.files.length;

        // First narrow by type.
        const typeMatched = allowed.size === 0
            ? course.files
            : course.files.filter((f) => fileMatchesType(f, allowed));

        // Then apply the search query. A course is visible if either its
        // name matches OR at least one type-matched file matches.
        const courseNameMatches = courseNameQueryActive
            ? normalize(course.name).includes(normalize(q))
            : false;

        let visibleFiles: UMKDFile[];
        if (!courseNameQueryActive) {
            visibleFiles = typeMatched;
        } else if (courseNameMatches) {
            // If the course name itself matches, surface all type-matched
            // files (so the user sees the whole course they searched for).
            visibleFiles = typeMatched;
        } else {
            visibleFiles = typeMatched.filter((f) =>
                fileMatchesQuery(f, q, course.name)
            );
        }

        // Keep a course tile if it still has files OR the user's query hit
        // the course name (even with zero matching files we still want to
        // surface the course they searched for, IF it had any files to begin
        // with; an empty placeholder course should still be hidden so we
        // don't surprise users).
        const keepEmptyDueToNameMatch =
            courseNameMatches && course.files.length > 0;

        if (visibleFiles.length > 0 || keepEmptyDueToNameMatch) {
            filtered.push({ ...course, files: visibleFiles });
            visibleFileCount += visibleFiles.length;
        }
    }

    return {
        courses: sortCourses(filtered, state.sort),
        visibleFileCount,
        totalFileCount,
    };
}

function latestFileMs(course: UMKDCourse): number {
    let best = 0;
    for (const f of course.files) {
        const ts = parseDateToMs(f.uploaded);
        if (ts > best) best = ts;
    }
    return best;
}

function totalSizeBytes(course: UMKDCourse): number {
    let total = 0;
    for (const f of course.files) {
        total += parseSizeToBytes(f.size);
    }
    return total;
}

function sortCourses(courses: UMKDCourse[], sort: UmkdSort): UMKDCourse[] {
    const out = courses.slice();
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

    switch (sort) {
        case 'name-asc':
            out.sort((a, b) => collator.compare(a.name, b.name));
            break;
        case 'date-desc':
            out.sort((a, b) => latestFileMs(b) - latestFileMs(a) || collator.compare(a.name, b.name));
            break;
        case 'date-asc':
            out.sort((a, b) => {
                const av = latestFileMs(a);
                const bv = latestFileMs(b);
                // Push courses with unknown date (0) to the end in ascending order.
                if (av === 0 && bv === 0) return collator.compare(a.name, b.name);
                if (av === 0) return 1;
                if (bv === 0) return -1;
                return av - bv;
            });
            break;
        case 'size-desc':
            out.sort((a, b) => totalSizeBytes(b) - totalSizeBytes(a) || collator.compare(a.name, b.name));
            break;
        case 'size-asc':
            out.sort((a, b) => {
                const av = totalSizeBytes(a);
                const bv = totalSizeBytes(b);
                if (av === 0 && bv === 0) return collator.compare(a.name, b.name);
                if (av === 0) return 1;
                if (bv === 0) return -1;
                return av - bv;
            });
            break;
        default:
            // exhaustive — typed UmkdSort.
            break;
    }

    return out;
}

export function isFilterActive(state: UmkdFilterState): boolean {
    if (state.query.trim()) return true;
    if (state.types.length > 0 && state.types.length < UMKD_FILE_TYPES.length) {
        return true;
    }
    if (state.sort !== DEFAULT_FILTER_STATE.sort) return true;
    return false;
}
