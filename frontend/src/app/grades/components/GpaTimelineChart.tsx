'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import {
    averageOf,
    buildTimelinePoints,
    getGpaTimelineUi,
    type TimelineMode,
    type TimelinePoint,
} from '@/app/grades/utils/gpa-timeline';

interface GpaTimelineChartProps {
    termMap?: Record<string, number>;
    courseMap?: Record<string, number>;
}

const VIEW_W = 480;
const VIEW_H = 200;
const PAD_X = 32;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export function GpaTimelineChart({ termMap, courseMap }: GpaTimelineChartProps) {
    const { language } = useLanguage();
    const ui = getGpaTimelineUi(language);

    const hasTerms = !!termMap && Object.keys(termMap).length > 0;
    const hasCourses = !!courseMap && Object.keys(courseMap).length > 0;
    const initialMode: TimelineMode = hasTerms ? 'term' : 'course';
    const [mode, setMode] = useState<TimelineMode>(initialMode);

    const points = useMemo(() => {
        const source = mode === 'term' ? termMap : courseMap;
        return buildTimelinePoints(source, mode);
    }, [mode, termMap, courseMap]);

    const average = useMemo(() => averageOf(points), [points]);

    if (!hasTerms && !hasCourses) return null;

    const plotW = VIEW_W - PAD_X * 2;
    const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;

    return (
        <section className="card" aria-label={ui.title}>
            <header className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-base font-semibold">{ui.sectionTitle}</h3>
                {hasTerms && hasCourses && (
                    <div className="flex gap-1" role="tablist" aria-label={ui.sectionTitle}>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'term'}
                            onClick={() => setMode('term')}
                            className={`px-2.5 py-1 text-xs rounded-md transition ${
                                mode === 'term'
                                    ? 'bg-[var(--primary)] text-white'
                                    : 'bg-[var(--surface-overlay-1)] text-[var(--muted)]'
                            }`}
                        >
                            {ui.termTab}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'course'}
                            onClick={() => setMode('course')}
                            className={`px-2.5 py-1 text-xs rounded-md transition ${
                                mode === 'course'
                                    ? 'bg-[var(--primary)] text-white'
                                    : 'bg-[var(--surface-overlay-1)] text-[var(--muted)]'
                            }`}
                        >
                            {ui.courseTab}
                        </button>
                    </div>
                )}
            </header>

            {points.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{ui.empty}</p>
            ) : (
                <Chart
                    points={points}
                    average={average}
                    plotW={plotW}
                    plotH={plotH}
                    yAxisLabel={ui.yAxisLabel}
                    legendCurrent={ui.legendCurrent}
                    legendAverage={ui.legendAverage}
                />
            )}
        </section>
    );
}

function Chart({
    points,
    average,
    plotW,
    plotH,
    yAxisLabel,
    legendCurrent,
    legendAverage,
}: {
    points: TimelinePoint[];
    average: number | null;
    plotW: number;
    plotH: number;
    yAxisLabel: string;
    legendCurrent: string;
    legendAverage: string;
}) {
    const xy = (p: TimelinePoint) => ({
        cx: PAD_X + p.x * plotW,
        cy: PAD_TOP + (1 - p.y) * plotH,
    });

    const polyline = points.map(p => {
        const { cx, cy } = xy(p);
        return `${cx},${cy}`;
    }).join(' ');

    const avgY = average !== null ? PAD_TOP + (1 - Math.min(1, average / 4)) * plotH : null;

    return (
        <div>
            <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                width="100%"
                height={VIEW_H}
                role="img"
                aria-label={`${yAxisLabel} timeline chart`}
                style={{ overflow: 'visible' }}
            >
                {/* gridlines at GPA 1, 2, 3, 4 */}
                {[1, 2, 3, 4].map(gpa => {
                    const y = PAD_TOP + (1 - gpa / 4) * plotH;
                    return (
                        <g key={gpa}>
                            <line
                                x1={PAD_X}
                                x2={PAD_X + plotW}
                                y1={y}
                                y2={y}
                                stroke="var(--border)"
                                strokeWidth={1}
                                strokeDasharray="3,3"
                                opacity={0.5}
                            />
                            <text
                                x={PAD_X - 6}
                                y={y + 3}
                                textAnchor="end"
                                fontSize={10}
                                fill="var(--muted)"
                            >
                                {gpa}
                            </text>
                        </g>
                    );
                })}

                {/* average reference line */}
                {avgY !== null && (
                    <line
                        x1={PAD_X}
                        x2={PAD_X + plotW}
                        y1={avgY}
                        y2={avgY}
                        stroke="var(--status-warning-color, var(--muted))"
                        strokeWidth={1.5}
                        strokeDasharray="6,4"
                        opacity={0.7}
                    />
                )}

                {/* polyline through points */}
                {points.length > 1 && (
                    <polyline
                        points={polyline}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                )}

                {/* points */}
                {points.map((p, i) => {
                    const { cx, cy } = xy(p);
                    return (
                        <g key={p.rawKey + i}>
                            <circle
                                cx={cx}
                                cy={cy}
                                r={4.5}
                                fill="var(--primary)"
                                stroke="var(--bg, #fff)"
                                strokeWidth={2}
                            >
                                <title>{`${p.label}: ${p.value.toFixed(2)}`}</title>
                            </circle>
                            <text
                                x={cx}
                                y={VIEW_H - 8}
                                textAnchor="middle"
                                fontSize={10}
                                fill="var(--muted)"
                            >
                                {p.label}
                            </text>
                        </g>
                    );
                })}
            </svg>

            <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5">
                    <span
                        aria-hidden="true"
                        style={{
                            display: 'inline-block',
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: 'var(--primary)',
                        }}
                    />
                    {legendCurrent}: {points[points.length - 1].value.toFixed(2)}
                </span>
                {average !== null && (
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            aria-hidden="true"
                            style={{
                                display: 'inline-block',
                                width: 18,
                                height: 2,
                                background: 'var(--status-warning-color, var(--muted))',
                            }}
                        />
                        {legendAverage}: {average.toFixed(2)}
                    </span>
                )}
            </div>
        </div>
    );
}
