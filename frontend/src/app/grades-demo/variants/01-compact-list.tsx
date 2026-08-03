'use client';

import { useState } from 'react';
import { currentSemester, type FakeSubject } from '../data';
import {
    GradePill,
    LetterPill,
    StatusDot,
    MetricRow,
    ScoreCell,
    formatDate,
    formatDateTime,
} from '../shared';

function Drawer({ subject, onClose }: { subject: FakeSubject; onClose: () => void }) {
    const proj50 = subject.projection.find((p) => p.target === 50);
    const proj70 = subject.projection.find((p) => p.target === 70);
    const proj90 = subject.projection.find((p) => p.target === 90);
    return (
        <div style={{ background: 'var(--surface-overlay-1)', borderTop: '1px solid var(--border)', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{subject.code}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{subject.department}</div>
                </div>
                <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 6, marginBottom: 10 }}>
                <ScoreCell label="РК1" value={subject.rk1} />
                <ScoreCell label="РК2" value={subject.rk2} />
                {subject.coursework !== null ? <ScoreCell label="Курс." value={subject.coursework} /> : null}
                {subject.practice !== null ? <ScoreCell label="Практ." value={subject.practice} /> : null}
                {subject.kind === 'regular' ? <ScoreCell label="Экзамен" value={subject.exam} /> : null}
                <ScoreCell label="Рейтинг" value={subject.rating} />
                <ScoreCell label="Итог" value={subject.total} />
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <MetricRow label="Кредиты" value={`${subject.credits} (${subject.hours}ч)`} />
                <MetricRow label="Преподаватель" value={subject.teachers.join(', ')} />
                <MetricRow label="Буква" value={<LetterPill letter={subject.letter} size="sm" />} />
                <MetricRow label="Стадия" value={subject.stageLabel} />
                {subject.admissionAverage !== null ? (
                    <MetricRow
                        label="Средняя по РК (допуск ≥ 50)"
                        value={`${subject.admissionAverage.toFixed(1)}`}
                        tone={subject.admissionAverage >= 50 ? 'success' : 'danger'}
                    />
                ) : null}
                {subject.examDate ? <MetricRow label="Экзамен" value={formatDateTime(subject.examDate)} /> : null}
                {subject.courseworkDeadline ? <MetricRow label="Сдача курсовой" value={formatDate(subject.courseworkDeadline)} /> : null}
            </div>

            {subject.kind === 'regular' && subject.total === null ? (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Помощник по оценке
                    </div>
                    <MetricRow
                        label="Минимум на экзамене (итог ≥ 50)"
                        value={proj50?.neededExam !== null && proj50?.neededExam !== undefined ? `${proj50.neededExam}` : '—'}
                        tone={proj50 && proj50.neededExam !== null && proj50.neededExam > 100 ? 'danger' : 'warning'}
                    />
                    <MetricRow
                        label="Минимум на экзамене (итог ≥ 70)"
                        value={proj70?.neededExam !== null && proj70?.neededExam !== undefined ? `${proj70.neededExam}` : '—'}
                        tone={proj70 && proj70.neededExam !== null && proj70.neededExam > 100 ? 'danger' : 'info'}
                    />
                    <MetricRow
                        label="Минимум на экзамене (итог ≥ 90)"
                        value={proj90?.neededExam !== null && proj90?.neededExam !== undefined ? `${proj90.neededExam}` : '—'}
                        tone={proj90 && proj90.neededExam !== null && proj90.neededExam > 100 ? 'danger' : 'success'}
                    />
                    <MetricRow label="Прогноз итога" value={proj50?.projectedFinal ?? '—'} />
                </div>
            ) : null}

            {subject.note ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic' }}>{subject.note}</div>
            ) : null}
        </div>
    );
}

export default function CompactList() {
    const [openId, setOpenId] = useState<string | null>(null);
    const subjects = currentSemester.subjects;

    return (
        <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
                <h2 style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Мои предметы</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {currentSemester.label} · {subjects.length} предметов · GPA {currentSemester.gpa.toFixed(2)}
                </div>
            </div>
            <ul style={{
                listStyle: 'none', margin: 0, padding: 0,
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 14, overflow: 'hidden',
            }}>
                {subjects.map((s, i) => {
                    const open = openId === s.id;
                    const displayedTotal = s.total ?? s.rating;
                    return (
                        <li key={s.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                            <button
                                onClick={() => setOpenId(open ? null : s.id)}
                                style={{
                                    width: '100%',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '12px 14px',
                                    background: 'transparent', border: 'none', color: 'var(--text)',
                                    textAlign: 'left', cursor: 'pointer',
                                }}
                            >
                                <StatusDot status={s.status} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 14 }}>
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.code}</span>
                                        <span>·</span>
                                        <span>{s.credits} кр</span>
                                        <span>·</span>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.teachers[0]}</span>
                                    </div>
                                </div>
                                <LetterPill letter={s.letter} size="sm" />
                                <GradePill value={displayedTotal} status={s.status} />
                            </button>
                            {open ? <Drawer subject={s} onClose={() => setOpenId(null)} /> : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
