'use client';

// Демо-прототипы для оценки направления, не для прода.

import { useState } from 'react';
import CompactList from './variants/01-compact-list';
import BigNumberCardGrid from './variants/02-big-number-grid';
import SpreadsheetTable from './variants/03-spreadsheet-table';
import BentoMosaic from './variants/04-bento-mosaic';
import VerticalTimeline from './variants/05-vertical-timeline';
import StackedProgressBars from './variants/06-stacked-progress-bars';
import KanbanByStatus from './variants/07-kanban-by-status';
import DashboardHero from './variants/08-dashboard-hero';
import SwipeCards from './variants/09-swipe-cards';
import TerminalCLI from './variants/10-terminal-cli';

type Variant = { n: number; name: string; render: () => React.ReactElement };

const variants: Variant[] = [
    { n: 1, name: 'Compact List', render: () => <CompactList /> },
    { n: 2, name: 'Big Number Grid', render: () => <BigNumberCardGrid /> },
    { n: 3, name: 'Spreadsheet', render: () => <SpreadsheetTable /> },
    { n: 4, name: 'Bento Mosaic', render: () => <BentoMosaic /> },
    { n: 5, name: 'Timeline', render: () => <VerticalTimeline /> },
    { n: 6, name: 'Progress Bars', render: () => <StackedProgressBars /> },
    { n: 7, name: 'Kanban', render: () => <KanbanByStatus /> },
    { n: 8, name: 'Dashboard Hero', render: () => <DashboardHero /> },
    { n: 9, name: 'Swipe Cards', render: () => <SwipeCards /> },
    { n: 10, name: 'Terminal CLI', render: () => <TerminalCLI /> },
];

export default function GradesDemoPage() {
    const [active, setActive] = useState<number>(1);
    const current = variants.find((v) => v.n === active) ?? variants[0];

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
            <div
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 30,
                    background: 'var(--header-bg, var(--card))',
                    backdropFilter: 'blur(var(--header-blur, 12px))',
                    WebkitBackdropFilter: 'blur(var(--header-blur, 12px))',
                    borderBottom: '1px solid var(--border)',
                    padding: '10px 12px',
                }}
            >
                <div style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginBottom: 8,
                    textAlign: 'center',
                }}>
                    Демо-прототипы для оценки направления, не для прода.
                </div>
                <div
                    role="tablist"
                    aria-label="Варианты страницы оценок"
                    style={{
                        display: 'flex',
                        gap: 6,
                        overflowX: 'auto',
                        scrollbarWidth: 'thin',
                        paddingBottom: 4,
                    }}
                >
                    {variants.map((v) => {
                        const isActive = v.n === active;
                        return (
                            <button
                                key={v.n}
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActive(v.n)}
                                style={{
                                    flex: '0 0 auto',
                                    minWidth: 78,
                                    padding: '6px 8px',
                                    borderRadius: 10,
                                    border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                                    background: isActive ? 'var(--primary)' : 'transparent',
                                    color: isActive ? 'var(--bg)' : 'var(--text)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: 2,
                                    lineHeight: 1.15,
                                    transition: 'all 0.15s',
                                }}
                            >
                                <span style={{ fontWeight: 800, fontSize: 14 }}>{v.n}</span>
                                <span style={{
                                    fontSize: 10,
                                    opacity: 0.85,
                                    whiteSpace: 'nowrap',
                                }}>
                                    {v.name}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <main style={{ padding: '16px 0 64px' }}>
                {current.render()}
            </main>
        </div>
    );
}
