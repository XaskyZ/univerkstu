'use client';

import { useState } from 'react';
import { currentSemester, type FakeSubject } from '../data';
import {
    LetterPill, StatusBadge, MetricRow, ScoreCell,
    scoreTone, toneVars, formatDateTime, formatDate,
} from '../shared';

function Card({ s }: { s: FakeSubject }) {
    const tone = toneVars(scoreTone(s.total ?? s.rating));
    const proj = s.projection;
    return (
        <div className="card" style={{
            background: 'var(--card)',
            border: `1px solid ${tone.border}`,
            borderRadius: 18,
            padding: 18,
            display: 'flex', flexDirection: 'column', gap: 12,
            minHeight: 540,
            boxShadow: '0 6px 20px color-mix(in srgb, var(--text) 6%, transparent)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{s.code}</div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{s.name}</h3>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.department}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.teachers.join(', ')}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <LetterPill letter={s.letter} size="lg" />
                    <StatusBadge status={s.status} size="sm" />
                </div>
            </div>

            <div style={{
                display: 'flex', alignItems: 'baseline', gap: 6,
                padding: '12px 0',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                justifyContent: 'center',
            }}>
                <span style={{ fontSize: 56, fontWeight: 800, color: tone.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {s.total ?? s.rating ?? '—'}
                </span>
                <span style={{ fontSize: 16, color: 'var(--muted)' }}>/100</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(64px, 1fr))', gap: 6 }}>
                <ScoreCell label="РК1" value={s.rk1} />
                <ScoreCell label="РК2" value={s.rk2} />
                {s.coursework !== null ? <ScoreCell label="Курс." value={s.coursework} /> : null}
                {s.practice !== null ? <ScoreCell label="Практ." value={s.practice} /> : null}
                {s.kind === 'regular' ? <ScoreCell label="Экз." value={s.exam} /> : null}
                <ScoreCell label="Рейт." value={s.rating} />
            </div>

            <div style={{ background: 'var(--surface-overlay-1)', borderRadius: 10, padding: 10 }}>
                <MetricRow label="Кредиты / часы" value={`${s.credits} / ${s.hours}`} />
                <MetricRow label="Стадия" value={s.stageLabel} />
                {s.admissionAverage !== null ? (
                    <MetricRow
                        label="Средняя по РК (≥ 50)"
                        value={s.admissionAverage.toFixed(1)}
                        tone={s.admissionAverage >= 50 ? 'success' : 'danger'}
                    />
                ) : null}
                {s.examDate ? <MetricRow label="Экзамен" value={formatDateTime(s.examDate)} /> : null}
                {s.courseworkDeadline ? <MetricRow label="Срок курсовой" value={formatDate(s.courseworkDeadline)} /> : null}
            </div>

            {s.kind === 'regular' && s.total === null ? (
                <div style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 10,
                }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                        Помощник по оценке
                    </div>
                    {proj.map((p) => {
                        const t = p.status === 'ok' ? 'success'
                            : p.status === 'achievable' ? 'info'
                                : p.status === 'risk' ? 'warning' : 'danger';
                        const v = toneVars(t);
                        return (
                            <div key={p.target} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '5px 0', borderBottom: '1px dashed var(--border)',
                                fontSize: 12,
                            }}>
                                <span style={{ color: 'var(--muted)' }}>Цель ≥ {p.target}</span>
                                <span style={{ color: v.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                    {p.neededExam === null ? '—' : p.neededExam > 100 ? 'недостижимо' : `экз. ≥ ${p.neededExam}`}
                                </span>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {s.note ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>{s.note}</div>
            ) : null}
        </div>
    );
}

export default function SwipeCards() {
    const subjects = currentSemester.subjects;
    const [idx, setIdx] = useState(0);
    const s = subjects[idx];

    return (
        <div style={{ maxWidth: 460, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700 }}>Карточки</h2>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {idx + 1} / {subjects.length}
                </span>
            </div>

            <div style={{ display: 'flex', gap: 3, marginBottom: 10 }}>
                {subjects.map((_, i) => (
                    <button
                        key={i}
                        onClick={() => setIdx(i)}
                        aria-label={`Карточка ${i + 1}`}
                        style={{
                            flex: 1, height: 3, border: 'none', padding: 0,
                            background: i === idx ? 'var(--primary)' : 'var(--border)',
                            cursor: 'pointer', borderRadius: 2,
                        }}
                    />
                ))}
            </div>

            <Card s={s} />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
                <button
                    className="btn"
                    onClick={() => setIdx((i) => Math.max(0, i - 1))}
                    disabled={idx === 0}
                    style={{
                        flex: 1, padding: '10px 14px',
                        background: 'var(--card)', color: 'var(--text)',
                        border: '1px solid var(--border)', borderRadius: 10,
                        cursor: idx === 0 ? 'not-allowed' : 'pointer',
                        opacity: idx === 0 ? 0.5 : 1, fontWeight: 600,
                    }}
                >← Назад</button>
                <button
                    className="btn"
                    onClick={() => setIdx((i) => Math.min(subjects.length - 1, i + 1))}
                    disabled={idx === subjects.length - 1}
                    style={{
                        flex: 1, padding: '10px 14px',
                        background: 'var(--primary)', color: 'var(--bg)',
                        border: 'none', borderRadius: 10,
                        cursor: idx === subjects.length - 1 ? 'not-allowed' : 'pointer',
                        opacity: idx === subjects.length - 1 ? 0.5 : 1, fontWeight: 700,
                    }}
                >Дальше →</button>
            </div>
        </div>
    );
}
