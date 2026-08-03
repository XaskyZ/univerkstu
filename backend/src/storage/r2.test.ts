import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildObjectKey, getR2Config } from './r2.js';

describe('buildObjectKey', () => {
    // Builds the R2 object key for an UMKD file:
    //   umkd/<courseId>/<contentHash>/<cleanFilename>
    //
    // Security-critical: the cleanFilename pass strips leading slashes and any
    // `..` sequences to prevent path traversal — an attacker uploading a file
    // named "../../../../etc/passwd" must NOT be able to escape the umkd/ prefix.

    it('produces the expected umkd/<courseId>/<hash>/<filename> layout', () => {
        const key = buildObjectKey('CIT-23-1', 'abc123def456', 'lecture1.pdf');
        expect(key).toBe('umkd/CIT-23-1/abc123def456/lecture1.pdf');
    });

    it('strips leading slashes (security: prevents anchoring outside umkd/)', () => {
        // Without stripping, "/etc/passwd" would produce "umkd/x/y//etc/passwd"
        // which then resolves to ".../etc/passwd" in some S3-compatible interpreters.
        expect(buildObjectKey('c', 'h', '/etc/passwd')).toBe('umkd/c/h/etc/passwd');
        expect(buildObjectKey('c', 'h', '///rooted/file')).toBe('umkd/c/h/rooted/file');
    });

    it('collapses .. sequences to single . (security: prevents path traversal)', () => {
        // The .replace(/\.\.+/g, '.') pass turns "..", "...", "...." etc. into a single dot.
        // This makes "../../etc/passwd" → ".././etc/passwd" → no longer a traversal pattern.
        expect(buildObjectKey('c', 'h', '../secret')).toBe('umkd/c/h/./secret');
        expect(buildObjectKey('c', 'h', '../../../etc/passwd')).toBe('umkd/c/h/./././etc/passwd');
        expect(buildObjectKey('c', 'h', 'file..pdf')).toBe('umkd/c/h/file.pdf');
    });

    it('preserves a single dot (file extension)', () => {
        // The regex matches `..+` so single dots survive intact.
        expect(buildObjectKey('c', 'h', 'file.pdf')).toBe('umkd/c/h/file.pdf');
        expect(buildObjectKey('c', 'h', 'a.b.c.d')).toBe('umkd/c/h/a.b.c.d');
    });

    it('combined attack: leading slash AND .. sequences', () => {
        // The two passes compose: leading slashes stripped first, then dots collapsed.
        expect(buildObjectKey('c', 'h', '/../etc/passwd')).toBe('umkd/c/h/./etc/passwd');
    });

    it('preserves Cyrillic and emoji in filenames', () => {
        // Slugify upstream in parsers/umkd.ts:guessFilename handles ASCII-ification,
        // but defensively this layer must not corrupt unicode if it arrives.
        expect(buildObjectKey('c', 'h', 'лекция_1.pdf')).toBe('umkd/c/h/лекция_1.pdf');
    });

    it('does NOT sanitize courseId or contentHash (caller is trusted)', () => {
        // Documents the boundary: the function only sanitizes the filename argument
        // since that's the only one that can come from KSTU's HTML. courseId comes from
        // our own DB and contentHash is a computed MD5 — both are trusted.
        expect(buildObjectKey('weird/../id', 'hash..with..dots', 'file.pdf'))
            .toBe('umkd/weird/../id/hash..with..dots/file.pdf');
    });

    it('handles edge: filename of just "/"', () => {
        // Strips all leading slashes → empty string → key ends in trailing slash.
        // The R2 PUT call upstream would reject this, but the helper itself is total.
        expect(buildObjectKey('c', 'h', '/')).toBe('umkd/c/h/');
    });

    it('handles edge: filename of just ".."', () => {
        // ".." → "." after collapse → safe.
        expect(buildObjectKey('c', 'h', '..')).toBe('umkd/c/h/.');
    });

    it('idempotent: applying twice yields the same key', () => {
        // If a caller accidentally double-builds (rare but defensive), the second
        // pass should not introduce drift.
        const once = buildObjectKey('c', 'h', 'file.pdf');
        const twice = buildObjectKey('c', 'h', once.split('/').pop()!);
        expect(twice).toBe(once);
    });
});

