'use client';

import { currentSemester } from '../data';
import { LetterPill, StatusBadge, scoreTone, toneVars } from '../shared';

export default function BigNumberCardGrid() {
    const subjects = currentSemester.subjects;
    return (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Оценки</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {currentSemester.label} · GPA {currentSemester.gpa.toFixed(2)} · {currentSemester.creditsTotal} кредитов
                </div>
            </div>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 10,
            }}>
                {subjects.map((s) => {
                    const v = s.total ?? s.rating;
                    const tone = toneVars(scoreTone(v));
                    return (
                        <div
                            key={s.id}
                            className="card"
                            style={{
                                padding: 14,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                background: 'var(--card)',
                                border: `1px solid ${tone.border}`,
                                borderRadius: 14,
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                aria-hidden
                                style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                                    background: tone.color,
                                    opacity: 0.6,
                                }}
                            />
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{
                                    fontSize: 44, fontWeight: 800, lineHeight: 1,
                                    color: tone.color,
                                    fontVariantNumeric: 'tabular-nums',
                                }}>
                                    {v ?? '—'}
                                </div>
                                <LetterPill letter={s.letter} />
                            </div>
                            <div style={{
                                fontSize: 13, fontWeight: 600, color: 'var(--text)',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                minHeight: 36,
                            }}>
                                {s.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.code}</span>
                                <span>·</span>
                                <span>{s.credits} кр</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {s.teachers[0]}
                            </div>
                            <StatusBadge status={s.status} size="sm" />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
