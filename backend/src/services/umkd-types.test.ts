import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    buildExamQuestionsBySubject,
    detectExtension,
    getCurrentSemester,
    getCurrentYear,
    guessFilename,
    looksLikeHtml,
    slugify,
    type UMKDCourse,
    type UMKDFile,
} from './umkd-types.js';

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

describe('buildExamQuestionsBySubject', () => {
    const file = (over: Partial<UMKDFile>): UMKDFile => ({
        id: 'f1',
        name: 'questions.pdf',
        url: '',
        ...over,
    });

    it('groups only exam-questions files, sorted by count then name', () => {
        const courses: UMKDCourse[] = [
            {
                id: 'c1',
                name: 'Физика',
                kind: 'обязат.',
                files: [
                    file({ id: '1', fileId: 'aaa', name: 'вопросы.docx', examClassification: { kind: 'exam-questions', confidence: 'strong', reason: 'title' } as any }),
                    file({ id: '2', name: 'лекция.pdf', examClassification: { kind: 'other', confidence: 'weak', reason: '' } as any }),
                ],
            },
            {
                id: 'c2',
                name: 'Алгебра',
                files: [
                    file({ id: '3', examClassification: { kind: 'exam-questions', confidence: 'medium', reason: 'a' } as any }),
                    file({ id: '4', examClassification: { kind: 'exam-questions', confidence: 'weak', reason: 'b' } as any }),
                ],
            },
            { id: 'c3', name: 'Химия', files: [file({ id: '5' })] },
        ];

        const groups = buildExamQuestionsBySubject(courses);
        expect(groups.map((g) => g.subjectName)).toEqual(['Алгебра', 'Физика']);
        expect(groups[0].fileCount).toBe(2);
        expect(groups[1].files[0]).toMatchObject({
            fileId: 'aaa',
            extension: 'docx',
            downloadUrl: '/api/v3/files/aaa?download=1',
            openUrl: '/api/v3/files/aaa',
            confidence: 'strong',
        });
        expect(groups[0].files[0].downloadUrl).toBeUndefined();
    });
});
