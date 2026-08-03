'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import {
    API_URL,
} from '@/lib/api/core';
import {
    getSocialAttachments,
    removeSocialAttachment,
    type SocialAttachment,
} from '@/lib/api/social';
import {
    uploadAndAttachFile,
} from '@/app/group/utils/social-attachment-upload';
import { formatMimeFallback, getAttachmentsUi } from './attachments-list-i18n';
import {
    buildLightboxItems,
    findImageIndex,
    isImageMime,
} from './lightbox-helpers';
import ImageLightbox from './ImageLightbox';

export interface AttachmentsListProps {
    /** Universal social entity id (`app_social_entity.id`). */
    entityId: string;
    /**
     * Viewer's user id. When provided alongside `enableEdit`, the component
     * exposes the "Attach file" button and per-row delete affordance for the
     * entity's author. Without it the list stays read-only even if `enableEdit`
     * is set (you can't take ownership decisions without a viewer).
     */
    currentUserId?: string;
    /**
     * When true (and `currentUserId` is set), render the upload button and
     * per-row delete control. Callers gate this on `post.authorUserId ===
     * currentUserId` so non-authors never see the controls.
     */
    enableEdit?: boolean;
}

/**
 * Universal attachments surface for any social entity (currently used by
 * `PostCard` behind the `socialFeedBeta` flag). Loads attachments lazily on
 * mount and re-fetches after every successful upload / delete.
 *
 * Rendering:
 *   - One chip per attachment with a filename surrogate (file id short hash),
 *     MIME hint, human-friendly size, and a download link to
 *     `GET /api/v3/files/:fileId`. The delete button is only rendered when
 *     `enableEdit && currentUserId` is set.
 *
 * Network:
 *   - `getSocialAttachments` for listing.
 *   - `uploadAndAttachFile` for the upload + attach pipeline.
 *   - `removeSocialAttachment` for delete.
 *
 * No hex / `dark:*` classes — every coloured surface uses semantic CSS vars.
 */
