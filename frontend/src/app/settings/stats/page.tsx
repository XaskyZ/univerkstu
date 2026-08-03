'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import {
    computeGradesStats,
    computeScheduleStats,
    letterTone,
    readCachedGradesData,
    readCachedSchedule,
    type GradesStats,
    type LetterDistributionEntry,
    type ScheduleStats,
} from './stats-helpers';
import { GpaTimelineChart } from '@/app/grades/components/GpaTimelineChart';

export default function SettingsStatsPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const copy = messages.settings.stats;

    const [hydrated, setHydrated] = useState(false);
    const [scheduleStats, setScheduleStats] = useState<ScheduleStats | null>(null);
    const [gradesStats, setGradesStats] = useState<GradesStats | null>(null);

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        // Cache reads touch localStorage — defer to client-only effect to avoid
        // hydration mismatches and keep the page SSR-safe.
        const timer = window.setTimeout(() => {
            const cachedSchedule = readCachedSchedule();
            const cachedGrades = readCachedGradesData();
            const seasonLabels = {
                autumn: messages.grades.autumn,
                spring: messages.grades.spring,
            };
            setScheduleStats(cachedSchedule ? computeScheduleStats(cachedSchedule) : null);
            setGradesStats(computeGradesStats(cachedGrades, seasonLabels));
            setHydrated(true);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, messages.grades.autumn, messages.grades.spring]);

    if (loading || !isAuth) return null;

    const noData = hydrated && !scheduleStats && !gradesStats;

    return (
        <PageShell>
            <SubScreenHeader title={copy.screenTitle} subtitle={copy.screenSubtitle} />
            <PageMain className="space-y-4" spacing="lg">
                {!hydrated && <LoadingSkeleton />}

                {noData && (
                    <PageStateCard
                        message={
                            <span style={{ display: 'block', textAlign: 'center' }}>
                                <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                                    {copy.emptyTitle}
                                </span>
                                <span
                                    style={{
                                        display: 'block',
                                        marginTop: 8,
                                        color: 'var(--muted)',
                                        fontSize: 13,
                                    }}
                                >
                                    {copy.emptyBody}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => router.push('/settings')}
                                    className="btn btn-secondary"
                                    style={{
                                        marginTop: 14,
                                        padding: '8px 14px',
                                        borderRadius: 12,
                                        fontSize: 13,
                                        fontWeight: 600,
                                    }}
                                >
                                    {copy.backToSettings}
                                </button>
                            </span>
                        }
                    />
                )}

                {hydrated && scheduleStats && (
                    <LoadSection stats={scheduleStats} copy={copy} />
                )}

                {hydrated && gradesStats && (
                    <PerformanceSection stats={gradesStats} copy={copy} />
                )}

                {hydrated && gradesStats && (gradesStats.termGpaMap || gradesStats.courseGpaMap) && (
                    <GpaTimelineChart
                        termMap={gradesStats.termGpaMap}
                        courseMap={gradesStats.courseGpaMap}
                    />
                )}

                {hydrated && gradesStats && (
                    <TopSubjectsSection stats={gradesStats} copy={copy} />
                )}

                {hydrated && scheduleStats && (
                    <TopTeachersSection stats={scheduleStats} copy={copy} />
                )}

                {hydrated && scheduleStats && (
                    <FavoriteRoomsSection stats={scheduleStats} copy={copy} />
                )}
            </PageMain>
        </PageShell>
    );
}

type StatsCopy = ReturnType<typeof useLanguage>['messages']['settings']['stats'];

function LoadingSkeleton() {
    return (
        <section className="card p-6">
            <div
                style={{
                    height: 14,
                    width: '50%',
                    borderRadius: 8,
                    background: 'var(--surface-overlay-2)',
                    marginBottom: 12,
                }}
            />
            <div
                style={{
                    height: 80,
                    borderRadius: 12,
                    background: 'var(--surface-overlay-2)',
                }}
            />
        </section>
    );
}

function SectionShell({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="card p-5 space-y-4">
            <header>
                <h2
                    style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--text)',
                        margin: 0,
                    }}
                >
                    {title}
                </h2>
                {subtitle && (
                    <p
                        style={{
                            margin: '4px 0 0',
                            fontSize: 12,
                            color: 'var(--muted)',
                        }}
                    >
                        {subtitle}
                    </p>
                )}
            </header>
            {children}
        </section>
    );
}

function MetricTile({ label, value }: { label: string; value: string }) {
    return (
        <div
            style={{
                flex: '1 1 0',
                minWidth: 0,
                padding: '12px 14px',
                borderRadius: 14,
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
            }}
        >
            <div
                style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    fontWeight: 700,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    marginTop: 4,
                    fontSize: 20,
                    fontWeight: 700,
                    color: 'var(--text)',
                }}
            >
                {value}
            </div>
        </div>
    );
}

