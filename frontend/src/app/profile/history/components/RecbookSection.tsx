import { useMemo } from 'react';
import type { StudentRecbook, RecbookRecord } from '@/app/profile/components/types';
import type { HistoryUi } from '../history-i18n';
import { LetterGradeChip } from './LetterGradeChip';

interface RecbookSectionProps {
    recbook: StudentRecbook | null | undefined;
    ui: HistoryUi;
}

/**
 * Renders the student's recbook (Зачётка) grouped by `termLabel`. Each row
 * inside a group shows the subject, credits, RK/MT/PA scores, final numeric
 * grade, and the teacher / examiner pair when available.
 *
 * Visual style mirrors the existing profile cards — `.card` shell, semantic
 * CSS vars, no theme-sensitive hex.
 */
export function RecbookSection({ recbook, ui }: RecbookSectionProps) {
    const grouped = useMemo(() => groupByTerm(recbook?.records ?? []), [recbook?.records]);

    if (!recbook) {
        return (
            <section className="card p-6">
                <div className="card-header mb-3" style={{ marginBottom: '12px' }}>
                    <h2 className="card-header-title">{ui.recbookSection}</h2>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: '14px' }}>{ui.recbookEmpty}</p>
            </section>
        );
    }

    const summary = recbook.summary;
    const records = recbook.records ?? [];

    return (
        <section className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ padding: '16px 16px 8px' }}>
                <h2 className="card-header-title">{ui.recbookSection}</h2>
            </div>

            <div style={{ padding: '0 16px 16px' }}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={ui.recbookSpecialtyCode} value={summary.specialtyCode} />
                    <Field label={ui.recbookSpecialty} value={summary.specialty} />
                    <Field label={ui.recbookSpecialization} value={summary.specialization} />
                    <Field label={ui.studyDuration} value={summary.studyDuration} />
                    <Field label={ui.caseFile} value={summary.caseFileNumber} />
                    <Field
                        label={ui.course}
                        value={typeof summary.course === 'number' ? String(summary.course) : null}
                    />
                    <Field label={ui.recbookRecords} value={String(records.length)} />
                </div>

                {records.length === 0 ? (
                    <p
                        style={{
                            color: 'var(--muted)',
                            fontSize: '14px',
                            marginTop: '16px',
                        }}
                    >
                        {ui.recbookEmpty}
                    </p>
                ) : (
                    <div className="space-y-3" style={{ marginTop: '20px' }}>
                        {grouped.map((group) => (
                            <RecbookGroup key={group.key} group={group} ui={ui} />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

interface TermGroup {
    key: string;
    label: string;
    records: RecbookRecord[];
}

function groupByTerm(records: RecbookRecord[]): TermGroup[] {
    const map = new Map<string, TermGroup>();
    for (const record of records) {
        const label = record.termLabel?.trim() || '';
        const key = label || '__no_term__';
        const existing = map.get(key);
        if (existing) {
            existing.records.push(record);
        } else {
            map.set(key, { key, label, records: [record] });
        }
    }
    return Array.from(map.values());
}

function RecbookGroup({ group, ui }: { group: TermGroup; ui: HistoryUi }) {
    const heading = group.label || ui.recbookNoTerm;
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
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                }}
            >
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                    {heading}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {group.records.length}
                </span>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {group.records.map((record, index) => (
                    <RecbookRow
                        key={`${record.subject}-${index}`}
                        record={record}
                        ui={ui}
                    />
                ))}
            </div>
        </div>
    );
}

function RecbookRow({ record, ui }: { record: RecbookRecord; ui: HistoryUi }) {
    return (
        <div style={{ padding: '12px 14px' }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    justifyContent: 'space-between',
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
                        {record.subject || '—'}
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
                        <span>{ui.recbookCredits}: {record.credits || '—'}</span>
                        <span>{ui.recbookRk}: {formatNumber(record.rk)}</span>
                        <span>{ui.recbookMt}: {formatNumber(record.mt)}</span>
                        <span>{ui.recbookPa}: {formatNumber(record.pa)}</span>
                        <span>{ui.recbookFinal}: {formatNumber(record.numericGrade)}</span>
                    </div>
                    {(record.teacher || record.examiner || record.examDate) && (
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
                            {record.examDate ? (
                                <span>{ui.recbookExamDate}: {record.examDate}</span>
                            ) : null}
                            {record.teacher ? (
                                <span>{ui.recbookTeacher}: {record.teacher}</span>
                            ) : null}
                            {record.examiner ? (
                                <span>{ui.recbookExaminer}: {record.examiner}</span>
                            ) : null}
                        </div>
                    )}
                </div>
                <LetterGradeChip letter={record.letterGrade} />
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
            <div
                style={{
                    fontSize: '13px',
                    color: 'var(--text)',
                    wordBreak: 'break-word',
                }}
            >
                {value && value.trim() ? value : '—'}
            </div>
        </div>
    );
}

function formatNumber(value: number | null): string {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return String(value);
}
