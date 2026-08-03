'use client';

import { useMemo } from 'react';
import { semesters, type FakeSubject } from '../data';
import { LetterPill, StatusBadge, toneVars, scoreTone } from '../shared';

type Event = {
    iso: string;
    label: string;
    kind: 'rk1' | 'rk2' | 'exam' | 'coursework' | 'practice' | 'final';
    subject: FakeSubject;
    value: number | null;
    completed: boolean;
};

function collectEvents(): Event[] {
    const out: Event[] = [];
    for (const sem of semesters) {
        for (const s of sem.subjects) {
            if (s.rk1Date) out.push({ iso: s.rk1Date, label: 'РК1', kind: 'rk1', subject: s, value: s.rk1, completed: s.rk1 !== null });
            if (s.rk2Date) out.push({ iso: s.rk2Date, label: 'РК2', kind: 'rk2', subject: s, value: s.rk2, completed: s.rk2 !== null });
            if (s.courseworkDeadline) out.push({ iso: s.courseworkDeadline, label: 'Сдача курсовой', kind: 'coursework', subject: s, value: s.coursework, completed: s.coursework !== null });
            if (s.examDate) out.push({ iso: s.examDate, label: 'Экзамен', kind: 'exam', subject: s, value: s.exam, completed: s.exam !== null });
            if (sem.isClosed && s.total !== null) {
                // Закрытие предмета прошлого семестра — собирательное событие
                out.push({ iso: `${sem.year + 1}-01-10T12:00:00`, label: 'Итог зафиксирован', kind: 'final', subject: s, value: s.total, completed: true });
            }
        }
    }
    return out.sort((a, b) => a.iso.localeCompare(b.iso));
}

function dateParts(iso: string) {
    const d = new Date(iso);
    return {
        day: d.toLocaleDateString('ru-RU', { day: '2-digit' }),
        month: d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''),
        time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    };
}

// Прототип использует фиксированную «сегодняшнюю» дату, чтобы не зависеть от
// реального времени и не нарушать чистоту рендера.
const TODAY_ISO = '2026-05-19T12:00:00';

export default function VerticalTimeline() {
    const events = useMemo(() => collectEvents(), []);
    const now = useMemo(() => new Date(TODAY_ISO).getTime(), []);

    return (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 16 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Хронология учёбы</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Прошлый и текущий семестр — события собраны во времени
                </div>
            </div>
            <div style={{ position: 'relative', paddingLeft: 56 }}>
                <div aria-hidden style={{
                    position: 'absolute', top: 4, bottom: 4, left: 40,
                    width: 2, background: 'var(--border)',
                }} />
                {events.map((ev, i) => {
                    const isPast = new Date(ev.iso).getTime() < now;
                    const tone = ev.subject.status === 'blocked' || ev.subject.status === 'at-risk'
                        ? 'danger'
                        : ev.completed
                            ? scoreTone(ev.value)
                            : isPast ? 'warning' : 'info';
                    const t = toneVars(tone);
                    const dp = dateParts(ev.iso);
                    return (
                        <div key={i} style={{
                            display: 'flex',
                            gap: 12,
                            paddingBottom: 14,
                            position: 'relative',
                            opacity: isPast && !ev.completed ? 0.55 : 1,
                        }}>
                            <div style={{
                                position: 'absolute', left: -56, top: 2,
                                width: 36, textAlign: 'right',
                                fontSize: 11, color: 'var(--muted)',
                                lineHeight: 1.15,
                            }}>
                                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{dp.day}</div>
                                <div>{dp.month}</div>
                                {ev.kind === 'exam' ? <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>{dp.time}</div> : null}
                            </div>
                            <div aria-hidden style={{
                                position: 'absolute', left: -19, top: 4,
                                width: 12, height: 12, borderRadius: 999,
                                background: t.color,
                                border: '2px solid var(--bg)',
                                boxShadow: `0 0 0 2px ${t.border}`,
                            }} />
                            <div className="card" style={{
                                flex: 1,
                                padding: 10,
                                background: 'var(--card)',
                                border: `1px solid ${t.border}`,
                                borderRadius: 10,
                                borderLeft: `3px solid ${t.color}`,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 10, color: t.color, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            {ev.label} {!isPast ? '· предстоит' : ev.completed ? '· выполнено' : '· пропущено'}
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {ev.subject.name}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ev.subject.code}</span>
                                            <span>·</span>
                                            <span>{ev.subject.credits} кр</span>
                                            <span>·</span>
                                            <span>{ev.subject.teachers[0]}</span>
                                        </div>
                                    </div>
                                    {ev.completed && ev.value !== null ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <LetterPill letter={ev.subject.letter} size="sm" />
                                            <div style={{ fontSize: 18, fontWeight: 800, color: t.color, fontVariantNumeric: 'tabular-nums' }}>{ev.value}</div>
                                        </div>
                                    ) : (
                                        <StatusBadge status={ev.subject.status} size="sm" />
                                    )}
                                </div>
                                {ev.kind === 'exam' && !ev.completed && ev.subject.minExamForPass !== null ? (
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                                        Минимум на экзамене для итога ≥ 50: <strong style={{ color: 'var(--text)' }}>{ev.subject.minExamForPass}</strong>
                                        {ev.subject.minExamFor70 !== null && ev.subject.minExamFor70 <= 100 ? (
                                            <> · для ≥ 70: <strong style={{ color: 'var(--text)' }}>{ev.subject.minExamFor70}</strong></>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
