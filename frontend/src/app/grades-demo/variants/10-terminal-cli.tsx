'use client';

import { useState } from 'react';
import { semesters, student, type FakeSubject } from '../data';

function tag(s: FakeSubject): { text: string; color: string } {
    switch (s.status) {
        case 'passed': return { text: '[ OK ]', color: 'var(--status-success-color)' };
        case 'ok': return { text: '[GOOD]', color: 'var(--status-info-color)' };
        case 'at-risk': return { text: '[RISK]', color: 'var(--status-warning-color)' };
        case 'blocked': return { text: '[BLOC]', color: 'var(--status-danger-color)' };
        case 'pending': return { text: '[....]', color: 'var(--muted)' };
    }
}

function letterColor(letter: string): string {
    if (['A', 'A-', 'B+'].includes(letter)) return 'var(--status-success-color)';
    if (['B', 'B-', 'C+'].includes(letter)) return 'var(--status-info-color)';
    if (['C', 'C-', 'D+', 'D'].includes(letter)) return 'var(--status-warning-color)';
    if (letter === '—') return 'var(--muted)';
    return 'var(--status-danger-color)';
}

function pad(s: string, n: number): string {
    if (s.length >= n) return s.slice(0, n - 1) + '…';
    return s + ' '.repeat(n - s.length);
}
function rpad(v: string | number | null, n: number): string {
    const s = v === null || v === undefined ? '--' : String(v);
    return ' '.repeat(Math.max(0, n - s.length)) + s;
}

export default function TerminalCLI() {
    const [semIdx, setSemIdx] = useState(0);
    const sem = semesters[semIdx];
    const subjects = sem.subjects;
    const passed = subjects.filter((s) => s.status === 'passed').length;
    const ok = subjects.filter((s) => s.status === 'ok').length;
    const risk = subjects.filter((s) => s.status === 'at-risk').length;
    const blocked = subjects.filter((s) => s.status === 'blocked').length;

    return (
        <div style={{
            maxWidth: 900, margin: '0 auto', padding: 16,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}>
            <div style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 16, color: 'var(--text)',
                fontSize: 12.5, lineHeight: 1.55, overflowX: 'auto',
            }}>
                <div style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--primary)' }}>{student.login}@kstu</span>
                    :<span style={{ color: 'var(--primary)' }}>~/grades</span>
                    $ <span style={{ color: 'var(--text)' }}>grades --semester={semIdx === 0 ? 'current' : 'prev'} --full</span>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 8, marginBottom: 8 }}>
                    {semesters.map((s, i) => (
                        <button
                            key={`${s.year}-${s.semester}`}
                            onClick={() => setSemIdx(i)}
                            style={{
                                padding: '2px 8px', fontSize: 11,
                                fontFamily: 'inherit', cursor: 'pointer',
                                background: i === semIdx ? 'var(--primary)' : 'transparent',
                                color: i === semIdx ? 'var(--bg)' : 'var(--muted)',
                                border: `1px solid ${i === semIdx ? 'var(--primary)' : 'var(--border)'}`,
                                borderRadius: 4,
                            }}
                        >--semester={i === 0 ? 'current' : 'prev'}</button>
                    ))}
                </div>
                <div style={{ color: 'var(--muted)' }}>
                    {`> period=${sem.label} parsed=${new Date(sem.parsedAt).toLocaleDateString('ru-RU')} closed=${sem.isClosed}`}
                </div>
                <div style={{ color: 'var(--muted)' }}>
                    {`> subjects=${subjects.length} credits=${sem.creditsTotal} gpa=${sem.gpa.toFixed(2)} cum_gpa=${student.cumulativeGpa.toFixed(2)}`}
                </div>
                <div style={{ marginTop: 12, whiteSpace: 'pre', color: 'var(--muted)' }}>
                    {`STATUS  ${pad('CODE', 9)} ${pad('SUBJECT', 26)} CR  ${rpad('RK1', 3)} ${rpad('RK2', 3)}  ${rpad('CW', 3)} ${rpad('EX', 3)}  ${rpad('FIN', 3)} LTR`}
                </div>
                <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0 6px' }} />
                {subjects.map((s) => {
                    const t = tag(s);
                    return (
                        <div key={s.id} style={{ whiteSpace: 'pre' }}>
                            <span style={{ color: t.color, fontWeight: 700 }}>{t.text}</span>
                            {'  '}
                            <span style={{ color: 'var(--muted)' }}>{pad(s.code, 9)}</span>
                            {' '}
                            <span style={{ color: 'var(--text)' }}>{pad(s.name, 26)}</span>
                            {' '}
                            <span style={{ color: 'var(--muted)' }}>{rpad(s.credits, 2)}</span>
                            {'  '}
                            <span style={{ color: 'var(--muted)' }}>{rpad(s.rk1, 3)} {rpad(s.rk2, 3)}</span>
                            {'  '}
                            <span style={{ color: 'var(--muted)' }}>{rpad(s.coursework ?? s.practice, 3)} {rpad(s.exam, 3)}</span>
                            {'  '}
                            <span style={{
                                color: s.total !== null ? (s.total >= 50 ? 'var(--status-success-color)' : 'var(--status-danger-color)') : 'var(--muted)',
                                fontWeight: 700,
                            }}>{rpad(s.total, 3)}</span>
                            {' '}
                            <span style={{ color: letterColor(s.letter), fontWeight: 700 }}>{rpad(s.letter, 3)}</span>
                        </div>
                    );
                })}
                <div style={{ borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
                <div style={{ color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                    {`> summary: `}
                    <span style={{ color: 'var(--status-success-color)' }}>{passed} passed</span>
                    {', '}
                    <span style={{ color: 'var(--status-info-color)' }}>{ok} ok</span>
                    {', '}
                    <span style={{ color: 'var(--status-warning-color)' }}>{risk} at-risk</span>
                    {', '}
                    <span style={{ color: 'var(--status-danger-color)' }}>{blocked} blocked</span>
                </div>
                <div style={{ color: 'var(--muted)' }}>
                    {`> gpa.sem=${sem.gpa.toFixed(2)} gpa.cum=${student.cumulativeGpa.toFixed(2)} gpa.transfer=${student.transferGpa.toFixed(2)} credits=${student.completedCredits}/${student.totalProgramCredits}`}
                </div>
                <div style={{ marginTop: 6 }}>
                    <span style={{ color: 'var(--primary)' }}>{student.login}@kstu</span>
                    :<span style={{ color: 'var(--primary)' }}>~/grades</span>
                    $ <span style={{
                        display: 'inline-block', width: 8, height: 14,
                        background: 'var(--text)', verticalAlign: 'middle', marginLeft: 2,
                        animation: 'blink 1s steps(2) infinite',
                    }} />
                </div>
            </div>
            <style jsx>{`
                @keyframes blink {
                    0%, 50% { opacity: 1; }
                    50.01%, 100% { opacity: 0; }
                }
            `}</style>
        </div>
    );
}
