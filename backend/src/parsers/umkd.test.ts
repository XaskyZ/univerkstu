import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    detectExtension,
    getCurrentSemester,
    getCurrentYear,
    guessFilename,
    looksLikeHtml,
    parseCourseList,
    slugify,
} from './umkd.js';

describe('slugify', () => {
    it('lowercases and collapses spaces to underscores', () => {
        expect(slugify('Hello World')).toBe('hello_world');
    });

    it('keeps Cyrillic characters', () => {
        expect(slugify('Лекция 1')).toBe('лекция_1');
    });

    it('keeps Kazakh characters', () => {
        expect(slugify('Дәріс әдістері')).toBe('дәріс_әдістері');
    });

    it('drops punctuation except dot, hyphen, parens', () => {
        expect(slugify('Test! @#$ name?')).toBe('test_name');
        expect(slugify('Math (basics)')).toBe('math_(basics)');
        expect(slugify('file-name.pdf')).toBe('file-name.pdf');
    });

    it('truncates to maxlen', () => {
        const long = 'a'.repeat(200);
        expect(slugify(long, 50)).toHaveLength(50);
    });

    it('returns "file" for empty input', () => {
        expect(slugify('')).toBe('file');
        expect(slugify('   ')).toBe('file');
    });
});

describe('detectExtension', () => {
    it('extracts extension from URL pathname', () => {
        expect(detectExtension(undefined, 'https://example.com/file.pdf')).toBe('.pdf');
        expect(detectExtension(undefined, '/files/doc.docx')).toBe('.docx');
    });

    it('lowercases the extension', () => {
        expect(detectExtension(undefined, '/FILE.PDF')).toBe('.pdf');
    });

    it('falls back to extension from title when URL is missing', () => {
        expect(detectExtension('Lecture.pptx', undefined)).toBe('.pptx');
    });

    it('returns .bin when neither title nor URL has extension', () => {
        expect(detectExtension('No extension', '/files/no-ext')).toBe('.bin');
        expect(detectExtension(undefined, undefined)).toBe('.bin');
    });

    it('rejects too-long extensions (likely path segments)', () => {
        // Extension validation: 2-6 chars only.
        expect(detectExtension(undefined, '/file.toolongextension')).toBe('.bin');
        expect(detectExtension(undefined, '/file.x')).toBe('.bin');
    });
});

describe('guessFilename', () => {
    it('builds slugified name with extension from title', () => {
        expect(guessFilename('Лекция 1.pdf', undefined, undefined)).toBe('лекция_1.pdf');
    });

    it('does not duplicate the extension when title already has it', () => {
        expect(guessFilename('doc.pdf', undefined, undefined)).toBe('doc.pdf');
    });

    it('falls back to fileId when title is empty', () => {
        expect(guessFilename('', '/x.pdf', 'abc123')).toBe('abc123.pdf');
    });

    it('replaces en/em-dashes with hyphens before slugifying', () => {
        expect(guessFilename('Лекция – финал.pdf', undefined, undefined)).toBe('лекция_-_финал.pdf');
    });

    it('returns "file<ext>" when nothing usable is provided', () => {
        expect(guessFilename(undefined, undefined, undefined)).toBe('file.bin');
    });
});

describe('looksLikeHtml', () => {
    it('detects <html prefix', () => {
        expect(looksLikeHtml(Buffer.from('<html><head></head></html>'))).toBe(true);
    });

    it('detects <!DOCTYPE prefix (case-insensitive)', () => {
        expect(looksLikeHtml(Buffer.from('<!DOCTYPE html>'))).toBe(true);
        expect(looksLikeHtml(Buffer.from('<!doctype html>'))).toBe(true);
    });

    it('returns false for binary content', () => {
        expect(looksLikeHtml(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBe(false); // %PDF
        expect(looksLikeHtml(Buffer.from('PK\x03\x04'))).toBe(false); // ZIP/DOCX
    });

    it('only inspects first 200 bytes', () => {
        const longBuf = Buffer.concat([Buffer.alloc(300, 0xff), Buffer.from('<html>')]);
        expect(looksLikeHtml(longBuf)).toBe(false);
    });
});

describe('getCurrentYear', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // Делегирует канонической getCurrentAcademicPeriod (platonus-client.ts).
    it('returns current year from September through December', () => {
        vi.setSystemTime(new Date('2025-09-01'));
        expect(getCurrentYear()).toBe('2025');
        vi.setSystemTime(new Date('2025-12-31'));
        expect(getCurrentYear()).toBe('2025');
    });

    it('returns previous year from January through June', () => {
        vi.setSystemTime(new Date('2026-01-15'));
        expect(getCurrentYear()).toBe('2025');
        vi.setSystemTime(new Date('2026-06-30'));
        expect(getCurrentYear()).toBe('2025');
    });

    it('returns current year for July-August (upcoming academic year)', () => {
        vi.setSystemTime(new Date('2026-07-15'));
        expect(getCurrentYear()).toBe('2026');
        vi.setSystemTime(new Date('2026-08-31'));
        expect(getCurrentYear()).toBe('2026');
    });
});

describe('getCurrentSemester', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns "1" for autumn semester (Sep-Jan)', () => {
        vi.setSystemTime(new Date('2025-09-15'));
        expect(getCurrentSemester()).toBe('1');
        vi.setSystemTime(new Date('2025-12-31'));
        expect(getCurrentSemester()).toBe('1');
        vi.setSystemTime(new Date('2026-01-10'));
        expect(getCurrentSemester()).toBe('1');
    });

    it('returns "2" for spring semester (Feb-Jun)', () => {
        vi.setSystemTime(new Date('2026-02-01'));
        expect(getCurrentSemester()).toBe('2');
        vi.setSystemTime(new Date('2026-05-15'));
        expect(getCurrentSemester()).toBe('2');
        vi.setSystemTime(new Date('2026-06-30'));
        expect(getCurrentSemester()).toBe('2');
    });

    it('returns "1" for July-August (upcoming autumn, canonical predict)', () => {
        vi.setSystemTime(new Date('2026-07-15'));
        expect(getCurrentSemester()).toBe('1');
        vi.setSystemTime(new Date('2026-08-31'));
        expect(getCurrentSemester()).toBe('1');
    });
});

describe('parseCourseList', () => {
    it('extracts courses from primary table.inner tr.link layout', () => {
        const html = `
            <table class="inner">
                <tr class="link" id="c1"><td>1</td><td>Математика</td><td>обязат.</td></tr>
                <tr class="link" id="c2"><td>2</td><td>Физика</td><td>выборная</td></tr>
            </table>
        `;
        const result = parseCourseList(html);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ id: 'c1', title: 'Математика', kind: 'обязат.' });
        expect(result[1]).toEqual({ id: 'c2', title: 'Физика', kind: 'выборная' });
    });

    it('falls back to folder-icon detection when no .link rows', () => {
        const html = `
            <table class="inner">
                <tr><td><img src="folder.png"/></td><td>Биология</td><td>факульт.</td></tr>
            </table>
        `;
        const result = parseCourseList(html);
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Биология');
        expect(result[0].kind).toBe('факульт.');
    });

    it('skips rows without title', () => {
        const html = `
            <table class="inner">
                <tr class="link" id="c1"><td>1</td><td></td><td>x</td></tr>
            </table>
        `;
        expect(parseCourseList(html)).toHaveLength(0);
    });

    it('returns empty array for empty/missing tables', () => {
        expect(parseCourseList('<div>nothing</div>')).toEqual([]);
        expect(parseCourseList('')).toEqual([]);
    });
});
