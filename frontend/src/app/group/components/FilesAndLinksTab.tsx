'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import { confirmDialog } from '@/lib/confirm-dialog';
import {
    addGroupFile,
    addGroupLink,
    deleteGroupFile,
    deleteGroupLink,
    getGroupFiles,
    getGroupLinks,
    type GroupFileEntryView,
    type GroupLinkView,
} from '@/lib/api';
import GroupFormModal from './GroupFormModal';

/**
 * Files & Links tab.
 *
 * The "Files" section is a registry of pointers to already-uploaded storage
 * objects (R2 fileIds). The actual upload pipeline is the existing UMKD /
 * storage flow — this tab does not implement multipart upload itself. A user
 * who already has a fileId can register it here with a friendlier title +
 * description so the group can find it.
 *
 * If you ever need to attach a file from outside the existing storage (e.g.
 * Google Drive), use the Links section instead — that's exactly what it's for.
 */
export default function FilesAndLinksTab({
    groupKey,
    canRead,
    canManage,
}: {
    groupKey: string;
    canRead: boolean;
    canManage: boolean;
}) {
    const { messages } = useLanguage();
    const [links, setLinks] = useState<GroupLinkView[]>([]);
    const [files, setFiles] = useState<GroupFileEntryView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [linkModalOpen, setLinkModalOpen] = useState(false);
    const [fileModalOpen, setFileModalOpen] = useState(false);
    const [actionError, setActionError] = useState('');

    const refresh = useCallback(async () => {
        if (!canRead || !groupKey) {
            setLinks([]);
            setFiles([]);
            return;
        }
        setLoading(true);
        setError('');
        const [linksRes, filesRes] = await Promise.all([
            getGroupLinks(groupKey),
            getGroupFiles(groupKey),
        ]);
        if (!linksRes.success || !filesRes.success) {
            setError(linksRes.error || filesRes.error || messages.group.loadFilesLinksError);
            setLoading(false);
            return;
        }
        setLinks(linksRes.data?.links || []);
        setFiles(filesRes.data?.files || []);
        setLoading(false);
    }, [canRead, groupKey, messages.group.loadFilesLinksError]);

    useEffect(() => {
        // Defer to next tick so React batching doesn't ping the network during
        // commit — same pattern the other tabs use.
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const onDeleteLink = useCallback(async (linkId: string) => {
        if (!groupKey) return;
        if (!(await confirmDialog(messages.group.deleteLinkConfirm, { danger: true }))) {
            return;
        }
        setActionError('');
        const res = await deleteGroupLink(groupKey, linkId);
        if (!res.success) {
            setActionError(res.error || messages.group.deleteLinkFailed);
            return;
        }
        await refresh();
    }, [groupKey, messages.group.deleteLinkConfirm, messages.group.deleteLinkFailed, refresh]);

    const onDeleteFile = useCallback(async (fileEntryId: string) => {
        if (!groupKey) return;
        if (!(await confirmDialog(messages.group.deleteFileConfirm, { danger: true }))) {
            return;
        }
        setActionError('');
        const res = await deleteGroupFile(groupKey, fileEntryId);
        if (!res.success) {
            setActionError(res.error || messages.group.deleteFileFailed);
            return;
        }
        await refresh();
    }, [groupKey, messages.group.deleteFileConfirm, messages.group.deleteFileFailed, refresh]);

    return (
        <div className="space-y-4">
            <section className="card p-5 space-y-4 animate-fadeInUp">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="font-semibold text-fg">{messages.group.filesLinksTitle}</h3>
                        <p className="text-sm mt-1 text-muted-fg">{messages.group.filesLinksSubtitle}</p>
                    </div>
                </div>

                {loading ? <p className="text-sm text-muted-fg">{messages.group.loadingFilesLinks}</p> : null}
                {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
                {actionError ? <p className="text-sm text-danger-fg">{actionError}</p> : null}
            </section>

            <section className="card p-5 space-y-4 animate-fadeInUp">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h4 className="font-semibold text-fg">{messages.group.linksSection}</h4>
                    {canManage ? (
                        <button
                            onClick={() => setLinkModalOpen(true)}
                            className="btn btn-primary px-4 py-2 text-sm"
                            type="button"
                        >
                            {messages.group.addLink}
                        </button>
                    ) : null}
                </div>

                {!loading && links.length === 0 ? (
                    <p className="text-sm text-muted-fg">{messages.group.emptyLinks}</p>
                ) : (
                    <ul className="space-y-3">
                        {links.map((link) => (
                            <li
                                key={link.id}
                                className="rounded-xl p-3"
                                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                            >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="space-y-1 min-w-0">
                                        <p className="font-medium text-fg break-words">{link.title}</p>
                                        <a
                                            href={link.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm break-all"
                                            style={{ color: 'var(--primary)' }}
                                        >
                                            {link.url}
                                        </a>
                                        {link.description ? (
                                            <p className="text-sm text-muted-fg whitespace-pre-wrap">{link.description}</p>
                                        ) : null}
                                        <p className="text-xs text-muted-fg">
                                            {messages.group.addedBy} {link.createdBy}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <a
                                            href={link.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="chip"
                                            type="button"
                                        >
                                            {messages.group.openLink}
                                        </a>
                                        {canManage ? (
                                            <button
                                                onClick={() => void onDeleteLink(link.id)}
                                                className="chip"
                                                data-tone="danger"
                                                type="button"
                                            >
                                                {messages.common.delete}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="card p-5 space-y-4 animate-fadeInUp">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h4 className="font-semibold text-fg">{messages.group.filesSection}</h4>
                    {canManage ? (
                        <button
                            onClick={() => setFileModalOpen(true)}
                            className="btn btn-primary px-4 py-2 text-sm"
                            type="button"
                        >
                            {messages.group.addFile}
                        </button>
                    ) : null}
                </div>

                {!loading && files.length === 0 ? (
                    <p className="text-sm text-muted-fg">{messages.group.emptyFiles}</p>
                ) : (
                    <ul className="space-y-3">
                        {files.map((file) => (
                            <li
                                key={file.id}
                                className="rounded-xl p-3"
                                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                            >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="space-y-1 min-w-0">
                                        <p className="font-medium text-fg break-words">{file.title}</p>
                                        {file.description ? (
                                            <p className="text-sm text-muted-fg whitespace-pre-wrap">{file.description}</p>
                                        ) : null}
                                        <p className="text-xs text-muted-fg break-all">
                                            {file.mime ? `${file.mime}` : null}
                                            {file.mime && file.sizeBytes != null ? ' • ' : null}
                                            {file.sizeBytes != null ? `${file.sizeBytes} B` : null}
                                        </p>
                                        <p className="text-xs text-muted-fg">
                                            {messages.group.addedBy} {file.createdBy}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <a
                                            href={`/api/v3/files/${encodeURIComponent(file.fileId)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="chip"
                                        >
                                            {messages.group.downloadFile}
                                        </a>
                                        {canManage ? (
                                            <button
                                                onClick={() => void onDeleteFile(file.id)}
                                                className="chip"
                                                data-tone="danger"
                                                type="button"
                                            >
                                                {messages.common.delete}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <GroupFormModal
                open={linkModalOpen}
                title={messages.group.addLink}
                submitLabel={messages.group.addLink}
                onCancel={() => setLinkModalOpen(false)}
                onSubmit={async (values) => {
                    setActionError('');
                    const title = String(values.title || '').trim();
                    const url = String(values.url || '').trim();
                    const description = String(values.description || '').trim();
                    if (!title || !url) return;
                    const res = await addGroupLink(groupKey, {
                        title,
                        url,
                        description: description || null,
                    });
                    if (!res.success) {
                        // Surface the validator message (e.g. invalidUrl rule) instead of
                        // a generic "failed" — server already gives precise feedback.
                        setActionError(res.error || messages.group.addLinkFailed);
                        return;
                    }
                    setLinkModalOpen(false);
                    await refresh();
                }}
                fields={[
                    {
                        name: 'title',
                        label: messages.group.linkTitlePlaceholder,
                        type: 'text',
                        required: true,
                        placeholder: messages.group.linkTitlePlaceholder,
                    },
                    {
                        name: 'url',
                        label: 'URL',
                        type: 'text',
                        required: true,
                        placeholder: messages.group.linkUrlPlaceholder,
                    },
                    {
                        name: 'description',
                        label: messages.group.linkDescriptionPlaceholder,
                        type: 'textarea',
                        placeholder: messages.group.linkDescriptionPlaceholder,
                    },
                ]}
            />

            <GroupFormModal
                open={fileModalOpen}
                title={messages.group.addFile}
                submitLabel={messages.group.addFile}
                onCancel={() => setFileModalOpen(false)}
                onSubmit={async (values) => {
                    setActionError('');
                    const title = String(values.title || '').trim();
                    const fileId = String(values.fileId || '').trim();
                    const description = String(values.description || '').trim();
                    const mime = String(values.mime || '').trim();
                    const sizeRaw = String(values.sizeBytes || '').trim();
                    const sizeBytes = sizeRaw ? Number(sizeRaw) : null;
                    if (!title || !fileId) return;
                    const res = await addGroupFile(groupKey, {
                        title,
                        fileId,
                        description: description || null,
                        mime: mime || null,
                        sizeBytes: sizeBytes != null && Number.isFinite(sizeBytes) ? sizeBytes : null,
                    });
                    if (!res.success) {
                        setActionError(res.error || messages.group.addFileFailed);
                        return;
                    }
                    setFileModalOpen(false);
                    await refresh();
                }}
                fields={[
                    {
                        name: 'title',
                        label: messages.group.fileTitlePlaceholder,
                        type: 'text',
                        required: true,
                        placeholder: messages.group.fileTitlePlaceholder,
                    },
                    {
                        name: 'fileId',
                        label: messages.group.fileIdPlaceholder,
                        type: 'text',
                        required: true,
                        placeholder: messages.group.fileIdPlaceholder,
                    },
                    {
                        name: 'mime',
                        label: messages.group.fileMimePlaceholder,
                        type: 'text',
                        placeholder: messages.group.fileMimePlaceholder,
                    },
                    {
                        name: 'sizeBytes',
                        label: messages.group.fileSizePlaceholder,
                        type: 'text',
                        placeholder: messages.group.fileSizePlaceholder,
                    },
                    {
                        name: 'description',
                        label: messages.group.fileDescriptionPlaceholder,
                        type: 'textarea',
                        placeholder: messages.group.fileDescriptionPlaceholder,
                    },
                ]}
            />
        </div>
    );
}
