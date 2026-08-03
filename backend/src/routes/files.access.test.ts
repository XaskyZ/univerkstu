/**
 * Route-level tests for the files endpoints.
 *
 * Covers:
 *   - S1  — `canAccessFile` is consulted before any byte leaves the storage
 *           layer, and its verdict maps to 200 / 403 / 404;
 *   - S1  — `/info` no longer echoes the internal R2 object key to a normal user;
 *   - S11 — the upload MIME allow-list (415 `FILE_UNSUPPORTED_TYPE`);
 *   - S13 — the per-route `bodyLimit` so payloads above the global 256 KB cap
 *           actually reach the handler and get the intended `FILE_TOO_LARGE`.
 *
 * The pure header/allow-list helpers are unit-tested in files.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../services/file-access.js', () => ({
    canAccessFile: vi.fn(),
    RUNTIME_UPLOAD_COURSE_ID: 'social',
}));

vi.mock('../storage/index.js', () => ({
    downloadFromStorageByFileId: vi.fn(),
    uploadToStorage: vi.fn(),
}));

vi.mock('../db/gridfs.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../db/gridfs.js')>();
    return {
        // Keep the real `getMimeType` — the allow-list depends on its extension map.
        ...actual,
        getFileInfo: vi.fn(),
        getStorageStats: vi.fn(),
    };
});

vi.mock('../utils/actionLog.js', () => ({ logAction: vi.fn() }));

const { filesRoutes, MAX_UPLOAD_BYTES } = await import('./files.js');
const fileAccess = await import('../services/file-access.js');
const storage = await import('../storage/index.js');
const gridfs = await import('../db/gridfs.js');

const CALLER = 'student-1';

/**
 * Mirrors backend/src/index.ts: a 256 KB global body limit and an
 * `authenticate` decorator that stamps `request.user`.
 */
async function buildApp() {
    const app = Fastify({ bodyLimit: 256 * 1024 });
    app.decorate('authenticate', async (request: any) => {
        request.user = { userId: CALLER };
    });
    await app.register(filesRoutes);
    await app.ready();
    return app;
}

function allow(reason: string) {
    vi.mocked(fileAccess.canAccessFile).mockResolvedValue({ allowed: true, reason } as any);
}
function deny(reason: string) {
    vi.mocked(fileAccess.canAccessFile).mockResolvedValue({ allowed: false, reason } as any);
}

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_KEY;
    vi.mocked(storage.downloadFromStorageByFileId).mockResolvedValue({
        fileId: 'f1',
        buffer: Buffer.from('lecture bytes'),
        filename: 'лекция.pdf',
        contentType: 'application/pdf',
        provider: 'r2',
    });
    vi.mocked(gridfs.getFileInfo).mockResolvedValue({
        fileId: 'f1',
        name: 'лекция.pdf',
        size: 13,
        mimeType: 'application/pdf',
        courseId: 'KURS-1024',
        courseName: 'Матанализ',
        storageProvider: 'r2',
        r2ObjectKey: 'umkd/KURS-1024/abcdef/лекция.pdf',
        r2Bucket: 'univer-prod',
        downloadUrl: '/api/v3/files/f1',
        contentHash: 'abcdef',
    });
    vi.mocked(storage.uploadToStorage).mockResolvedValue({
        ref: { provider: 'r2', fileId: 'new-file', objectKey: 'k', bucket: 'b' },
        deduplicated: false,
        contentHash: 'hash',
    });
});

