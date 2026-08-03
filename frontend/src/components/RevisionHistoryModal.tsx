'use client';

/**
 * Revision history modal — reads `app_social_revision` for a given social
 * entity and renders a newest-first timeline of create / update / delete /
 * restore events. Each update row can be expanded to show a field-by-field
 * diff against the immediately-previous revision (computed client-side via
 * `lib/social-diff.ts` — pure helper, no extra round-trips).
 *
 * Mount strategy: callers (`PostCard`, `TaskCard`, `LessonCard`, `EventCard`,
 * `PollCard`, the announcement card in CoordinatorPage) gate behind
 * `socialFeedBeta` and only mount this when the user opens it, so the lazy
 * fetch cost is paid per-card on demand instead of upfront.
 */

import { useEffect, useMemo, useState } from 'react';
import { Clock, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import {
    getSocialRevisions,
    type SocialRevisionView,
} from '@/lib/api/social';
import { diffSnapshots, type DiffEntry } from '@/lib/social-diff';
import { getRevisionHistoryUi } from './revision-history-i18n';

export interface RevisionHistoryModalProps {
    entityId: string;
    onClose: () => void;
}

function formatDate(value: string, locale: string): string {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString(locale, {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return value;
    }
}

/**
 * Render an arbitrary jsonb value as a short, human-readable string for the
 * diff column. Strings are quoted, primitives pass through, objects/arrays get
 * a JSON-stringified preview clipped to ~120 chars so the modal doesn't blow
 * up on a giant nested payload.
 */
function renderDiffValue(value: unknown): string {
    if (value === undefined) return '∅';
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        const serialized = JSON.stringify(value);
        if (typeof serialized !== 'string') return '∅';
        return serialized.length > 120 ? `${serialized.slice(0, 117)}…` : serialized;
    } catch {
        return '∅';
    }
}

function KindIcon({ kind }: { kind: SocialRevisionView['revisionKind'] }) {
    const common = { className: 'w-3.5 h-3.5', strokeWidth: 2.2, 'aria-hidden': true } as const;
    if (kind === 'create') return <Plus {...common} />;
    if (kind === 'update') return <Pencil {...common} />;
    if (kind === 'delete') return <Trash2 {...common} />;
    return <RotateCcw {...common} />;
}

function kindTone(kind: SocialRevisionView['revisionKind']): string {
    if (kind === 'create') return 'success';
    if (kind === 'update') return 'primary';
    if (kind === 'delete') return 'danger';
    return 'muted'; // restore
}

function diffRowTone(kind: DiffEntry['kind']): string {
    if (kind === 'added') return 'success';
    if (kind === 'removed') return 'danger';
    return 'primary';
}

export default function RevisionHistoryModal({ entityId, onClose }: RevisionHistoryModalProps) {
    const { language } = useLanguage();
    const ui = useMemo(() => getRevisionHistoryUi(language), [language]);

    const [revisions, setRevisions] = useState<SocialRevisionView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            const result = await getSocialRevisions(entityId);
            if (cancelled) return;
            if (!result.success) {
                setError(result.error || ui.errorGeneric);
                setRevisions([]);
                setLoading(false);
                return;
            }
            setRevisions(result.data?.revisions ?? []);
            setLoading(false);
        };
        void load();
        return () => { cancelled = true; };
    }, [entityId, ui.errorGeneric]);

    // Close on Escape — matches the dismissal UX of the other lightweight
    // modals in the project (CreatePollModal, GroupFormModal).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }
        return undefined;
    }, [onClose]);

    const toggleExpanded = (id: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Pre-compute the diff between adjacent revisions. The list is
    // newest-first; the "previous" revision for index `i` is at `i + 1`.
    // Memoizing avoids recomputing on every expand/collapse keystroke.
    const diffByRevisionId = useMemo(() => {
        const out = new Map<string, DiffEntry[]>();
        for (let i = 0; i < revisions.length; i++) {
            const current = revisions[i];
            if (current.revisionKind !== 'update') continue;
            const previous = revisions[i + 1];
            if (!previous) continue;
            out.set(current.id, diffSnapshots(previous.snapshot, current.snapshot));
        }
        return out;
    }, [revisions]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={ui.title}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={(e) => {
                // Only close on backdrop click — clicks inside the panel bubble
                // up here too, but we filter them by target identity.
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="rounded-3xl p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto space-y-3"
                style={{ background: 'var(--surface-base)', border: '1px solid var(--border)' }}
            >
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-fg">
                        <Clock className="w-4 h-4" aria-hidden />
                        <span>{ui.title}</span>
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={ui.close}
                        className="chip"
                        data-size="sm"
                    >
                        <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                </div>

                {loading ? (
                    <p className="text-sm text-muted-fg">{ui.loading}</p>
                ) : null}
                {error && !loading ? (
                    <p className="text-sm text-danger-fg">{error}</p>
                ) : null}
                {!loading && !error && revisions.length === 0 ? (
                    <p className="text-sm text-muted-fg">{ui.empty}</p>
                ) : null}

                <ol className="space-y-2">
                    {revisions.map((revision) => {
                        const isExpanded = expanded.has(revision.id);
                        const diff = diffByRevisionId.get(revision.id) ?? [];
                        const canExpand = revision.revisionKind === 'update';
                        const kindLabel =
                            revision.revisionKind === 'create' ? ui.kindCreate
                                : revision.revisionKind === 'update' ? ui.kindUpdate
                                    : revision.revisionKind === 'delete' ? ui.kindDelete
                                        : ui.kindRestore;
                        return (
                            <li
                                key={revision.id}
                                className="rounded-2xl p-3 space-y-2"
                                style={{
                                    border: '1px solid var(--border)',
                                    background: 'var(--surface-overlay-1)',
                                }}
                            >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span
                                            className="chip"
                                            data-tone={kindTone(revision.revisionKind)}
                                            data-size="sm"
                                        >
                                            <KindIcon kind={revision.revisionKind} />
                                            <span className="ml-1">{kindLabel}</span>
                                        </span>
                                        <span className="text-sm font-medium text-fg">
                                            {revision.authorUserId}
                                        </span>
                                        <span className="text-xs text-muted-fg">
                                            {formatDate(revision.createdAt, localeTag(language))}
                                        </span>
                                    </div>
                                    {canExpand ? (
                                        <button
                                            type="button"
                                            onClick={() => toggleExpanded(revision.id)}
                                            className="chip"
                                            data-size="sm"
                                            aria-expanded={isExpanded}
                                        >
                                            {isExpanded ? ui.collapse : ui.expand}
                                        </button>
                                    ) : null}
                                </div>

                                {revision.note ? (
                                    <p className="text-xs text-muted-fg">
                                        <span className="font-medium">{ui.deleteNoteLabel}:</span>{' '}
                                        {revision.note}
                                    </p>
                                ) : null}

                                {canExpand && isExpanded ? (
                                    <div
                                        className="rounded-xl p-3 space-y-2"
                                        style={{
                                            border: '1px solid var(--border)',
                                            background: 'var(--surface-overlay-2)',
                                        }}
                                    >
                                        <div className="text-xs font-semibold text-fg">
                                            {ui.diffHeading}
                                        </div>
                                        {diff.length === 0 ? (
                                            <p className="text-xs text-muted-fg">{ui.diffEmpty}</p>
                                        ) : (
                                            <ul className="space-y-2">
                                                {diff.map((row) => (
                                                    <li
                                                        key={row.path}
                                                        className="text-xs space-y-1"
                                                    >
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span
                                                                className="chip"
                                                                data-tone={diffRowTone(row.kind)}
                                                                data-size="sm"
                                                            >
                                                                {row.kind === 'added' ? ui.diffAdded
                                                                    : row.kind === 'removed' ? ui.diffRemoved
                                                                        : ui.diffChanged}
                                                            </span>
                                                            <code className="text-xs text-fg">{row.path}</code>
                                                        </div>
                                                        {row.kind !== 'added' ? (
                                                            <div className="text-xs text-muted-fg">
                                                                <span className="font-medium">{ui.diffBefore}:</span>{' '}
                                                                <code>{renderDiffValue(row.before)}</code>
                                                            </div>
                                                        ) : null}
                                                        {row.kind !== 'removed' ? (
                                                            <div className="text-xs text-muted-fg">
                                                                <span className="font-medium">{ui.diffAfter}:</span>{' '}
                                                                <code>{renderDiffValue(row.after)}</code>
                                                            </div>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ol>
            </div>
        </div>
    );
}
