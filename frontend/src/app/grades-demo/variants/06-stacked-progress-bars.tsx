'use client';

import { currentSemester, type FakeSubject } from '../data';
import { LetterPill, StatusBadge, scoreTone, toneVars } from '../shared';

function bandFor(value: number | null): { next: number; label: string } | null {
    if (value === null) return { next: 50, label: 'до D (50)' };
    if (value < 50) return { next: 50, label: 'до D (50)' };
    if (value < 60) return { next: 60, label: 'до C- (60)' };
    if (value < 70) return { next: 70, label: 'до C+ (70)' };
    if (value < 80) return { next: 80, label: 'до B (80)' };
    if (value < 90) return { next: 90, label: 'до A- (90)' };
    return null;
}

function Bar({ s }: { s: FakeSubject }) {
    const current = s.total ?? s.rating ?? 0;
    const tone = toneVars(scoreTone(s.total ?? s.rating));
    const band = bandFor(s.total ?? s.rating);
    const need = band ? band.next - current : 0;
    const minExam = s.minExamForPass;
    return (
        <div className="card" style={{
            padding: 12,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.name}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <LetterPill letter={s.letter} size="sm" />
                    <span style={{ fontSize: 16, fontWeight: 800, color: tone.color, fontVariantNumeric: 'tabular-nums' }}>
                        {s.total ?? s.rating ?? '—'}
                    </span>
                </div>
            </div>

            <div style={{
                position: 'relative',
                height: 14,
                background: 'var(--surface-overlay-1)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                overflow: 'hidden',
            }}>
                {/* threshold marker @ 50 */}
                <div aria-hidden style={{
                    position: 'absolute', top: -4, bottom: -4, left: '50%',
                    width: 2, background: 'var(--status-danger-border)',
                    transform: 'translateX(-1px)',
                }} title="порог допуска 50" />
                {/* filled */}
                <div style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, current))}%`,
                    background: tone.color,
                    transition: 'width 0.3s',
                }} />
                {/* current value pin */}
                <div aria-hidden style={{
                    position: 'absolute', top: -3, bottom: -3,
                    left: `${Math.min(100, Math.max(0, current))}%`,
                    width: 2, background: 'var(--text)',
                    transform: 'translateX(-1px)',
                }} />
            </div>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 10,
                color: 'var(--muted)',
                marginTop: 4,
                fontVariantNumeric: 'tabular-nums',
            }}>
                <span>0</span>
                <span style={{ color: 'var(--status-danger-color)' }}>50</span>
                <span>100</span>
            </div>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px dashed var(--border)',
                fontSize: 11,
                color: 'var(--muted)',
                flexWrap: 'wrap',
            }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.code}</span>
                    <span>·</span>
                    <span>{s.credits} кр</span>
                    <span>·</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{s.teachers[0]}</span>
                </div>
                <StatusBadge status={s.status} size="sm" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                <span>РК1 {s.rk1 ?? '—'} · РК2 {s.rk2 ?? '—'} {s.kind === 'regular' ? `· Экз. ${s.exam ?? '—'}` : ''}</span>
                {band && need > 0 ? (
                    <span>Нужно +{need} {band.label}</span>
                ) : minExam !== null && s.total === null ? (
                    <span>Мин. на экзамене: <strong style={{ color: 'var(--text)' }}>{minExam}</strong></span>
                ) : null}
            </div>
        </div>
    );
}

export default function StackedProgressBars() {
    const subjects = currentSemester.subjects;
    return (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Прогресс по предметам</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {currentSemester.label} · вертикальная риска — порог 50 (допуск)
                </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {subjects.map((s) => <Bar key={s.id} s={s} />)}
            </div>
        </div>
    );
}