describe('GET /files/:fileId — access control (S1)', () => {
    it('serves the bytes when the caller is the uploader', async () => {
        allow('uploader');
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/files/f1' });

        expect(res.statusCode).toBe(200);
        expect(res.rawPayload.toString()).toBe('lecture bytes');
        expect(vi.mocked(fileAccess.canAccessFile)).toHaveBeenCalledWith(CALLER, 'f1');
    });

    it('still serves UMKD course material to a student who did not upload it', async () => {
        allow('course_material');
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/files/f1' });
        expect(res.statusCode).toBe(200);
    });

    it('serves a group file to a member', async () => {
        allow('group_file');
        const app = await buildApp();
        expect((await app.inject({ method: 'GET', url: '/files/f1' })).statusCode).toBe(200);
    });

    it('serves a social attachment whose scope the caller can read', async () => {
        allow('social_attachment');
        const app = await buildApp();
        expect((await app.inject({ method: 'GET', url: '/files/f1' })).statusCode).toBe(200);
    });

    it('403s an unrelated user and never touches storage', async () => {
        deny('denied');
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/files/f1' });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ success: false, errorCode: 'FILE_FORBIDDEN' });
        expect(vi.mocked(storage.downloadFromStorageByFileId)).not.toHaveBeenCalled();
    });

    it('404s an unknown fileId (unchanged behaviour)', async () => {
        deny('file_not_found');
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/files/ghost' });

        expect(res.statusCode).toBe(404);
        expect(vi.mocked(storage.downloadFromStorageByFileId)).not.toHaveBeenCalled();
    });

    it('keeps attachment disposition and nosniff on an allowed download', async () => {
        // S11 guardrail: the endpoint must never turn into an inline renderer.
        allow('uploader');
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/files/f1' });

        expect(res.headers['content-disposition']).toMatch(/^attachment;/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
});

describe('GET /files/:fileId/info — access control + storage-layout leak (S1)', () => {
    it('drops r2ObjectKey / r2Bucket for a normal user', async () => {
        allow('course_material');
        const app = await buildApp();
        const body = (await app.inject({ method: 'GET', url: '/files/f1/info' })).json();

        expect(body.success).toBe(true);
        expect(body.data).not.toHaveProperty('r2ObjectKey');
        expect(body.data).not.toHaveProperty('r2Bucket');
        // Everything the UI actually renders is still there.
        expect(body.data).toMatchObject({ fileId: 'f1', name: 'лекция.pdf', size: 13 });
    });

    it('403s a caller with no relationship to the file', async () => {
        deny('denied');
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/files/f1/info' });

        expect(res.statusCode).toBe(403);
        expect(res.json().errorCode).toBe('FILE_FORBIDDEN');
        expect(vi.mocked(gridfs.getFileInfo)).not.toHaveBeenCalled();
    });
});

describe('POST /files/upload — content-type allow-list (S11)', () => {
    function payload(filename: string, mimeType?: string, bytes = 'hello') {
        const body: Record<string, string> = {
            filename,
            contentBase64: Buffer.from(bytes).toString('base64'),
        };
        if (mimeType !== undefined) body.mimeType = mimeType;
        return body;
    }

    it('accepts an image (the avatar / board-cover / attachment case)', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/files/upload', payload: payload('photo.png', 'image/png') });
        expect(res.statusCode).toBe(201);
    });

    it('accepts a docx via the openxmlformats prefix', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST',
            url: '/files/upload',
            payload: payload('ref.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        });
        expect(res.statusCode).toBe(201);
    });

    it('accepts a declared type carrying a charset parameter', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/files/upload', payload: payload('notes.txt', 'text/plain; charset=utf-8') });
        expect(res.statusCode).toBe(201);
    });

    it('infers the type from the extension when the client sends no mimeType', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/files/upload', payload: payload('syllabus.pdf') });
        expect(res.statusCode).toBe(201);
    });

    it('415s an executable and never reaches the storage layer', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST',
            url: '/files/upload',
            payload: payload('setup.exe', 'application/x-msdownload'),
        });

        expect(res.statusCode).toBe(415);
        expect(res.json()).toMatchObject({ success: false, errorCode: 'FILE_UNSUPPORTED_TYPE' });
        expect(vi.mocked(storage.uploadToStorage)).not.toHaveBeenCalled();
    });

    it('415s an unknown extension with no declared mimeType', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/files/upload', payload: payload('blob.bin') });
        expect(res.statusCode).toBe(415);
    });
});

describe('POST /files/upload — size limits (S13)', () => {
    it('accepts a payload far above the global 256 KB body limit', async () => {
        // Before the per-route bodyLimit this 400 KB envelope died with a bare
        // Fastify 413 (FST_ERR_CTP_BODY_TOO_LARGE) — the real ceiling was ~190 KB.
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST',
            url: '/files/upload',
            payload: {
                filename: 'big.pdf',
                mimeType: 'application/pdf',
                contentBase64: Buffer.alloc(400 * 1024, 7).toString('base64'),
            },
        });

        expect(res.statusCode).toBe(201);
    });

    it('still reports FILE_TOO_LARGE above the decoded 25 MB cap', async () => {
        expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST',
            url: '/files/upload',
            payload: {
                filename: 'huge.pdf',
                mimeType: 'application/pdf',
                contentBase64: Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 7).toString('base64'),
            },
        });

        expect(res.statusCode).toBe(413);
        expect(res.json()).toMatchObject({ success: false, errorCode: 'FILE_TOO_LARGE' });
        expect(vi.mocked(storage.uploadToStorage)).not.toHaveBeenCalled();
    });
});