function LoadSection({ stats, copy }: { stats: ScheduleStats; copy: StatsCopy }) {
    const maxDayCount = useMemo(
        () => stats.perDay.reduce((acc, item) => Math.max(acc, item.count), 0),
        [stats.perDay]
    );

    const avgPerDay = useMemo(() => {
        const daysWithLessons = stats.perDay.filter((d) => d.count > 0);
        if (daysWithLessons.length === 0) return 0;
        const sum = daysWithLessons.reduce((acc, d) => acc + d.count, 0);
        return sum / daysWithLessons.length;
    }, [stats.perDay]);

    return (
        <SectionShell title={copy.sectionLoad} subtitle={copy.sectionLoadHint}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <MetricTile label={copy.totalSubjects} value={String(stats.totalSubjects)} />
                <MetricTile
                    label={copy.totalLessonsPerWeek}
                    value={String(stats.totalLessonsPerWeek)}
                />
                <MetricTile
                    label={copy.avgPerDay}
                    value={avgPerDay > 0 ? avgPerDay.toFixed(1) : '—'}
                />
            </div>

            <div>
                <div
                    style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginBottom: 8,
                    }}
                >
                    {copy.weeklyLoad}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {stats.perDay.map((entry) => {
                        const percent = maxDayCount > 0 ? (entry.count / maxDayCount) * 100 : 0;
                        return (
                            <div
                                key={entry.day}
                                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                            >
                                <div
                                    style={{
                                        width: 96,
                                        flexShrink: 0,
                                        fontSize: 12,
                                        color: 'var(--text)',
                                        fontWeight: 600,
                                        textTransform: 'capitalize',
                                    }}
                                >
                                    {entry.day}
                                </div>
                                <div
                                    style={{
                                        flex: 1,
                                        height: 10,
                                        borderRadius: 999,
                                        background: 'var(--surface-overlay-2)',
                                        overflow: 'hidden',
                                        border: '1px solid var(--border)',
                                    }}
                                >
                                    <div
                                        aria-hidden
                                        style={{
                                            height: '100%',
                                            width: `${percent}%`,
                                            background: 'rgba(var(--primary-rgb), 0.85)',
                                            transition: 'width 240ms ease',
                                        }}
                                    />
                                </div>
                                <div
                                    style={{
                                        width: 28,
                                        textAlign: 'right',
                                        fontSize: 12,
                                        color: 'var(--muted)',
                                        fontWeight: 600,
                                    }}
                                >
                                    {entry.count}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </SectionShell>
    );
}

function PerformanceSection({ stats, copy }: { stats: GradesStats; copy: StatsCopy }) {
    const totalScored = useMemo(
        () => stats.letterDistribution.reduce((acc, entry) => acc + entry.count, 0),
        [stats.letterDistribution]
    );

    const donutGradient = useMemo(() => {
        if (totalScored === 0) return 'var(--surface-overlay-2)';
        const stops: string[] = [];
        let cursor = 0;
        for (const entry of stats.letterDistribution) {
            if (entry.count === 0) continue;
            const next = cursor + (entry.count / totalScored) * 100;
            const tone = letterTone(entry.letter);
            stops.push(`${tone.solid} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`);
            cursor = next;
        }
        if (stops.length === 0) return 'var(--surface-overlay-2)';
        return `conic-gradient(${stops.join(', ')})`;
    }, [stats.letterDistribution, totalScored]);

    return (
        <SectionShell title={copy.sectionPerformance} subtitle={stats.semesterLabel}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <MetricTile
                    label={copy.averageScore}
                    value={stats.averageScore !== null ? stats.averageScore.toFixed(1) : '—'}
                />
                {stats.gpa !== undefined && (
                    <MetricTile label={copy.gpa} value={stats.gpa.toFixed(2)} />
                )}
                {stats.overallGpa !== undefined && (
                    <MetricTile label={copy.overallGpa} value={stats.overallGpa.toFixed(2)} />
                )}
                <MetricTile label={copy.excellentCount} value={String(stats.excellentCount)} />
            </div>

            <div
                style={{
                    display: 'flex',
                    gap: 16,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ position: 'relative', width: 120, height: 120, flexShrink: 0 }}>
                    <div
                        aria-hidden
                        style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '50%',
                            background: donutGradient,
                        }}
                    />
                    <div
                        style={{
                            position: 'absolute',
                            inset: 18,
                            borderRadius: '50%',
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'column',
                        }}
                    >
                        <span
                            style={{
                                fontSize: 18,
                                fontWeight: 700,
                                color: 'var(--text)',
                            }}
                        >
                            {totalScored}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {copy.scoredSubjects}
                        </span>
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {stats.letterDistribution.map((entry) => (
                        <LetterRow
                            key={entry.letter}
                            entry={entry}
                            total={totalScored}
                            label={letterLabel(entry.letter, copy)}
                        />
                    ))}
                </div>
            </div>
        </SectionShell>
    );
}