describe('getR2Config', () => {
    // Reads R2 credentials from env. Returns null if any required field is missing
    // or whitespace-only — `isR2Configured()` in storage/index.ts depends on this
    // null-return to fall back to GridFS, so a regression here changes the storage
    // backend silently.

    beforeEach(() => {
        // Clear all R2 env vars so each test starts from a known empty state.
        vi.stubEnv('R2_BUCKET_NAME', '');
        vi.stubEnv('R2_ACCESS_KEY_ID', '');
        vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
        vi.stubEnv('R2_ENDPOINT', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const setAll = (overrides: Partial<{ bucket: string; key: string; secret: string; endpoint: string }> = {}) => {
        vi.stubEnv('R2_BUCKET_NAME', overrides.bucket ?? 'umkd-bucket');
        vi.stubEnv('R2_ACCESS_KEY_ID', overrides.key ?? 'AKEY');
        vi.stubEnv('R2_SECRET_ACCESS_KEY', overrides.secret ?? 'SECRETKEY');
        vi.stubEnv('R2_ENDPOINT', overrides.endpoint ?? 'https://abc.r2.cloudflarestorage.com');
    };

    it('returns null when bucket is missing', () => {
        setAll({ bucket: '' });
        expect(getR2Config()).toBe(null);
    });

    it('returns null when accessKeyId is missing', () => {
        setAll({ key: '' });
        expect(getR2Config()).toBe(null);
    });

    it('returns null when secretAccessKey is missing', () => {
        setAll({ secret: '' });
        expect(getR2Config()).toBe(null);
    });

    it('returns null when endpoint is missing', () => {
        setAll({ endpoint: '' });
        expect(getR2Config()).toBe(null);
    });

    it('returns null when any field is whitespace-only (treated as missing)', () => {
        // Common ops mistake: `R2_BUCKET_NAME=" "` in .env. The `.trim()` is the gate.
        setAll({ bucket: '   ' });
        expect(getR2Config()).toBe(null);
    });

    it('returns full config when all 4 vars are set', () => {
        setAll();
        expect(getR2Config()).toEqual({
            endpoint: 'https://abc.r2.cloudflarestorage.com',
            bucket: 'umkd-bucket',
            accessKeyId: 'AKEY',
            secretAccessKey: 'SECRETKEY',
        });
    });

    it('strips trailing slashes from endpoint', () => {
        setAll({ endpoint: 'https://abc.r2.cloudflarestorage.com/' });
        expect(getR2Config()!.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    });

    it('strips multiple trailing slashes', () => {
        setAll({ endpoint: 'https://abc.r2.cloudflarestorage.com///' });
        expect(getR2Config()!.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    });

    it('strips path suffix when it equals the bucket name (handles "endpoint/<bucket>" convention)', () => {
        // Cloudflare R2 dashboard sometimes shows the URL as
        // "https://abc.r2.cloudflarestorage.com/umkd-bucket" — but the S3 client
        // expects just the host. The helper auto-trims when the path matches the
        // configured bucket.
        setAll({ endpoint: 'https://abc.r2.cloudflarestorage.com/umkd-bucket', bucket: 'umkd-bucket' });
        expect(getR2Config()!.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    });

    it('keeps path suffix when it does NOT equal the bucket name', () => {
        // Defense against an unusual setup where the URL has a non-bucket path.
        // Strict equality (not prefix) keeps us from accidentally stripping a
        // legitimate path component.
        setAll({ endpoint: 'https://abc.r2.cloudflarestorage.com/some-prefix', bucket: 'umkd-bucket' });
        expect(getR2Config()!.endpoint).toBe('https://abc.r2.cloudflarestorage.com/some-prefix');
    });

    it('trims whitespace from each field independently', () => {
        setAll({
            bucket: '  umkd-bucket  ',
            key: '  AKEY  ',
            secret: '  SECRETKEY  ',
            endpoint: '  https://abc.r2.cloudflarestorage.com  ',
        });
        const config = getR2Config();
        expect(config!.bucket).toBe('umkd-bucket');
        expect(config!.accessKeyId).toBe('AKEY');
        expect(config!.secretAccessKey).toBe('SECRETKEY');
        expect(config!.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    });

    it('endpoint that fails to parse as URL is returned as-is (no transform applied)', () => {
        // The `tryParseUrl` swallows errors and returns null, so a non-URL endpoint
        // falls through to just trailing-slash trim. The S3 client upstream would
        // then fail with a clear error, which is better than us silently corrupting it.
        setAll({ endpoint: 'not a url' });
        expect(getR2Config()!.endpoint).toBe('not a url');
    });
});
