import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeHash, getFileOwnership, getMimeType } from './gridfs.js';

// `getFileOwnership` is the only DB-touching helper exercised here; the pool is
// replaced with a query spy so the SQL shape stays pinned.
const queryMock = vi.fn();
vi.mock('./postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: unknown) => Promise<unknown>) => (
        handler({ query: (...args: unknown[]) => queryMock(...args) })
    )),
}));

describe('computeHash', () => {
    // MD5 hash of file content — drives the UMKD file deduplication. Same content
    // from two different users → same hash → single storage entry. A regression
    // here would either explode storage cost (dedupe breaks) or silently dedupe
    // distinct content (collision risk if downgraded to a shorter prefix).

    it('returns 32-character hex string', () => {
        const hash = computeHash(Buffer.from('any content'));
        expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    it('produces the canonical MD5 of empty buffer', () => {
        // Known constant: MD5 of empty input is d41d8cd98f00b204e9800998ecf8427e
        expect(computeHash(Buffer.alloc(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });

    it('produces the canonical MD5 of "hello"', () => {
        // Known constant: MD5("hello") = 5d41402abc4b2a76b9719d911017c592
        expect(computeHash(Buffer.from('hello'))).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('different content produces different hashes', () => {
        const a = computeHash(Buffer.from('content A'));
        const b = computeHash(Buffer.from('content B'));
        expect(a).not.toBe(b);
    });

    it('same content produces same hash (idempotent — drives dedupe)', () => {
        const buffer = Buffer.from('coursework.pdf content here');
        expect(computeHash(buffer)).toBe(computeHash(buffer));
    });

    it('handles binary data (non-text Buffer)', () => {
        const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
        const hash = computeHash(binary);
        expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    it('case-sensitive on the source content', () => {
        // Documents that MD5 is byte-exact; uppercase/lowercase yield different hashes.
        expect(computeHash(Buffer.from('Hello'))).not.toBe(computeHash(Buffer.from('hello')));
    });
});

describe('getMimeType', () => {
    // Inferred Content-Type for served UMKD files. Wrong MIME → wrong browser
    // handling (e.g., a PDF served as octet-stream forces download instead of
    // inline view; an image served as octet-stream won't preview).

    it('common Office formats', () => {
        expect(getMimeType('lec.pdf')).toBe('application/pdf');
        expect(getMimeType('notes.doc')).toBe('application/msword');
        expect(getMimeType('paper.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(getMimeType('data.xls')).toBe('application/vnd.ms-excel');
        expect(getMimeType('data.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(getMimeType('slides.ppt')).toBe('application/vnd.ms-powerpoint');
        expect(getMimeType('slides.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    });

    it('image formats', () => {
        expect(getMimeType('photo.jpg')).toBe('image/jpeg');
        expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
        expect(getMimeType('photo.png')).toBe('image/png');
        expect(getMimeType('anim.gif')).toBe('image/gif');
    });

    it('text + archive formats', () => {
        expect(getMimeType('readme.txt')).toBe('text/plain');
        expect(getMimeType('lecture-pack.zip')).toBe('application/zip');
        expect(getMimeType('archive.rar')).toBe('application/x-rar-compressed');
    });

    it('is case-insensitive on the extension', () => {
        expect(getMimeType('FILE.PDF')).toBe('application/pdf');
        expect(getMimeType('Photo.JPG')).toBe('image/jpeg');
    });

    it('uses the LAST dot-segment as extension', () => {
        // "doc.backup.pdf" → ext is "pdf" → PDF mime.
        // "version.1.tar.gz" → ext is "gz" (NOT "tar.gz") → gzip, not x-tar.
        expect(getMimeType('doc.backup.pdf')).toBe('application/pdf');
        expect(getMimeType('version.1.tar.gz')).toBe('application/gzip');
        expect(getMimeType('notes.pdf.bak')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
        expect(getMimeType('mystery.xyz')).toBe('application/octet-stream');
        expect(getMimeType('installer.exe')).toBe('application/octet-stream'); // not in table
    });

    it('falls back to octet-stream when there is no extension', () => {
        expect(getMimeType('README')).toBe('application/octet-stream');
        expect(getMimeType('Makefile')).toBe('application/octet-stream');
    });

    it('empty string falls back to octet-stream', () => {
        expect(getMimeType('')).toBe('application/octet-stream');
    });

    it('PDF mapping is locked in (load-bearing — most UMKD files are PDFs)', () => {
        // Regression guard. If this ever changes, browsers will start
        // force-downloading every lecture PDF instead of previewing inline.
        expect(getMimeType('any-lecture.pdf')).toBe('application/pdf');
    });
});

describe('getMimeType — extensions the upload allow-list depends on', () => {
    // The upload endpoint infers the content type from the filename when the
    // client sends no `mimeType`, then checks it against the allow-list in
    // routes/files.ts. Anything missing here is rejected with 415, so these
    // mappings are part of the upload contract.

    it('modern image formats', () => {
        expect(getMimeType('shot.webp')).toBe('image/webp');
        expect(getMimeType('icon.svg')).toBe('image/svg+xml');
        expect(getMimeType('photo.heic')).toBe('image/heic');
        expect(getMimeType('photo.avif')).toBe('image/avif');
        expect(getMimeType('scan.bmp')).toBe('image/bmp');
    });

    it('text formats the frontend allows', () => {
        expect(getMimeType('notes.md')).toBe('text/markdown');
        expect(getMimeType('table.csv')).toBe('text/csv');
    });

    it('archives', () => {
        expect(getMimeType('pack.7z')).toBe('application/x-7z-compressed');
        expect(getMimeType('pack.tar')).toBe('application/x-tar');
        expect(getMimeType('pack.gz')).toBe('application/gzip');
    });

    it('OpenDocument + RTF', () => {
        expect(getMimeType('essay.odt')).toBe('application/vnd.oasis.opendocument.text');
        expect(getMimeType('budget.ods')).toBe('application/vnd.oasis.opendocument.spreadsheet');
        expect(getMimeType('deck.odp')).toBe('application/vnd.oasis.opendocument.presentation');
        expect(getMimeType('old.rtf')).toBe('application/rtf');
    });
});

describe('getFileOwnership', () => {
    // Minimal metadata slice behind `canAccessFile`. It must NOT parse the id as
    // an ObjectId — `app_umkd_files.file_id` is text, and an arbitrary string
    // from the URL should return "not found", not throw.

    beforeEach(() => {
        queryMock.mockReset();
    });

    it('returns uploadedBy + courseId for a registered file', async () => {
        queryMock.mockResolvedValue({ rows: [{ uploaded_by: 'u-1', course_id: 'KURS-1024' }], rowCount: 1 });
        await expect(getFileOwnership('68f0c0ffee0000000000abcd')).resolves.toEqual({
            fileId: '68f0c0ffee0000000000abcd',
            uploadedBy: 'u-1',
            courseId: 'KURS-1024',
        });
    });

    it('queries app_umkd_files by the raw text id', async () => {
        queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
        await getFileOwnership('  68f0c0ffee0000000000abcd  ');
        const [sql, params] = queryMock.mock.calls[0];
        expect(String(sql)).toContain('from app_umkd_files');
        expect(params).toEqual(['68f0c0ffee0000000000abcd']);
    });

    it('returns null for an unknown id', async () => {
        queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
        await expect(getFileOwnership('nope')).resolves.toBeNull();
    });

    it('does not throw on a non-ObjectId id (no ObjectId parsing)', async () => {
        queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
        await expect(getFileOwnership('../../etc/passwd')).resolves.toBeNull();
    });

    it('short-circuits an empty id without a query', async () => {
        await expect(getFileOwnership('   ')).resolves.toBeNull();
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('normalises missing metadata to nulls (legacy migrated rows)', async () => {
        queryMock.mockResolvedValue({ rows: [{ uploaded_by: null, course_id: null }], rowCount: 1 });
        await expect(getFileOwnership('legacy')).resolves.toEqual({
            fileId: 'legacy',
            uploadedBy: null,
            courseId: null,
        });
    });
});
