'use client';

import { useState } from 'react';
import { currentSemester, previousSemester, semesters, student, type FakeSubject } from '../data';
import { LetterPill, StatusBadge, scoreTone, toneVars } from '../shared';

function HeroStat({ label, value, sub, big, accent }: {
    label: string;
    value: React.ReactNode;
    sub?: string;
    big?: boolean;
    accent?: boolean;
}) {
    return (
        <div style={{
            padding: big ? 16 : 12,
            background: accent ? 'var(--primary)' : 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            display: 'flex', flexDirection: 'column', gap: 4,
            color: accent ? 'var(--bg)' : 'var(--text)',
        }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>{label}</div>
            <div style={{
                fontSize: big ? 44 : 22, fontWeight: 800, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
            }}>{value}</div>
            {sub ? <div style={{ fontSize: 11, opacity: 0.7 }}>{sub}</div> : null}
        </div>
    );
}

function Row({ s, open, onToggle }: { s: FakeSubject; open: boolean; onToggle: () => void }) {
    const tone = toneVars(scoreTone(s.total ?? s.rating));
    return (
        <div style={{ borderBottom: '1px solid var(--border)' }}>
            <button
                onClick={onToggle}
                style={{
                    width: '100%', background: 'transparent', border: 'none',
                    padding: '10px 12px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    color: 'var(--text)', textAlign: 'left', cursor: 'pointer',
                }}
            >
                <div style={{ width: 4, alignSelf: 'stretch', background: tone.color, borderRadius: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.code}</span>
                        <span>·</span>
                        <span>{s.credits} кр</span>
                        <span>·</span>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.teachers[0]}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>РК {s.rk1 ?? '—'}/{s.rk2 ?? '—'}</span>
                    <LetterPill letter={s.letter} size="sm" />
                    <span style={{
                        fontSize: 18, fontWeight: 800, color: tone.color, fontVariantNumeric: 'tabular-nums',
                        minWidth: 38, textAlign: 'right',
                    }}>{s.total ?? s.rating ?? '—'}</span>
                </div>
            </button>
            {open ? (
                <div style={{ padding: '0 12px 12px 26px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                    <div>Кафедра: <span style={{ color: 'var(--text)' }}>{s.department}</span></div>
                    <div>Стадия: <span style={{ color: 'var(--text)' }}>{s.stageLabel}</span></div>
                    {s.admissionAverage !== null ? (
                        <div>
                            Средняя по РК: <span style={{ color: s.admissionAverage >= 50 ? 'var(--status-success-color)' : 'var(--status-danger-color)' }}>
                                {s.admissionAverage.toFixed(1)}
                            </span>
                        </div>
                    ) : null}
                    {s.kind === 'regular' && s.total === null && s.minExamForPass !== null ? (
                        <div>
                            Минимум на экзамене: ≥50 → <span style={{ color: 'var(--text)' }}>{s.minExamForPass}</span>
                            {s.minExamFor70 !== null ? <>, ≥70 → <span style={{ color: 'var(--text)' }}>{s.minExamFor70}</span></> : null}
                            {s.minExamFor90 !== null ? <>, ≥90 → <span style={{ color: 'var(--text)' }}>{s.minExamFor90}</span></> : null}
                        </div>
                    ) : null}
                    <div style={{ marginTop: 2 }}><StatusBadge status={s.status} size="sm" /></div>
                </div>
            ) : null}
        </div>
    );
}

export default function DashboardHero() {
    const [openId, setOpenId] = useState<string | null>(null);
    const [semIdx, setSemIdx] = useState(0);
    const sem = semesters[semIdx];

    return (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                    {student.fullName.split(' ')[1]}, привет
                </h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {student.group} · {student.program} · {student.course} курс
                </div>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 8, marginBottom: 12,
            }}>
                <HeroStat
                    label="GPA семестра"
                    value={currentSemester.gpa.toFixed(2)}
                    sub={currentSemester.label}
                    big
                    accent
                />
                <HeroStat
                    label="Прошлый семестр"
                    value={previousSemester.gpa.toFixed(2)}
                    sub={previousSemester.label}
                />
                <HeroStat
                    label="Кумулятивный GPA"
                    value={student.cumulativeGpa.toFixed(2)}
                    sub={`перевод. ${student.transferGpa.toFixed(2)}`}
                />
                <HeroStat
                    label="Кредитов"
                    value={`${student.completedCredits}`}
                    sub={`из ${student.totalProgramCredits} программы`}
                />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 4, background: 'var(--surface-overlay-1)', padding: 3, borderRadius: 10 }}>
                    {semesters.map((s, i) => (
                        <button
                            key={`${s.year}-${s.semester}`}
                            onClick={() => setSemIdx(i)}
                            style={{
                                padding: '5px 10px', fontSize: 11, fontWeight: 600,
                                border: 'none', cursor: 'pointer',
                                background: i === semIdx ? 'var(--card)' : 'transparent',
                                color: i === semIdx ? 'var(--text)' : 'var(--muted)',
                                borderRadius: 8,
                            }}
                        >{s.label}</button>
                    ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {sem.subjects.length} предметов · {sem.creditsTotal} кр
                </div>
            </div>

            <div style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 14, overflow: 'hidden',
            }}>
                {sem.subjects.map((s) => (
                    <Row
                        key={s.id}
                        s={s}
                        open={openId === s.id}
                        onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                    />
                ))}
            </div>
        </div>
    );
}
