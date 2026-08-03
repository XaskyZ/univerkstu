/**
 * Upload-then-attach helper for the social attachments flow.
 *
 * Two-step pipeline:
 *   1. POST the raw bytes to `/api/v3/files/upload` (base64 JSON envelope —
 *      avoids dragging `@fastify/multipart` into the backend for a single
 *      consumer) and receive a `fileId`.
 *   2. POST `{ fileId, mime, sizeBytes }` to
 *      `/api/v3/social/entities/:id/attachments` to register the attachment
 *      against the parent entity.
 *
 * Validation in step (1) is intentionally defensive: we trim the size and the
 * MIME prefix before sending so the backend never sees obviously-invalid
 * shapes. If either step fails we surface an `Error` with a stable message
 * that the UI can map to a localized string — wrapper components decide how
 * to display it.
 *
 * Boundaries:
 *  - This helper does NOT mutate any React state — callers (`AttachmentsList`)
 *    are expected to refresh their own list after a successful attach.
 *  - It does NOT touch the storage abstraction directly. The upload endpoint
 *    owns R2 / GridFS routing decisions.
 *  - The `fetch` and `attachSocialFile` defaults are injectable so unit tests
 *    do not have to stub global fetch + the api barrel together.
 */
import {
    API_URL,
    type ApiResponse,
} from '@/lib/api/core';
import {
    attachSocialFile as attachSocialFileDefault,
} from '@/lib/api/social';

/**
 * 25 MB cap — mirrors the backend post-decode guard in `routes/files.ts`. We
 * fail fast on the client so the user is not punished with a 25 MB roundtrip
 * before the rejection lands.
 */
export const SOCIAL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Allowed MIME prefixes. We deliberately keep this short — images, common
 * documents, and plain text. Anything else is rejected on the client (the
 * backend does not enforce this list today, so the cap is a UI policy).
 */
export const SOCIAL_ATTACHMENT_ALLOWED_MIME_PREFIXES = [
    'image/',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/csv',
] as const;

export interface UploadAndAttachDeps {
    /** Override the global fetch (tests stub a mocked `fetch`). */
    fetchImpl?: typeof fetch;
    /** Override the social-attach call. */
    attachSocialFile?: typeof attachSocialFileDefault;
    /** Override the file→base64 reader (lets tests bypass FileReader). */
    fileToBase64?: (file: File) => Promise<string>;
    /** Override the bearer token lookup (tests pass null/empty). */
    getToken?: () => string | null;
}

/**
 * Default File → base64 reader using FileReader (browser DOM). Strips the
 * `data:...;base64,` prefix so the wire payload is raw base64.
 */
async function defaultFileToBase64(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== 'string') {
                reject(new Error('reader-empty'));
                return;
            }
            const commaIdx = result.indexOf(',');
            resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error('reader-failed'));
        reader.readAsDataURL(file);
    });
}

function defaultGetToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem('token');
    } catch {
        return null;
    }
}

/**
 * Validate file size + MIME before reading any bytes. Returns a stable error
 * code so the UI layer can map to localized copy without parsing free text.
 */
export function validateAttachmentFile(file: File): { ok: true } | { ok: false; code: 'too-large' | 'invalid-mime' | 'empty' } {
    if (file.size <= 0) return { ok: false, code: 'empty' };
    if (file.size > SOCIAL_ATTACHMENT_MAX_BYTES) return { ok: false, code: 'too-large' };
    const mime = (file.type || '').toLowerCase();
    if (!mime) {
        // No declared MIME — accept (the backend will fall back to its own
        // detection). We don't want to reject empty-type files outright since
        // some browsers return `''` for plain text files.
        return { ok: true };
    }
    const allowed = SOCIAL_ATTACHMENT_ALLOWED_MIME_PREFIXES.some((prefix) =>
        mime === prefix || mime.startsWith(prefix),
    );
    if (!allowed) return { ok: false, code: 'invalid-mime' };
    return { ok: true };
}

interface UploadResponse {
    success: boolean;
    data?: { fileId: string };
    error?: string;
}

/**
 * Step 1: POST the file to `/api/v3/files/upload` and return the resulting
 * `fileId`. Throws an `Error` with one of the documented messages when the
 * upload fails — the caller (`uploadAndAttachFile`) maps these to a stable
 * surface for the UI.
 */
async function postFileUpload(
    file: File,
    deps: UploadAndAttachDeps,
): Promise<string> {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const fileToBase64 = deps.fileToBase64 ?? defaultFileToBase64;
    const getToken = deps.getToken ?? defaultGetToken;

    const contentBase64 = await fileToBase64(file);
    const token = getToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchImpl(`${API_URL}/api/v3/files/upload`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            filename: file.name || 'file.bin',
            mimeType: file.type || undefined,
            contentBase64,
        }),
    });
    let body: UploadResponse | null = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (!response.ok || !body || !body.success || !body.data?.fileId) {
        throw new Error(body?.error || `upload-failed:${response.status}`);
    }
    return body.data.fileId;
}

/**
 * Upload `file` to storage and attach the resulting `fileId` to `entityId`.
 *
 * Resolves with `{ id }` — the new `app_social_attachment.id`. Throws on
 * invalid file / upload failure / attach failure. Errors:
 *   - 'file-too-large'    — over `SOCIAL_ATTACHMENT_MAX_BYTES`
 *   - 'invalid-mime'      — MIME outside the allow-list
 *   - 'file-empty'        — zero-byte file
 *   - 'upload-failed:...' — POST /api/v3/files/upload returned non-2xx
 *   - 'attach-failed:...' — POST /api/v3/social/.../attachments failed
 */
export async function uploadAndAttachFile(
    entityId: string,
    file: File,
    deps: UploadAndAttachDeps = {},
): Promise<{ id: string }> {
    const validation = validateAttachmentFile(file);
    if (!validation.ok) {
        if (validation.code === 'too-large') throw new Error('file-too-large');
        if (validation.code === 'invalid-mime') throw new Error('invalid-mime');
        throw new Error('file-empty');
    }

    const fileId = await postFileUpload(file, deps);

    const attachSocialFile = deps.attachSocialFile ?? attachSocialFileDefault;
    const attachResponse: ApiResponse<{ id: string }> = await attachSocialFile(
        entityId,
        fileId,
        file.type || undefined,
        file.size,
    );
    if (!attachResponse.success || !attachResponse.data?.id) {
        throw new Error(
            attachResponse.error
                ? `attach-failed:${attachResponse.error}`
                : 'attach-failed:unknown',
        );
    }
    return { id: attachResponse.data.id };
}
