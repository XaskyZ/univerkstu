/**
 * Unit tests for `social-attachment-upload`. Covers:
 *  - successful upload + attach (happy path)
 *  - size validation (file too large)
 *  - MIME validation (rejected MIME prefix)
 *  - upload failure (POST /api/v3/files/upload returns non-2xx)
 *  - attach failure (attachSocialFile returns success=false)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SOCIAL_ATTACHMENT_MAX_BYTES,
    uploadAndAttachFile,
    validateAttachmentFile,
} from './social-attachment-upload';

function makeFile(opts: { name?: string; type?: string; size?: number; content?: string } = {}): File {
    const name = opts.name ?? 'photo.png';
    const type = opts.type ?? 'image/png';
    const content = opts.content ?? 'abc';
    // We can't easily fake `File.size` to a different value than the blob —
    // for the size-cap tests we just construct a real blob of the requested
    // length so `file.size` matches.
    const size = opts.size ?? content.length;
    const buffer = new Uint8Array(size).fill(65);
    const blob = new Blob([buffer], { type });
    return new File([blob], name, { type });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('validateAttachmentFile', () => {
    it('rejects empty files', () => {
        const file = makeFile({ size: 0 });
        expect(validateAttachmentFile(file)).toEqual({ ok: false, code: 'empty' });
    });

    it('rejects files above the size cap', () => {
        // We don't allocate a real 25MB+ buffer — instead override `size` via
        // Object.defineProperty so the validator sees the inflated value.
        const file = makeFile({ size: 16, type: 'image/png' });
        Object.defineProperty(file, 'size', {
            value: SOCIAL_ATTACHMENT_MAX_BYTES + 1,
        });
        expect(validateAttachmentFile(file)).toEqual({ ok: false, code: 'too-large' });
    });

    it('rejects disallowed MIME prefixes', () => {
        const file = makeFile({ type: 'application/x-shockwave-flash', size: 32 });
        expect(validateAttachmentFile(file)).toEqual({ ok: false, code: 'invalid-mime' });
    });

    it('accepts image/* files within the cap', () => {
        expect(validateAttachmentFile(makeFile({ type: 'image/png', size: 1024 }))).toEqual({ ok: true });
        expect(validateAttachmentFile(makeFile({ type: 'image/jpeg', size: 1024 }))).toEqual({ ok: true });
    });

    it('accepts pdfs and docs', () => {
        expect(validateAttachmentFile(makeFile({ type: 'application/pdf', size: 1024 }))).toEqual({ ok: true });
        expect(
            validateAttachmentFile(makeFile({
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                size: 1024,
            })),
        ).toEqual({ ok: true });
    });
});

describe('uploadAndAttachFile', () => {
    let fetchImpl: ReturnType<typeof vi.fn>;
    let attachSocialFile: ReturnType<typeof vi.fn>;
    let fileToBase64: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 201,
            json: async () => ({ success: true, data: { fileId: 'file-1' } }),
        } as unknown as Response));
        attachSocialFile = vi.fn(async () => ({
            success: true,
            data: { id: 'att-1' },
        }));
        fileToBase64 = vi.fn(async () => 'YWJj'); // "abc" base64
    });

    it('uploads and attaches successfully (happy path)', async () => {
        const file = makeFile({ name: 'photo.png', type: 'image/png', content: 'abc' });
        const result = await uploadAndAttachFile('entity-1', file, {
            fetchImpl,
            attachSocialFile,
            fileToBase64,
            getToken: () => 'jwt.token',
        });
        expect(result).toEqual({ id: 'att-1' });

        // Upload call shape
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toMatch(/\/api\/v3\/files\/upload$/);
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.filename).toBe('photo.png');
        expect(body.mimeType).toBe('image/png');
        expect(body.contentBase64).toBe('YWJj');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer jwt.token');
        expect(headers['Content-Type']).toBe('application/json');

        // Attach call shape
        expect(attachSocialFile).toHaveBeenCalledWith(
            'entity-1',
            'file-1',
            'image/png',
            file.size,
        );
    });

    it('rejects oversized files before hitting the network', async () => {
        const file = makeFile({ type: 'image/png', size: 1 });
        Object.defineProperty(file, 'size', { value: SOCIAL_ATTACHMENT_MAX_BYTES + 1 });
        await expect(
            uploadAndAttachFile('entity-1', file, { fetchImpl, attachSocialFile, fileToBase64 }),
        ).rejects.toThrow('file-too-large');
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(attachSocialFile).not.toHaveBeenCalled();
    });

    it('rejects disallowed MIME types before hitting the network', async () => {
        const file = makeFile({ type: 'application/x-evil', size: 32 });
        await expect(
            uploadAndAttachFile('entity-1', file, { fetchImpl, attachSocialFile, fileToBase64 }),
        ).rejects.toThrow('invalid-mime');
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(attachSocialFile).not.toHaveBeenCalled();
    });

    it('throws when the upload endpoint fails with a non-2xx body', async () => {
        fetchImpl.mockResolvedValueOnce({
            ok: false,
            status: 413,
            json: async () => ({ success: false, error: 'file too large' }),
        } as unknown as Response);
        const file = makeFile({ type: 'image/png', size: 32 });
        await expect(
            uploadAndAttachFile('entity-1', file, { fetchImpl, attachSocialFile, fileToBase64 }),
        ).rejects.toThrow(/file too large/);
        expect(attachSocialFile).not.toHaveBeenCalled();
    });

    it('throws when the attach call returns success=false', async () => {
        attachSocialFile.mockResolvedValueOnce({
            success: false,
            error: 'forbidden',
            errorCode: 'SOCIAL_FORBIDDEN',
            statusCode: 403,
        });
        const file = makeFile({ type: 'image/png', size: 32 });
        await expect(
            uploadAndAttachFile('entity-1', file, { fetchImpl, attachSocialFile, fileToBase64 }),
        ).rejects.toThrow(/attach-failed:forbidden/);
        // Upload was attempted exactly once before the failure.
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
