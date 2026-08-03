'use client';

import { useState } from 'react';
import { semesters } from '../data';
import { LetterPill, StatusDot, scoreTone, toneVars } from '../shared';

function Cell({ value, dim = false }: { value: number | null; dim?: boolean }) {
    const tone = toneVars(scoreTone(value));
    return (
        <td style={{
            padding: '6px 8px',
            textAlign: 'center',
            color: value === null ? 'var(--muted)' : dim ? 'var(--text)' : tone.color,
            fontWeight: value === null ? 400 : 700,
            fontVariantNumeric: 'tabular-nums',
            borderBottom: '1px solid var(--border)',
            background: value === null ? 'transparent' : dim ? 'transparent' : tone.bg,
        }}>
            {value ?? '—'}
        </td>
    );
}

export default function SpreadsheetTable() {
    const [idx, setIdx] = useState(0);
    const sem = semesters[idx];
    const subjects = sem.subjects;

    return (
        <div style={{ maxWidth: 980, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700 }}>Журнал успеваемости</h2>
                <div style={{ display: 'flex', gap: 4, background: 'var(--surface-overlay-1)', padding: 3, borderRadius: 10 }}>
                    {semesters.map((s, i) => (
                        <button
                            key={`${s.year}-${s.semester}`}
                            onClick={() => setIdx(i)}
                            style={{
                                padding: '5px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                border: 'none',
                                cursor: 'pointer',
                                background: i === idx ? 'var(--card)' : 'transparent',
                                color: i === idx ? 'var(--text)' : 'var(--muted)',
                                borderRadius: 8,
                                boxShadow: i === idx ? '0 1px 3px color-mix(in srgb, var(--text) 8%, transparent)' : 'none',
                            }}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                GPA семестра: <strong style={{ color: 'var(--text)' }}>{sem.gpa.toFixed(2)}</strong> ·
                {' '}{subjects.length} предметов · {sem.creditsTotal} кредитов
                {sem.isClosed ? <span style={{ marginLeft: 8, color: 'var(--status-success-color)' }}>· период закрыт</span> : null}
            </div>

            <div style={{
                overflowX: 'auto',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
                    <thead>
                        <tr style={{ background: 'var(--surface-overlay-1)', color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em' }}>
                            <th style={{ padding: '8px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Предмет</th>
                            <th style={{ padding: '8px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Код</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Кр</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>РК1</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>РК2</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Курс.</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Практ.</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Экз.</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Итог</th>
                            <th style={{ padding: '8px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Буква</th>
                        </tr>
                    </thead>
                    <tbody>
                        {subjects.map((s) => (
                            <tr key={s.id} style={{ color: 'var(--text)' }}>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <StatusDot status={s.status} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{s.name}</div>
                                            <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{s.teachers[0]}</div>
                                        </div>
                                    </div>
                                </td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontFamily: 'ui-monospace, monospace', color: 'var(--muted)', fontSize: 11 }}>{s.code}</td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'center', color: 'var(--muted)' }}>{s.credits}</td>
                                <Cell value={s.rk1} dim />
                                <Cell value={s.rk2} dim />
                                <Cell value={s.coursework} dim />
                                <Cell value={s.practice} dim />
                                <Cell value={s.exam} dim />
                                <Cell value={s.total} />
                                <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                                    <LetterPill letter={s.letter} size="sm" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ color: 'var(--muted)', fontSize: 11 }}>
                            <td colSpan={2} style={{ padding: '8px 8px', fontWeight: 700, color: 'var(--text)' }}>Итого</td>
                            <td style={{ padding: '8px 8px', textAlign: 'center', color: 'var(--text)' }}>{sem.creditsTotal}</td>
                            <td colSpan={6} style={{ padding: '8px 8px', textAlign: 'right' }}>GPA семестра</td>
                            <td style={{ padding: '8px 8px', textAlign: 'center', color: 'var(--text)', fontWeight: 800 }}>{sem.gpa.toFixed(2)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