export default function AttachmentsList({
    entityId,
    currentUserId,
    enableEdit,
}: AttachmentsListProps) {
    const { language } = useLanguage();
    const ui = useMemo(() => getAttachmentsUi(language), [language]);

    type Status = 'loading' | 'ready' | 'error';
    const [status, setStatus] = useState<Status>('loading');
    const [items, setItems] = useState<SocialAttachment[]>([]);
    const [uploading, setUploading] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const canEdit = Boolean(enableEdit && currentUserId);

    // Pre-derive image-only navigation items. Recomputed on every `items`
    // change so newly attached / removed images stay in sync with the
    // lightbox state.
    const lightboxItems = useMemo(
        () => buildLightboxItems(items, API_URL),
        [items],
    );

    // Split attachments into (image thumbnails) and (other chips). Order is
    // preserved within each bucket so the visual sort matches the
    // backend-provided `sortOrder ASC` ordering.
    const { imageRows, otherRows } = useMemo(() => {
        const imageRowsAcc: SocialAttachment[] = [];
        const otherRowsAcc: SocialAttachment[] = [];
        for (const att of items) {
            if (isImageMime(att.mime)) {
                imageRowsAcc.push(att);
            } else {
                otherRowsAcc.push(att);
            }
        }
        return { imageRows: imageRowsAcc, otherRows: otherRowsAcc };
    }, [items]);

    const openLightboxFor = useCallback(
        (fileId: string) => {
            const idx = findImageIndex(lightboxItems, fileId);
            setLightboxIndex(idx >= 0 ? idx : 0);
        },
        [lightboxItems],
    );

    const closeLightbox = useCallback(() => {
        setLightboxIndex(null);
    }, []);

    // If the underlying list shrinks (e.g. the open image was deleted) make
    // sure the lightbox doesn't dangle pointing past the end.
    useEffect(() => {
        if (lightboxIndex === null) return;
        if (lightboxItems.length === 0) {
            setLightboxIndex(null);
        } else if (lightboxIndex >= lightboxItems.length) {
            setLightboxIndex(lightboxItems.length - 1);
        }
    }, [lightboxIndex, lightboxItems.length]);

    const fetchAll = useCallback(async () => {
        const response = await getSocialAttachments(entityId);
        if (!response.success) {
            throw new Error(response.error || 'load failed');
        }
        const next = response.data?.attachments ?? [];
        setItems(next);
        return next;
    }, [entityId]);

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        setActionError(null);
        fetchAll()
            .then(() => {
                if (!cancelled) setStatus('ready');
            })
            .catch(() => {
                if (!cancelled) setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [fetchAll]);

    const handleFileSelected = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            // Reset the input so the same file can be re-selected after an
            // error without remounting the component.
            event.target.value = '';
            if (!file || uploading) return;
            setActionError(null);
            setUploading(true);
            try {
                await uploadAndAttachFile(entityId, file);
                await fetchAll();
            } catch (err) {
                const message = err instanceof Error ? err.message : '';
                if (message === 'file-too-large') {
                    setActionError(ui.fileTooLarge);
                } else if (message === 'invalid-mime') {
                    setActionError(ui.invalidMime);
                } else {
                    setActionError(ui.uploadFailed);
                }
            } finally {
                setUploading(false);
            }
        },
        [entityId, uploading, fetchAll, ui],
    );

    const handleDelete = useCallback(
        async (attachmentId: string) => {
            setActionError(null);
            const response = await removeSocialAttachment(entityId, attachmentId);
            if (!response.success) {
                setActionError(response.error || ui.uploadFailed);
                return;
            }
            await fetchAll();
        },
        [entityId, fetchAll, ui.uploadFailed],
    );

    return (
        <section
            aria-label={ui.heading}
            className="space-y-2"
        >
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h5
                    style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--text)',
                    }}
                >
                    {ui.heading}
                </h5>
                {canEdit ? (
                    <>
                        <input
                            ref={fileInputRef}
                            type="file"
                            aria-label={ui.fileInputLabel}
                            onChange={(e) => void handleFileSelected(e)}
                            style={{ display: 'none' }}
                            disabled={uploading}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="btn"
                            style={{
                                fontSize: 12,
                                padding: '4px 10px',
                                borderRadius: 10,
                                background: 'transparent',
                                border: '1px solid var(--border)',
                                color: 'var(--text)',
                                cursor: uploading ? 'not-allowed' : 'pointer',
                                opacity: uploading ? 0.6 : 1,
                            }}
                        >
                            {uploading ? ui.uploading : ui.attachButton}
                        </button>
                    </>
                ) : null}
            </div>

            {status === 'loading' ? (
                <p
                    style={{
                        margin: 0,
                        fontSize: 12,
                        color: 'var(--muted)',
                    }}
                    role="status"
                    aria-live="polite"
                >
                    {ui.loading}
                </p>
            ) : null}

            {status === 'error' ? (
                <p
                    role="alert"
                    style={{
                        margin: 0,
                        fontSize: 12,
                        color: 'var(--status-danger-color, var(--text))',
                    }}
                >
                    {ui.loadFailed}
                </p>
            ) : null}

            {status === 'ready' && items.length === 0 && !canEdit ? (
                <p
                    style={{
                        margin: 0,
                        fontSize: 12,
                        color: 'var(--muted)',
                    }}
                >
                    {ui.empty}
                </p>
            ) : null}

            {status === 'ready' && imageRows.length > 0 ? (
                <ul
                    style={{
                        listStyle: 'none',
                        margin: 0,
                        padding: 0,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                    }}
                >
                    {imageRows.map((att) => (
                        <li
                            key={att.id}
                            style={{
                                position: 'relative',
                                width: 64,
                                height: 64,
                                borderRadius: 10,
                                overflow: 'hidden',
                                background: 'var(--surface-overlay-1)',
                                border: '1px solid var(--border)',
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => openLightboxFor(att.fileId)}
                                aria-label={att.filename || ui.downloadLabel}
                                title={att.filename || att.fileId}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    height: '100%',
                                    padding: 0,
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'zoom-in',
                                }}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={`${API_URL}/api/v3/files/${encodeURIComponent(att.fileId)}`}
                                    alt={att.filename || ''}
                                    loading="lazy"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        display: 'block',
                                    }}
                                />
                            </button>
                            {canEdit ? (
                                <button
                                    type="button"
                                    onClick={() => void handleDelete(att.id)}
                                    aria-label={ui.deleteLabel}
                                    style={{
                                        position: 'absolute',
                                        top: 2,
                                        right: 2,
                                        width: 20,
                                        height: 20,
                                        borderRadius: 999,
                                        background: 'rgba(0, 0, 0, 0.55)',
                                        color: '#fff',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: 11,
                                        lineHeight: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    ✕
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}

            {status === 'ready' && otherRows.length > 0 ? (
                <ul
                    className="space-y-1"
                    style={{ listStyle: 'none', margin: 0, padding: 0 }}
                >
                    {otherRows.map((att) => (
                        <li
                            key={att.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '6px 10px',
                                borderRadius: 10,
                                background: 'var(--surface-overlay-1)',
                                border: '1px solid var(--border)',
                            }}
                        >
                            <span aria-hidden="true">📎</span>
                            <a
                                href={`${API_URL}/api/v3/files/${encodeURIComponent(att.fileId)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    color: 'var(--primary)',
                                    textDecoration: 'underline',
                                    fontSize: 13,
                                    flex: 1,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                aria-label={ui.downloadLabel}
                                title={att.filename || att.fileId}
                            >
                                {att.filename || formatMimeFallback(att.mime)}
                            </a>
                            {typeof att.sizeBytes === 'number' ? (
                                <span
                                    style={{
                                        fontSize: 12,
                                        color: 'var(--muted)',
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {ui.formatSize(att.sizeBytes)}
                                </span>
                            ) : null}
                            {canEdit ? (
                                <button
                                    type="button"
                                    onClick={() => void handleDelete(att.id)}
                                    aria-label={ui.deleteLabel}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--muted)',
                                        cursor: 'pointer',
                                        fontSize: 14,
                                        padding: 4,
                                    }}
                                >
                                    ✕
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}

            {lightboxIndex !== null && lightboxItems.length > 0 ? (
                <ImageLightbox
                    items={lightboxItems}
                    initialIndex={lightboxIndex}
                    onClose={closeLightbox}
                />
            ) : null}

            {actionError ? (
                <p
                    role="alert"
                    style={{
                        margin: 0,
                        fontSize: 12,
                        color: 'var(--status-danger-color, var(--text))',
                    }}
                >
                    {actionError}
                </p>
            ) : null}
        </section>
    );
}
