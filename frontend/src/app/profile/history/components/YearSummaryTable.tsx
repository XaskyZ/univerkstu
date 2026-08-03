import type { TranscriptYearSummary } from '@/app/profile/components/types';
import type { HistoryUi } from '../history-i18n';

interface YearSummaryTableProps {
    items: TranscriptYearSummary[];
    ui: HistoryUi;
}

/**
 * Compact tabular view of `transcript.yearSummaries`. The transcript may
 * include final-year aggregates as well as individual academic-year rows; we
 * render them in source order, since the parser already provides them in
 * chronological order.
 */
export function YearSummaryTable({ items, ui }: YearSummaryTableProps) {
    if (items.length === 0) return null;

    return (
        <div
            className="rounded-2xl"
            style={{
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                    gap: '10px',
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--card)',
                    fontSize: '12px',
                    color: 'var(--muted)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                }}
            >
                <span>{ui.transcriptYearLabel}</span>
                <span>{ui.transcriptYearCredits}</span>
                <span>{ui.transcriptYearGpa}</span>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {items.map((item, index) => (
                    <div
                        key={`${item.label}-${index}`}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                            gap: '10px',
                            alignItems: 'center',
                            padding: '10px 14px',
                            fontSize: '13px',
                        }}
                    >
                        <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>
                            {item.label || '—'}
                        </span>
                        <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {typeof item.creditsEarned === 'number' ? item.creditsEarned : '—'}
                        </span>
                        <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {typeof item.gpa === 'number' ? item.gpa.toFixed(2) : '—'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
