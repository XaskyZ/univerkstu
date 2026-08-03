'use client';

import type { CuratorStudentSummary } from '@/lib/api';
import { formatDateTime, getRoleTone } from './utils';

export function StudentCard({
    student,
    locale,
    openLabel,
    roleLabels,
    courseLabel,
    lastSeenLabel,
    onlineNowLabel,
    onOpen,
}: {
    student: CuratorStudentSummary;
    locale: string;
    openLabel: string;
    roleLabels: Record<'starosta' | 'helper' | 'member', string>;
    courseLabel: string;
    lastSeenLabel: string;
    onlineNowLabel: string;
    onOpen: () => void;
}) {
    const topRole = student.roles.includes('starosta') ? 'starosta' : student.roles.includes('helper') ? 'helper' : 'member';
    const gpa = typeof student.attestationSummary.currentGPA === 'number' ? student.attestationSummary.currentGPA.toFixed(2) : '—';
    const lastSeen = student.analytics.online ? onlineNowLabel : formatDateTime(student.analytics.lastSeenAt, locale);
    const course = student.profileSummary.course ? String(student.profileSummary.course) : '—';

    return (
        <article
            className="workspace-card p-4 md:p-5 transition-transform duration-200 hover:-translate-y-0.5"
            style={{ contentVisibility: 'auto' }}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-lg font-semibold truncate text-fg">{student.fullName || student.userId}</div>
                    <div className="mt-1 text-xs font-mono text-muted-fg">{student.userId}</div>
                    <div className="mt-3 text-sm text-fg" style={{ opacity: 0.85 }}>
                        {student.profileSummary.specialty || student.profileSummary.faculty || '—'}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-fg">GPA</div>
                    <div className="mt-1 text-2xl font-semibold text-fg">{gpa}</div>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2.5 py-1 rounded-full font-medium" style={getRoleTone(topRole)}>{roleLabels[topRole]}</span>
                <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: 'var(--surface-overlay-2)', color: 'var(--text)' }}>{courseLabel}: {course}</span>
                <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: 'var(--surface-overlay-2)', color: 'var(--text)' }}>{lastSeenLabel}: {lastSeen}</span>
            </div>

            <button type="button" onClick={onOpen} className="chip mt-4 w-full justify-center" data-tone="primary" data-size="lg">
                {openLabel}
            </button>
        </article>
    );
}
