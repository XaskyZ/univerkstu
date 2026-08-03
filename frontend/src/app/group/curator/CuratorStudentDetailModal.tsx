'use client';

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/lib/language-context';
import type { CuratorStudentDetail } from '@/lib/api';
import { getCuratorUi } from './strings';
import { formatDateTime } from './utils';

type ManagedRole = 'starosta' | 'helper';

interface CuratorStudentDetailModalProps {
    student: CuratorStudentDetail | null;
    loading?: boolean;
    roleAction?: ManagedRole | '';
    onClose: () => void;
    onToggleRole: (roleId: ManagedRole, enabled: boolean) => void;
}

function InfoTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)' }}>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-fg">{label}</div>
            <div className="mt-2 text-sm font-medium text-fg">{value || '—'}</div>
        </div>
    );
}

export default function CuratorStudentDetailModal({
    student,
    loading = false,
    roleAction = '',
    onClose,
    onToggleRole,
}: CuratorStudentDetailModalProps) {
    const { language } = useLanguage();
    const locale = language === 'en' ? 'en-US' : language === 'kz' ? 'kk-KZ' : 'ru-RU';
    const ui = useMemo(() => getCuratorUi(language), [language]);

    useEffect(() => {
        if (!student && !loading) return;

        const prevHtmlOverflow = document.documentElement.style.overflow;
        const prevBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        return () => {
            document.documentElement.style.overflow = prevHtmlOverflow;
            document.body.style.overflow = prevBodyOverflow;
        };
    }, [loading, student]);

    useEffect(() => {
        if (!student && !loading) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [loading, onClose, student]);

    if ((!student && !loading) || typeof window === 'undefined') return null;

    const hasStarosta = Boolean(student?.roles.includes('starosta'));
    const hasHelper = Boolean(student?.roles.includes('helper'));
    const topRole = hasStarosta ? 'starosta' : hasHelper ? 'helper' : 'member';
    const roleLabel = topRole === 'starosta' ? ui.roleStarosta : topRole === 'helper' ? ui.roleHelper : ui.roleMember;

    return createPortal(
        <div className="fixed inset-0 z-[220] flex items-start justify-center p-2 sm:p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div
                className="relative w-full max-w-2xl max-h-[calc(100dvh-16px)] sm:max-h-[calc(100dvh-32px)] rounded-3xl border overflow-hidden flex flex-col"
                style={{ borderColor: 'var(--border)', background: 'rgba(8,11,24,0.98)' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="sticky top-0 z-10 px-5 py-4 flex items-start justify-between gap-4" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(8,11,24,0.96)' }}>
                    <div className="min-w-0">
                        <div className="text-2xl font-semibold truncate text-fg">
                            {student?.fullName || student?.userId || ui.loading}
                        </div>
                        {student ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <span className="chip" data-tone="muted">{student.userId}</span>
                                <span className="chip" data-tone="muted">{student.groupKey}</span>
                                <span
                                    className="px-2.5 py-1 rounded-full"
                                    style={{
                                        background: topRole === 'starosta' ? 'rgba(var(--primary-rgb), 0.18)' : topRole === 'helper' ? 'rgba(var(--good-rgb), 0.16)' : 'var(--surface-overlay-3)',
                                        color: topRole === 'starosta' ? 'var(--primary)' : topRole === 'helper' ? 'var(--good)' : 'var(--text)',
                                    }}
                                >
                                    {roleLabel}
                                </span>
                            </div>
                        ) : null}
                    </div>
                    <button onClick={onClose} className="chip" data-tone="muted" data-size="lg" type="button">
                        {ui.close}
                    </button>
                </div>

                <div className="overflow-y-auto p-5 space-y-4">
                    {loading || !student ? (
                        <div className="rounded-3xl p-6 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)', color: 'var(--muted)' }}>
                            {ui.loading}
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <InfoTile label={ui.fullName} value={student.fullName || student.userId} />
                                <InfoTile label={ui.group} value={student.groupKey} />
                                <InfoTile label={ui.role} value={roleLabel} />
                                <InfoTile label={ui.specialty} value={student.profileSummary.specialty || '—'} />
                                <InfoTile label={ui.gpa} value={typeof student.attestationSummary.currentGPA === 'number' ? student.attestationSummary.currentGPA.toFixed(2) : '—'} />
                                <InfoTile label={ui.lastActivity} value={student.analytics.online ? ui.onlineNowLabel : formatDateTime(student.analytics.lastSeenAt, locale)} />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => onToggleRole('starosta', !hasStarosta)}
                                    disabled={roleAction === 'starosta'}
                                    className="px-3 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
                                    style={{ background: hasStarosta ? 'rgba(var(--status-danger-rgb), 0.14)' : 'rgba(var(--primary-rgb), 0.18)', color: hasStarosta ? 'var(--danger)' : 'var(--primary)' }}
                                >
                                    {hasStarosta ? ui.revokeStarosta : ui.assignStarosta}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onToggleRole('helper', !hasHelper)}
                                    disabled={roleAction === 'helper'}
                                    className="px-3 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
                                    style={{ background: hasHelper ? 'rgba(var(--status-danger-rgb), 0.14)' : 'rgba(var(--good-rgb), 0.16)', color: hasHelper ? 'var(--danger)' : 'var(--good)' }}
                                >
                                    {hasHelper ? ui.revokeHelper : ui.assignHelper}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
