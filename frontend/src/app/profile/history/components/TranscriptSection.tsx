import type {
    StudentTranscript,
    TranscriptPracticeRecord,
} from '@/app/profile/components/types';
import type { HistoryUi } from '../history-i18n';
import { LetterGradeChip } from './LetterGradeChip';
import { OrdersList } from './OrdersList';
import { SubjectsTable } from './SubjectsTable';
import { YearSummaryTable } from './YearSummaryTable';

interface TranscriptSectionProps {
    transcript: StudentTranscript | null | undefined;
    ui: HistoryUi;
}

/**
 * Student-facing transcript view. Mirrors the data the admin modal renders,
 * but stripped of admin-only meta and laid out as a vertical composition so
 * the page reads top-down on mobile: summary → GPA-by-year → subjects search
 * → practices → orders → grade stats.
 */
export function TranscriptSection({ transcript, ui }: TranscriptSectionProps) {
    if (!transcript) {
        return (
            <section className="card p-6">
                <div className="card-header" style={{ marginBottom: '12px' }}>
                    <h2 className="card-header-title">{ui.transcriptSection}</h2>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: '14px' }}>{ui.transcriptEmpty}</p>
            </section>
        );
    }

    const summary = transcript.summary;
    const stats = transcript.stats;
    const subjects = transcript.subjects ?? [];
    const yearSummaries = transcript.yearSummaries ?? [];
    const practices = transcript.practices ?? [];
    const orders = transcript.orders ?? [];

    const totalSubjects =
        typeof stats.totalSubjects === 'number' ? stats.totalSubjects : subjects.length;

    return (
        <section className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ padding: '16px 16px 8px' }}>
                <h2 className="card-header-title">{ui.transcriptSection}</h2>
            </div>

            <div style={{ padding: '0 16px 16px' }} className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={ui.transcriptStudyProgram} value={summary.educationalProgram} />
                    <Field label={ui.transcriptProgramGroup} value={summary.groupProgram} />
                    <Field label={ui.studyDuration} value={summary.studyDuration} />
                    <Field label={ui.caseFile} value={summary.caseFileNumber} />
                    <Field label={ui.faculty} value={summary.faculty} />
                    <Field label={ui.educationStep} value={summary.educationStep} />
                    <Field label={ui.transcriptTotalSubjects} value={String(totalSubjects)} />
                </div>

                {yearSummaries.length > 0 && (
                    <div>
                        <SectionLabel>{ui.transcriptYearSummaries}</SectionLabel>
                        <YearSummaryTable items={yearSummaries} ui={ui} />
                    </div>
                )}

                {hasStats(stats) && (
                    <div>
                        <SectionLabel>{ui.transcriptStatsTitle}</SectionLabel>
                        <StatGrid stats={stats} ui={ui} />
                    </div>
                )}

                <div>
                    <SectionLabel>{ui.transcriptSubjects}</SectionLabel>
                    {subjects.length === 0 ? (
                        <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                            {ui.transcriptEmpty}
                        </p>
                    ) : (
                        <SubjectsTable subjects={subjects} ui={ui} />
                    )}
                </div>

                <div>
                    <SectionLabel>{ui.transcriptPractices}</SectionLabel>
                    {practices.length === 0 ? (
                        <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                            {ui.transcriptPracticesEmpty}
                        </p>
                    ) : (
                        <PracticesList practices={practices} ui={ui} />
                    )}
                </div>

                <div>
                    <SectionLabel>{ui.transcriptOrders}</SectionLabel>
                    <OrdersList orders={orders} ui={ui} />
                </div>
            </div>
        </section>
    );
}

function hasStats(stats: StudentTranscript['stats']): boolean {
    return (
        typeof stats.excellent === 'number'
        || typeof stats.good === 'number'
        || typeof stats.satisfactory === 'number'
        || typeof stats.unsatisfactory === 'number'
    );
}

function StatGrid({ stats, ui }: { stats: StudentTranscript['stats']; ui: HistoryUi }) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
                label={ui.transcriptStatsExcellent}
                value={stats.excellent}
                tone="success"
            />
            <StatTile label={ui.transcriptStatsGood} value={stats.good} tone="info" />
            <StatTile
                label={ui.transcriptStatsSatisfactory}
                value={stats.satisfactory}
                tone="warning"
            />
            <StatTile
                label={ui.transcriptStatsUnsatisfactory}
                value={stats.unsatisfactory}
                tone="danger"
            />
        </div>
    );
}

function StatTile({
    label,
    value,
    tone,
}: {
    label: string;
    value: number | null;
    tone: 'success' | 'info' | 'warning' | 'danger';
}) {
    const styles = {
        success: {
            background: 'var(--status-success-bg)',
            color: 'var(--status-success-color)',
            border: '1px solid var(--status-success-border)',
        },
        info: {
            background: 'var(--status-info-bg)',
            color: 'var(--status-info-color)',
            border: '1px solid var(--status-info-border)',
        },
        warning: {
            background: 'var(--status-warning-bg)',
            color: 'var(--status-warning-color)',
            border: '1px solid var(--status-warning-border)',
        },
        danger: {
            background: 'var(--status-danger-bg)',
            color: 'var(--status-danger-color)',
            border: '1px solid var(--status-danger-border)',
        },
    }[tone];

    return (
        <div
            className="rounded-xl"
            style={{
                ...styles,
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
            }}
        >
            <span style={{ fontSize: '12px', fontWeight: 600 }}>{label}</span>
            <span
                style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {typeof value === 'number' ? value : '—'}
            </span>
        </div>
    );
}

function PracticesList({
    practices,
    ui,
}: {
    practices: TranscriptPracticeRecord[];
    ui: HistoryUi;
}) {
    return (
        <div
            className="rounded-2xl"
            style={{
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
            }}
        >
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {practices.map((practice, index) => (
                    <div
                        key={`${practice.practiceType}-${index}`}
                        style={{
                            padding: '12px 14px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: '12px',
                        }}
                    >
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                                style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: 'var(--text)',
                                    wordBreak: 'break-word',
                                }}
                            >
                                {practice.practiceType || '—'}
                            </div>
                            <div
                                style={{
                                    marginTop: '6px',
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '12px',
                                    fontSize: '12px',
                                    color: 'var(--muted)',
                                }}
                            >
                                {practice.period ? (
                                    <span>{ui.transcriptPracticePeriod}: {practice.period}</span>
                                ) : null}
                                <span>{ui.transcriptCredits}: {practice.credits || '—'}</span>
                                <span>
                                    {ui.transcriptGpa}:{' '}
                                    {typeof practice.gpa === 'number' ? practice.gpa.toFixed(2) : '—'}
                                </span>
                            </div>
                        </div>
                        <LetterGradeChip letter={practice.letterGrade} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
    return (
        <div
            className="rounded-xl"
            style={{
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
                padding: '10px 12px',
            }}
        >
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                {label}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text)', wordBreak: 'break-word' }}>
                {value && value.trim() ? value : '—'}
            </div>
        </div>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: '8px',
            }}
        >
            {children}
        </div>
    );
}