function letterLabel(letter: LetterDistributionEntry['letter'], copy: StatsCopy): string {
    if (letter === 'A') return copy.letterA;
    if (letter === 'B') return copy.letterB;
    if (letter === 'C') return copy.letterC;
    if (letter === 'D') return copy.letterD;
    return copy.letterF;
}

function LetterRow({
    entry,
    total,
    label,
}: {
    entry: LetterDistributionEntry;
    total: number;
    label: string;
}) {
    const tone = letterTone(entry.letter);
    const percent = total > 0 ? Math.round((entry.count / total) * 100) : 0;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
                aria-hidden
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: 8,
                    background: tone.bg,
                    color: tone.color,
                    border: `1px solid ${tone.border}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                }}
            >
                {entry.letter}
            </span>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{label}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
                {entry.count} · {percent}%
            </span>
        </div>
    );
}

function TopSubjectsSection({ stats, copy }: { stats: GradesStats; copy: StatsCopy }) {
    const hasTop = stats.topSubjects.length > 0;
    const hasWorst = stats.worstSubjects.length > 0;
    if (!hasTop && !hasWorst) return null;

    return (
        <SectionShell title={copy.sectionTop} subtitle={copy.sectionTopHint}>
            {hasTop && (
                <SubjectList
                    title={copy.topSubjects}
                    items={stats.topSubjects}
                    tone="success"
                />
            )}
            {hasWorst && (
                <SubjectList
                    title={copy.worstSubjects}
                    items={stats.worstSubjects}
                    tone="danger"
                />
            )}
        </SectionShell>
    );
}

function SubjectList({
    title,
    items,
    tone,
}: {
    title: string;
    items: Array<{ name: string; score: number }>;
    tone: 'success' | 'danger';
}) {
    const toneVars =
        tone === 'success'
            ? {
                  bg: 'var(--status-success-bg)',
                  color: 'var(--status-success-color)',
                  border: 'var(--status-success-border)',
              }
            : {
                  bg: 'var(--status-danger-bg)',
                  color: 'var(--status-danger-color)',
                  border: 'var(--status-danger-border)',
              };

    return (
        <div>
            <div
                style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: 8,
                }}
            >
                {title}
            </div>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((item, idx) => (
                    <li
                        key={`${item.name}-${idx}`}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 10,
                            background: 'var(--surface-overlay-2)',
                            border: '1px solid var(--border)',
                        }}
                    >
                        <span
                            aria-hidden
                            style={{
                                width: 22,
                                height: 22,
                                borderRadius: 999,
                                background: 'var(--card)',
                                border: '1px solid var(--border)',
                                fontSize: 11,
                                fontWeight: 700,
                                color: 'var(--text)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            {idx + 1}
                        </span>
                        <span
                            style={{
                                flex: 1,
                                fontSize: 13,
                                color: 'var(--text)',
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                            title={item.name}
                        >
                            {item.name}
                        </span>
                        <span
                            style={{
                                background: toneVars.bg,
                                color: toneVars.color,
                                border: `1px solid ${toneVars.border}`,
                                borderRadius: 999,
                                padding: '2px 10px',
                                fontSize: 12,
                                fontWeight: 700,
                                flexShrink: 0,
                            }}
                        >
                            {Number.isInteger(item.score) ? item.score : item.score.toFixed(1)}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function TopTeachersSection({ stats, copy }: { stats: ScheduleStats; copy: StatsCopy }) {
    if (stats.topTeachers.length === 0) return null;
    return (
        <SectionShell title={copy.topTeachers} subtitle={copy.topTeachersHint}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.topTeachers.map((teacher, idx) => (
                    <CountRow
                        key={`${teacher.name}-${idx}`}
                        rank={idx + 1}
                        name={teacher.name}
                        count={teacher.count}
                        unitLabel={copy.lessonsUnit}
                    />
                ))}
            </ol>
        </SectionShell>
    );
}

function FavoriteRoomsSection({ stats, copy }: { stats: ScheduleStats; copy: StatsCopy }) {
    if (stats.topRooms.length === 0) return null;
    return (
        <SectionShell title={copy.favoriteRooms} subtitle={copy.favoriteRoomsHint}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.topRooms.map((room, idx) => (
                    <CountRow
                        key={`${room.room}-${idx}`}
                        rank={idx + 1}
                        name={room.room}
                        count={room.count}
                        unitLabel={copy.lessonsUnit}
                    />
                ))}
            </ol>
        </SectionShell>
    );
}

function CountRow({
    rank,
    name,
    count,
    unitLabel,
}: {
    rank: number;
    name: string;
    count: number;
    unitLabel: string;
}) {
    return (
        <li
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
            }}
        >
            <span
                aria-hidden
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {rank}
            </span>
            <span
                style={{
                    flex: 1,
                    fontSize: 13,
                    color: 'var(--text)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
                title={name}
            >
                {name}
            </span>
            <span
                style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--muted)',
                    flexShrink: 0,
                }}
            >
                {count} {unitLabel}
            </span>
        </li>
    );
}
