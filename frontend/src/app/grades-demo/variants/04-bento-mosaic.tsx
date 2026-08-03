'use client';

import { currentSemester, type FakeSubject } from '../data';
import {
    LetterPill, StatusBadge, StatusDot, MetricRow,
    scoreTone, toneVars, CreditChip,
} from '../shared';

function importance(s: FakeSubject): number {
    if (s.status === 'blocked') return 3;
    if (s.status === 'at-risk') return 3;
    if (s.kind === 'coursework' || s.kind === 'practice') return 2;
    if (s.status === 'passed') return 1;
    return 2;
}

function LargeTile({ s }: { s: FakeSubject }) {
    const tone = toneVars(scoreTone(s.total ?? s.rating));
    const proj50 = s.projection.find((p) => p.target === 50);
    return (
        <div className="card" style={{
            gridColumn: 'span 2', gridRow: 'span 2',
            padding: 16,
            background: 'var(--card)',
            border: `1px solid ${tone.border}`,
            borderRadius: 16,
            display: 'flex', flexDirection: 'column', gap: 10,
            minHeight: 220,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--muted)' }}>{s.code}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.teachers.join(', ')}</div>
                </div>
                <LetterPill letter={s.letter} size="lg" />
            </div>
            <StatusBadge status={s.status} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                <Box label="РК1" value={s.rk1} />
                <Box label="РК2" value={s.rk2} />
                {s.kind === 'regular' ? <Box label="Экз." value={s.exam} /> : <Box label="Курс." value={s.coursework ?? s.practice} />}
                <Box label="Итог" value={s.total ?? s.rating} accent />
            </div>
            <div style={{ background: 'var(--surface-overlay-1)', borderRadius: 10, padding: 10, fontSize: 12 }}>
                <MetricRow label="Кредиты" value={`${s.credits} (${s.hours}ч)`} />
                {s.admissionAverage !== null ? (
                    <MetricRow
                        label="Допуск ≥ 50"
                        value={s.admissionAverage.toFixed(1)}
                        tone={s.admissionAverage >= 50 ? 'success' : 'danger'}
                    />
                ) : null}
                {s.kind === 'regular' && s.total === null && proj50 ? (
                    <MetricRow
                        label="Мин. на экзамене"
                        value={proj50.neededExam !== null ? `${proj50.neededExam}` : '—'}
                        tone={proj50.neededExam !== null && proj50.neededExam > 100 ? 'danger' : 'warning'}
                    />
                ) : null}
                {s.note ? (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{s.note}</div>
                ) : null}
            </div>
        </div>
    );
}

function MediumTile({ s }: { s: FakeSubject }) {
    return (
        <div className="card" style={{
            gridColumn: 'span 2',
            padding: 12,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            display: 'flex', flexDirection: 'column', gap: 6,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{s.code}</div>
                </div>
                <LetterPill letter={s.letter} />
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--muted)', alignItems: 'center', flexWrap: 'wrap' }}>
                <CreditChip credits={s.credits} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{s.teachers[0]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <StatusDot status={s.status} />
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>РК {s.rk1 ?? '—'}/{s.rk2 ?? '—'}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: toneVars(scoreTone(s.total ?? s.rating)).color, fontVariantNumeric: 'tabular-nums' }}>
                    {s.total ?? s.rating ?? '—'}
                </div>
            </div>
        </div>
    );
}

function SmallTile({ s }: { s: FakeSubject }) {
    const tone = toneVars(scoreTone(s.total ?? s.rating));
    return (
        <div className="card" style={{
            padding: 10,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            display: 'flex', flexDirection: 'column', gap: 4,
        }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <LetterPill letter={s.letter} size="sm" />
                <div style={{ fontSize: 16, fontWeight: 800, color: tone.color, fontVariantNumeric: 'tabular-nums' }}>
                    {s.total ?? s.rating ?? '—'}
                </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{s.credits} кр</div>
        </div>
    );
}

function Box({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
    const tone = toneVars(scoreTone(value));
    return (
        <div style={{
            padding: 6,
            background: accent ? tone.bg : 'var(--surface-overlay-1)',
            border: `1px solid ${accent ? tone.border : 'var(--border)'}`,
            borderRadius: 8,
            textAlign: 'center',
        }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: accent ? tone.color : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {value ?? '—'}
            </div>
        </div>
    );
}

export default function BentoMosaic() {
    const subjects = [...currentSemester.subjects].sort((a, b) => importance(b) - importance(a));
    return (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Мозаика</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {currentSemester.label} · крупные плитки — рискованные/важные предметы
                </div>
            </div>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridAutoFlow: 'dense',
                gap: 10,
            }}>
                {subjects.map((s, i) => {
                    const w = importance(s);
                    if (w === 3 && i < 2) return <LargeTile key={s.id} s={s} />;
                    if (w >= 2) return <MediumTile key={s.id} s={s} />;
                    return <SmallTile key={s.id} s={s} />;
                })}
            </div>
        </div>
    );
}
