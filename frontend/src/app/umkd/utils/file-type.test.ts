import { describe, expect, it } from 'vitest';
import { classifyMime } from './file-type';

describe('classifyMime', () => {
    it('classifies application/pdf as pdf', () => {
        expect(classifyMime('application/pdf')).toBe('pdf');
    });

    it('classifies legacy Word MIME as doc', () => {
        expect(classifyMime('application/msword')).toBe('doc');
    });

    it('classifies modern .docx MIME as doc', () => {
        expect(
            classifyMime(
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            )
        ).toBe('doc');
    });

    it('classifies modern .pptx MIME as ppt', () => {
        expect(
            classifyMime(
                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            )
        ).toBe('ppt');
    });

    it('classifies modern .xlsx MIME as excel', () => {
        expect(
            classifyMime(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        ).toBe('excel');
    });

    it('classifies application/zip as archive', () => {
        expect(classifyMime('application/zip')).toBe('archive');
    });

    it('falls back to extension when MIME is missing or generic', () => {
        // No MIME at all — must use extension.
        expect(classifyMime(undefined, 'lecture-1.pdf')).toBe('pdf');
        // Generic octet-stream — also relies on filename.
        expect(classifyMime('application/octet-stream', 'archive.rar')).toBe('archive');
    });

    it('falls back to extension for .docx / .xlsx / .pptx / .csv', () => {
        expect(classifyMime(undefined, 'Report.DOCX')).toBe('doc');
        expect(classifyMime(undefined, 'sheet.xlsx')).toBe('excel');
        expect(classifyMime('', 'slides.PPTX')).toBe('ppt');
        expect(classifyMime(undefined, 'grades.csv')).toBe('excel');
    });

    it('returns other for unknown MIME and unknown extension', () => {
        expect(classifyMime('image/png', 'photo.png')).toBe('other');
        expect(classifyMime(undefined, 'notes.xyz')).toBe('other');
        expect(classifyMime()).toBe('other');
    });

    it('handles filenames with query/hash and no extension safely', () => {
        // URL-like input with query string after extension still detects type.
        expect(classifyMime(undefined, 'file.pdf?download=1')).toBe('pdf');
        // No extension at all.
        expect(classifyMime(undefined, 'Makefile')).toBe('other');
        // Trailing dot — must not be treated as an extension.
        expect(classifyMime(undefined, 'weird.')).toBe('other');
    });
});
