import { describe, expect, it } from 'vitest';
import { UMKDCourse } from '@/lib/types';
import {
    applyFilter,
    DEFAULT_FILTER_STATE,
    isFilterActive,
    parseDateToMs,
    parseFilterState,
    parseSizeToBytes,
    serializeFilterState,
    UMKD_FILE_TYPES,
} from './umkd-filters';

function course(overrides: Partial<UMKDCourse> & Pick<UMKDCourse, 'id' | 'name'>): UMKDCourse {
    return {
        files: [],
        ...overrides,
    };
}

describe('parseFilterState', () => {
    it('returns defaults for an empty querystring', () => {
        const s = parseFilterState(new URLSearchParams(''));
        expect(s).toEqual(DEFAULT_FILTER_STATE);
    });

    it('parses q, types and sort', () => {
        const s = parseFilterState(new URLSearchParams('q=алгоритм&type=pdf,doc&sort=date-desc'));
        expect(s.query).toBe('алгоритм');
        expect(s.types).toEqual(['pdf', 'doc']);
        expect(s.sort).toBe('date-desc');
    });

    it('drops unknown type values and unknown sort', () => {
        const s = parseFilterState(new URLSearchParams('type=pdf,nope,doc&sort=lol'));
        expect(s.types).toEqual(['pdf', 'doc']);
        expect(s.sort).toBe(DEFAULT_FILTER_STATE.sort);
    });
});

describe('serializeFilterState', () => {
    it('omits keys whose value equals the default', () => {
        const out = serializeFilterState(new URLSearchParams(''), DEFAULT_FILTER_STATE);
        expect(out.toString()).toBe('');
    });

    it('writes only non-default fields', () => {
        const out = serializeFilterState(
            new URLSearchParams(''),
            { query: 'foo', types: ['pdf'], sort: 'size-desc' }
        );
        const params = new URLSearchParams(out.toString());
        expect(params.get('q')).toBe('foo');
        expect(params.get('type')).toBe('pdf');
        expect(params.get('sort')).toBe('size-desc');
    });

    it('treats "all types selected" as default (no type key)', () => {
        const out = serializeFilterState(new URLSearchParams(''), {
            query: '',
            types: [...UMKD_FILE_TYPES],
            sort: 'name-asc',
        });
        expect(out.has('type')).toBe(false);
    });

    it('preserves unrelated existing query keys', () => {
        const out = serializeFilterState(
            new URLSearchParams('tab=admin'),
            { query: 'x', types: [], sort: 'name-asc' }
        );
        expect(out.get('tab')).toBe('admin');
        expect(out.get('q')).toBe('x');
    });
});

describe('parseSizeToBytes', () => {
    it('parses common size strings', () => {
        expect(parseSizeToBytes('120 KB')).toBe(120 * 1024);
        expect(parseSizeToBytes('1.5 MB')).toBe(1.5 * 1024 * 1024);
        expect(parseSizeToBytes('1,5 МБ')).toBe(1.5 * 1024 * 1024);
        expect(parseSizeToBytes('900 B')).toBe(900);
        expect(parseSizeToBytes('900')).toBe(900);
        expect(parseSizeToBytes('')).toBe(0);
        expect(parseSizeToBytes(undefined)).toBe(0);
    });
});

describe('parseDateToMs', () => {
    it('parses DD.MM.YYYY HH:MM', () => {
        const ts = parseDateToMs('15.02.2024 13:45');
        expect(ts).toBe(Date.UTC(2024, 1, 15, 13, 45, 0));
    });

    it('parses bare DD.MM.YYYY', () => {
        const ts = parseDateToMs('01.01.2025');
        expect(ts).toBe(Date.UTC(2025, 0, 1, 0, 0, 0));
    });

    it('parses ISO strings', () => {
        const ts = parseDateToMs('2024-06-01T10:00:00Z');
        expect(ts).toBe(Date.parse('2024-06-01T10:00:00Z'));
    });

    it('returns 0 for unparseable input', () => {
        expect(parseDateToMs('not-a-date')).toBe(0);
        expect(parseDateToMs('')).toBe(0);
    });
});

