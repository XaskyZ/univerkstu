'use client';

import { currentSemester, type FakeSubject, type SubjectStatus } from '../data';
import { LetterPill, StatusDot, statusVars, scoreTone, toneVars } from '../shared';

const COLUMNS: { status: SubjectStatus; title: string; subtitle: string }[] = [
    { status: 'blocked', title: 'Недопуск', subtitle: 'нет допуска к экзамену' },
    { status: 'at-risk', title: 'Под угрозой', subtitle: 'нужен высокий балл' },
    { status: 'ok', title: 'В норме', subtitle: 'идёт стабильно' },
    { status: 'passed', title: 'Сданы', subtitle: 'итог зафиксирован' },
];

function Card({ s }: { s: FakeSubject }) {
    const tone = toneVars(scoreTone(s.total ?? s.rating));
    return (
        <div className="card" style={{
            padding: 10,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderTop: `3px solid ${tone.color}`,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>{s.code}</div>
                </div>
                <LetterPill letter={s.letter} size="sm" />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: tone.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {s.total ?? s.rating ?? '—'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>/100</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span>{s.credits} кр</span>
                <span>·</span>
                <span>РК {s.rk1 ?? '—'}/{s.rk2 ?? '—'}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.teachers[0]}
            </div>
            {s.status === 'at-risk' && s.minExamForPass !== null ? (
                <div style={{
                    fontSize: 10, color: 'var(--status-warning-color)',
                    background: 'var(--status-warning-bg)',
                    border: '1px solid var(--status-warning-border)',
                    borderRadius: 6, padding: '2px 6px', marginTop: 2,
                }}>
                    Минимум на экз.: {s.minExamForPass > 100 ? '∞' : s.minExamForPass}
                </div>
            ) : null}
        </div>
    );
}

export default function KanbanByStatus() {
    const subjects = currentSemester.subjects;
    const grouped = COLUMNS.map((c) => ({
        ...c,
        items: subjects.filter((s) => s.status === c.status),
    }));

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Доска по статусам</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {currentSemester.label} · GPA {currentSemester.gpa.toFixed(2)}
                </div>
            </div>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
            }}>
                {grouped.map((col) => {
                    const sv = statusVars(col.status);
                    return (
                        <div key={col.status} style={{
                            background: 'var(--surface-overlay-1)',
                            border: '1px solid var(--border)',
                            borderRadius: 12,
                            padding: 10,
                            display: 'flex', flexDirection: 'column', gap: 8,
                            minHeight: 120,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <StatusDot status={col.status} />
                                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        {col.title}
                                    </span>
                                </div>
                                <span style={{
                                    minWidth: 22, textAlign: 'center',
                                    padding: '1px 6px', fontSize: 11, fontWeight: 700,
                                    background: sv.bg, color: sv.color, border: `1px solid ${sv.border}`,
                                    borderRadius: 999,
                                }}>{col.items.length}</span>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{col.subtitle}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {col.items.length === 0 ? (
                                    <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>пусто</div>
                                ) : col.items.map((s) => <Card key={s.id} s={s} />)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
