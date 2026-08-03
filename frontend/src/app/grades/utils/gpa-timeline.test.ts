import { describe, it, expect } from 'vitest';
import {
    averageOf,
    buildTimelinePoints,
    formatTermLabel,
    getGpaTimelineUi,
    parseTermKey,
} from './gpa-timeline';

describe('parseTermKey', () => {
    it('parses YYYY-S form', () => {
        expect(parseTermKey('2024-1')).toEqual({ year: 2024, semester: 1 });
        expect(parseTermKey('2026-2')).toEqual({ year: 2026, semester: 2 });
    });
    it('parses YYYY/S form', () => {
        expect(parseTermKey('2024/2')).toEqual({ year: 2024, semester: 2 });
    });
    it('returns null for single-number keys (course-style)', () => {
        expect(parseTermKey('1')).toBe(null);
        expect(parseTermKey('4')).toBe(null);
    });
    it('returns null for unparseable', () => {
        expect(parseTermKey('')).toBe(null);
        expect(parseTermKey('garbage')).toBe(null);
        expect(parseTermKey('2024')).toBe(null);
    });
});

describe('formatTermLabel', () => {
    it('formats with slash', () => {
        expect(formatTermLabel({ year: 2024, semester: 1 })).toBe('2024/1');
    });
});

describe('buildTimelinePoints — term mode', () => {
    it('returns empty array for null/undefined map', () => {
        expect(buildTimelinePoints(undefined, 'term')).toEqual([]);
        expect(buildTimelinePoints(null, 'term')).toEqual([]);
        expect(buildTimelinePoints({}, 'term')).toEqual([]);
    });

    it('drops non-finite, zero, negative values', () => {
        const map = {
            '2024-1': 3.5,
            '2024-2': 0,
            '2025-1': -1,
            '2025-2': Number.NaN,
        };
        const points = buildTimelinePoints(map, 'term');
        expect(points).toHaveLength(1);
        expect(points[0].label).toBe('2024/1');
    });

    it('sorts chronologically across years and semesters', () => {
        const map = {
            '2025-1': 3.2,
            '2024-2': 3.5,
            '2024-1': 3.0,
            '2025-2': 3.6,
        };
        const points = buildTimelinePoints(map, 'term');
        expect(points.map(p => p.label)).toEqual(['2024/1', '2024/2', '2025/1', '2025/2']);
    });

    it('positions x evenly from 0 to 1', () => {
        const map = { '2024-1': 1, '2024-2': 2, '2025-1': 3, '2025-2': 4 };
        const points = buildTimelinePoints(map, 'term');
        expect(points[0].x).toBe(0);
        expect(points[points.length - 1].x).toBe(1);
        expect(points[1].x).toBeCloseTo(1 / 3, 5);
    });

    it('normalizes y by the 4.0 scale by default', () => {
        const points = buildTimelinePoints({ '2024-1': 2, '2024-2': 4 }, 'term');
        expect(points[0].y).toBeCloseTo(0.5, 5);
        expect(points[1].y).toBeCloseTo(1.0, 5);
    });

    it('clamps y when value exceeds yMax', () => {
        const points = buildTimelinePoints({ '2024-1': 5 }, 'term', 4);
        expect(points[0].y).toBe(1);
    });

    it('single-point dataset places point at x=0.5', () => {
        const points = buildTimelinePoints({ '2024-1': 3 }, 'term');
        expect(points).toHaveLength(1);
        expect(points[0].x).toBe(0.5);
    });

    it('drops course-style keys in term mode', () => {
        const points = buildTimelinePoints({ '1': 3.5, '2024-1': 3.2 }, 'term');
        expect(points.map(p => p.label)).toEqual(['2024/1']);
    });
});

describe('buildTimelinePoints — course mode', () => {
    it('treats keys as course numbers', () => {
        const points = buildTimelinePoints({ '1': 3.0, '2': 3.5, '3': 3.7 }, 'course');
        expect(points.map(p => p.label)).toEqual(['1 курс', '2 курс', '3 курс']);
    });

    it('drops non-numeric keys', () => {
        const points = buildTimelinePoints({ '1': 3.0, '2024-1': 3.5 }, 'course');
        expect(points).toHaveLength(1);
        expect(points[0].label).toBe('1 курс');
    });

    it('sorts by course number ascending', () => {
        const points = buildTimelinePoints({ '4': 3.8, '1': 3.0, '3': 3.5 }, 'course');
        expect(points.map(p => p.label)).toEqual(['1 курс', '3 курс', '4 курс']);
    });
});

describe('averageOf', () => {
    it('returns null for empty', () => {
        expect(averageOf([])).toBeNull();
    });
    it('averages values', () => {
        const points = buildTimelinePoints({ '2024-1': 3, '2024-2': 4 }, 'term');
        expect(averageOf(points)).toBe(3.5);
    });
});

describe('getGpaTimelineUi', () => {
    it('returns ru strings by default', () => {
        const ui = getGpaTimelineUi('ru');
        expect(ui.termTab).toBe('По семестрам');
    });
    it('returns kz strings', () => {
        expect(getGpaTimelineUi('kz').termTab).toBe('Семестрлер');
    });
    it('returns en strings', () => {
        expect(getGpaTimelineUi('en').termTab).toBe('By term');
    });
});
