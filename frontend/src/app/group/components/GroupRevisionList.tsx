'use client';

import { useEffect, useState } from 'react';
import { getGroupContentRevisions, restoreGroupContentRevision, type GroupContentRevisionView, type GroupContentType } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { toast } from '@/lib/toast';

function formatDateTime(value: string | null | undefined, locale: string) {
    if (!value) return '—';
    return new Date(value).toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function GroupRevisionList({
    groupKey,
    contentType,
    entityId,
    canRestore = false,
}: {
    groupKey?: string;
    contentType: GroupContentType;
    entityId: string;
    canRestore?: boolean;
}) {
    const { messages, language } = useLanguage();
    const [revisions, setRevisions] = useState<GroupContentRevisionView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            const result = await getGroupContentRevisions(contentType, entityId, groupKey);
            if (cancelled) return;
            if (!result.success) {
                setError(result.error || 'Failed to load history');
                setLoading(false);
                return;
            }
            setRevisions(result.data?.revisions || []);
            setLoading(false);
        };
        void load();
        return () => { cancelled = true; };
    }, [contentType, entityId, groupKey]);

    return (
        <div className="rounded-2xl p-3 space-y-2 surface-overlay-1" style={{ border: '1px solid var(--border)' }}>
            <div className="text-sm font-medium text-fg">{messages.group.revisionHistoryTitle}</div>
            {loading ? <p className="text-sm text-muted-fg">{messages.common.loading}</p> : null}
            {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
            {!loading && !error && revisions.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.revisionHistoryEmpty}</p> : null}
            {revisions.map((revision) => (
                <div key={revision.id} className="rounded-xl p-3 flex items-start justify-between gap-3 surface-overlay-1">
                    <div>
                        <div className="text-sm font-medium text-fg">{revision.editedBy}</div>
                        <div className="text-xs mt-1 text-muted-fg">{formatDateTime(revision.editedAt, localeTag(language))}</div>
                    </div>
                    {canRestore ? (
                        <button
                            onClick={async () => {
                                const result = await restoreGroupContentRevision(revision.id);
                                if (result.success) {
                                    setRevisions((current) => current.filter((item) => item.id !== revision.id));
                                } else {
                                    toast.error(result.error || messages.group.rollbackFailed);
                                }
                            }}
                            className="chip"
                            data-tone="primary"
                            type="button"
                        >
                            {messages.group.rollback}
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}
