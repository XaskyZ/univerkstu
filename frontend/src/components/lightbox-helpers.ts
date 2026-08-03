/**
 * Pure helpers for the image lightbox / gallery flow on top of
 * `SocialAttachment` rows.
 *
 * No React, no DOM, no localStorage — these are exercised by
 * `lightbox-helpers.test.ts` so the runtime behaviour stays predictable
 * across the component (`ImageLightbox.tsx`) and any callers that want to
 * pre-compute a navigation list (e.g. `AttachmentsList`).
 */

import type { SocialAttachment } from '@/lib/api/social';

/**
 * Browser-renderable MIME prefixes for the lightbox. We keep the set
 * conservative: SVG (`image/svg+xml`) is intentionally excluded because it
 * can ship inline scripts, and we don't sanitize the response here.
 */
const RENDERABLE_IMAGE_MIMES = new Set<string>([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
]);

/**
 * Returns true when the given MIME refers to a raster image format the
 * browser can render directly inside an `<img>` tag. Case-insensitive and
 * tolerant of `null` / `undefined` so callers can pipe raw
 * `SocialAttachment.mime` values without pre-checking.
 *
 * Examples:
 *   isImageMime('image/jpeg')        → true
 *   isImageMime('IMAGE/PNG')         → true
 *   isImageMime('image/svg+xml')     → false (excluded by design)
 *   isImageMime('application/pdf')   → false
 *   isImageMime(null)                → false
 */
export function isImageMime(mime: string | null | undefined): boolean {
    if (typeof mime !== 'string') return false;
    const value = mime.trim().toLowerCase();
    if (!value) return false;
    return RENDERABLE_IMAGE_MIMES.has(value);
}

/**
 * Pre-built navigation item for `ImageLightbox`. We snapshot only the
 * fields the lightbox actually needs so the component never re-derives URLs
 * from arbitrary `SocialAttachment` shapes at render time.
 */
export interface LightboxItem {
    /** Attachment row id (stable React key). */
    attachmentId: string;
    /** Underlying R2/UMKD file id used to build the download URL. */
    fileId: string;
    /** Absolute or root-relative URL to the original file. */
    downloadUrl: string;
    /** Original upload filename (may be `null` when unknown). */
    filename: string | null;
    /** MIME type (always an image/* known to the browser). */
    mime: string;
    /** Size in bytes (may be `null` when unknown). */
    sizeBytes: number | null;
}

/**
 * Build a download URL for a file id. Kept private so callers can't
 * accidentally bypass `encodeURIComponent` on user-controlled ids.
 */
function buildDownloadUrl(apiBase: string, fileId: string): string {
    const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
    return `${base}/api/v3/files/${encodeURIComponent(fileId)}`;
}

/**
 * Filter the given attachments down to a navigable lightbox list,
 * preserving the input order. The order matters because callers usually
 * want gallery navigation to match the visual order on the page (e.g.
 * `sortOrder ASC` returned by the backend).
 *
 * Non-image rows are dropped silently. Rows missing a `fileId` are also
 * dropped — without it we couldn't build a download URL anyway.
 */
export function buildLightboxItems(
    attachments: SocialAttachment[],
    apiBase: string,
): LightboxItem[] {
    const out: LightboxItem[] = [];
    for (const att of attachments) {
        if (!isImageMime(att.mime)) continue;
        if (typeof att.fileId !== 'string' || att.fileId.length === 0) continue;
        out.push({
            attachmentId: att.id,
            fileId: att.fileId,
            downloadUrl: buildDownloadUrl(apiBase, att.fileId),
            filename: att.filename ?? null,
            mime: (att.mime ?? '').toLowerCase(),
            sizeBytes: typeof att.sizeBytes === 'number' ? att.sizeBytes : null,
        });
    }
    return out;
}

/**
 * Locate the index of the image with the given `fileId` inside a
 * lightbox-items list. Returns `-1` when the id is missing so callers can
 * fall back to opening the gallery at the first image:
 *
 *   const idx = findImageIndex(items, target);
 *   open(idx >= 0 ? idx : 0);
 */
export function findImageIndex(items: LightboxItem[], fileId: string): number {
    if (typeof fileId !== 'string' || fileId.length === 0) return -1;
    for (let i = 0; i < items.length; i += 1) {
        if (items[i].fileId === fileId) return i;
    }
    return -1;
}
