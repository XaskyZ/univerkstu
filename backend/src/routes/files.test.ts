import { describe, it, expect } from 'vitest';
import {
    buildContentDispositionHeader,
    isAllowedUploadContentType,
    resolveUploadContentType,
    MAX_UPLOAD_BYTES,
    UPLOAD_BODY_LIMIT_BYTES,
} from './files.js';

describe('buildContentDispositionHeader', () => {
    // Generates the dual-encoded Content-Disposition header for file downloads.
    // Two filename forms are emitted:
    //   - filename="ASCII"           — fallback for very old clients
    //   - filename*=UTF-8''<encoded> — RFC 5987 form for modern browsers
    // Critical: any regression here breaks Russian/Kazakh-named UMKD lecture files.

    it('plain ASCII filename produces both forms identically (modulo encoding)', () => {
        const result = buildContentDispositionHeader('lecture1.pdf');
        expect(result).toBe('attachment; filename="lecture1.pdf"; filename*=UTF-8\'\'lecture1.pdf');
    });

    it('Cyrillic name is preserved verbatim in filename*= and replaced with underscores in fallback', () => {
        const result = buildContentDispositionHeader('лекция_1.pdf');
        // ASCII fallback: every Cyrillic char becomes _ (one underscore per char).
        expect(result).toContain('filename="_______1.pdf"');
        // RFC 5987 form: percent-encoded bytes preserve the original name.
        const encoded = encodeURIComponent('лекция_1.pdf');
        expect(result).toContain(`filename*=UTF-8''${encoded}`);
    });

    it('strips double quotes from ASCII fallback (would break syntax)', () => {
        // Internal " would break the filename="..." closing quote.
        // The encoded form preserves it (as %22).
        const result = buildContentDispositionHeader('weird"name.pdf');
        expect(result).toContain('filename="weirdname.pdf"');
        expect(result).toContain('filename*=UTF-8\'\'weird%22name.pdf');
    });

    it('falls back to "file.bin" when name is empty', () => {
        const result = buildContentDispositionHeader('');
        expect(result).toBe('attachment; filename="file.bin"; filename*=UTF-8\'\'file.bin');
    });

    it('encodes spaces in the RFC 5987 form (URI encoding)', () => {
        // encodeURIComponent turns " " into "%20".
        const result = buildContentDispositionHeader('my lecture.pdf');
        expect(result).toContain('filename="my lecture.pdf"');
        expect(result).toContain('filename*=UTF-8\'\'my%20lecture.pdf');
    });

    it('handles emoji (4-byte UTF-8) in name', () => {
        // Emoji bytes are all >0x7E so they get underscored in the ASCII fallback.
        const result = buildContentDispositionHeader('file🔥.pdf');
        // The 🔥 emoji is 4 bytes in UTF-16 (surrogate pair) — replaced with 2 underscores.
        expect(result).toContain('filename="file__.pdf"');
        // The * form preserves it as percent-encoded UTF-8.
        expect(result).toContain('filename*=UTF-8\'\'file%F0%9F%94%A5.pdf');
    });

    it('emits attachment disposition (not inline) — guards against preview-vs-download confusion', () => {
        // Documents that the function ALWAYS produces "attachment; ..." — meaning
        // the browser will save the file to disk. If a future variant ever needs
        // inline rendering, the test will catch the regression in callers that
        // depend on attachment behavior.
        expect(buildContentDispositionHeader('x.pdf')).toMatch(/^attachment;/);
    });

    it('Kazakh + Russian mixed name (ASCII fallback all underscores, RFC 5987 preserves)', () => {
        const result = buildContentDispositionHeader('Қ_лекция_дәріс.pdf');
        // ASCII fallback: every non-ASCII char becomes _ (literal underscores preserved).
        // Match by regex shape rather than exact count to keep the test robust.
        expect(result).toMatch(/filename="[_]+\.pdf"/);
        // RFC 5987 form preserves the original Cyrillic + Kazakh letters.
        const encoded = encodeURIComponent('Қ_лекция_дәріс.pdf');
        expect(result).toContain(`filename*=UTF-8''${encoded}`);
    });
});

describe('resolveUploadContentType', () => {
    // The upload endpoint takes an optional client-declared MIME and falls back
    // to extension sniffing — same rule the storage layer applies.

    it('prefers the declared MIME over the extension', () => {
        expect(resolveUploadContentType('report.bin', 'application/pdf')).toBe('application/pdf');
    });

    it('strips parameters and normalises case', () => {
        expect(resolveUploadContentType('notes.txt', 'TEXT/Plain; charset=UTF-8')).toBe('text/plain');
    });

    it('falls back to the extension when no MIME is declared', () => {
        expect(resolveUploadContentType('lecture.pdf')).toBe('application/pdf');
        expect(resolveUploadContentType('archive.zip', '')).toBe('application/zip');
    });

    it('yields octet-stream for an unknown extension', () => {
        expect(resolveUploadContentType('payloadless.bin')).toBe('application/octet-stream');
    });
});

describe('isAllowedUploadContentType', () => {
    // Mirrors the client-side list in
    // frontend/src/app/group/utils/social-attachment-upload.ts plus archives.

    it.each([
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'application/vnd.oasis.opendocument.text',
        'text/plain',
        'text/csv',
        'text/markdown',
        'application/zip',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
    ])('accepts %s', (mime) => {
        expect(isAllowedUploadContentType(mime)).toBe(true);
    });

    it.each([
        'application/octet-stream',
        'application/x-msdownload',
        'application/x-sh',
        'text/html',
        'application/javascript',
        '',
    ])('rejects %s', (mime) => {
        expect(isAllowedUploadContentType(mime)).toBe(false);
    });

    it('matches prefixes only at the start (no substring match)', () => {
        expect(isAllowedUploadContentType('application/x-evil+image/png')).toBe(false);
    });
});

describe('upload size constants', () => {
    it('keeps the decoded cap at 25 MB', () => {
        expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    });

    it('sizes the route body limit for a 25 MB base64 payload', () => {
        // base64 inflates by 4/3; the envelope must clear that plus JSON overhead.
        const base64Length = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
        expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(base64Length);
        // ...and it must be well above the 256 KB global limit that used to bite.
        expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(256 * 1024);
    });
});