describe('applyFilter', () => {
    const courses: UMKDCourse[] = [
        course({
            id: 'c1',
            name: 'Математика',
            files: [
                { id: 'f1', name: 'lecture1.pdf', url: '/x', type: 'application/pdf', size: '120 KB', uploaded: '15.02.2024' },
                { id: 'f2', name: 'sheet.xlsx', url: '/y', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: '50 KB', uploaded: '14.02.2024' },
            ],
        }),
        course({
            id: 'c2',
            name: 'Физика',
            files: [
                { id: 'f3', name: 'slides.pptx', url: '/z', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: '2 MB', uploaded: '01.06.2025' },
            ],
        }),
        course({
            id: 'c3',
            name: 'Программирование',
            files: [
                { id: 'f4', name: 'archive.zip', url: '/a', type: 'application/zip', size: '10 MB', uploaded: '01.01.2026' },
                { id: 'f5', name: 'algoritmy-notes.docx', url: '/b', type: 'application/msword', size: '300 KB', uploaded: '10.05.2026' },
            ],
        }),
    ];

    it('default (no filter) returns every course untouched and sorted by name', () => {
        const result = applyFilter(courses, DEFAULT_FILTER_STATE);
        expect(result.courses.map((c) => c.name)).toEqual([
            'Математика',
            'Программирование',
            'Физика',
        ]);
        expect(result.totalFileCount).toBe(5);
        expect(result.visibleFileCount).toBe(5);
    });

    it('search matches file name and surfaces course tile with matching files only', () => {
        const result = applyFilter(courses, {
            query: 'algoritmy',
            types: [],
            sort: 'name-asc',
        });
        expect(result.courses).toHaveLength(1);
        expect(result.courses[0].name).toBe('Программирование');
        expect(result.courses[0].files.map((f) => f.id)).toEqual(['f5']);
    });

    it('search matches course name case-insensitively and keeps all files in that course', () => {
        const result = applyFilter(courses, {
            query: 'матем',
            types: [],
            sort: 'name-asc',
        });
        expect(result.courses).toHaveLength(1);
        expect(result.courses[0].id).toBe('c1');
        expect(result.courses[0].files).toHaveLength(2);
    });

    it('filter by type drops non-matching files and courses that become empty', () => {
        const result = applyFilter(courses, {
            query: '',
            types: ['pdf'],
            sort: 'name-asc',
        });
        // Only Математика has a PDF — Физика and Программирование have none.
        expect(result.courses.map((c) => c.name)).toEqual(['Математика']);
        expect(result.courses[0].files.map((f) => f.name)).toEqual(['lecture1.pdf']);
    });

    it('sort by date-desc orders by latest uploaded file across each course', () => {
        const result = applyFilter(courses, {
            query: '',
            types: [],
            sort: 'date-desc',
        });
        expect(result.courses.map((c) => c.name)).toEqual([
            'Программирование', // 10.05.2026
            'Физика',           // 01.06.2025
            'Математика',       // 15.02.2024
        ]);
    });

    it('sort by size-desc orders by total bytes across files in each course', () => {
        const result = applyFilter(courses, {
            query: '',
            types: [],
            sort: 'size-desc',
        });
        expect(result.courses.map((c) => c.name)).toEqual([
            'Программирование', // 10MB + 300KB
            'Физика',           // 2MB
            'Математика',       // 120KB + 50KB
        ]);
    });

    it('returns no courses when filters reject everything', () => {
        const result = applyFilter(courses, {
            query: 'this-will-not-match',
            types: [],
            sort: 'name-asc',
        });
        expect(result.courses).toHaveLength(0);
        expect(result.visibleFileCount).toBe(0);
        expect(result.totalFileCount).toBe(5);
    });
});

describe('isFilterActive', () => {
    it('default state is not active', () => {
        expect(isFilterActive(DEFAULT_FILTER_STATE)).toBe(false);
    });

    it('non-empty query is active', () => {
        expect(isFilterActive({ ...DEFAULT_FILTER_STATE, query: 'foo' })).toBe(true);
    });

    it('partial type selection is active', () => {
        expect(
            isFilterActive({ ...DEFAULT_FILTER_STATE, types: ['pdf'] })
        ).toBe(true);
    });

    it('non-default sort is active', () => {
        expect(
            isFilterActive({ ...DEFAULT_FILTER_STATE, sort: 'size-desc' })
        ).toBe(true);
    });
});
