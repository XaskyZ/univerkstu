import { useMemo, useState, type ChangeEvent } from 'react';
import type { TranscriptSubjectRecord } from '@/app/profile/components/types';
import type { HistoryUi } from '../history-i18n';
import { LetterGradeChip } from './LetterGradeChip';

interface SubjectsTableProps {
    subjects: TranscriptSubjectRecord[];
    ui: HistoryUi;
}

/**
 * Searchable list of transcript subjects. The transcript can include dozens of
 * rows across an entire degree — search-by-name keeps the section usable on
 * mobile without paginating.
 */
export function SubjectsTable({ subjects, ui }: SubjectsTableProps) {
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return subjects;
        return subjects.filter((subject) =>
            (subject.subject || '').toLowerCase().includes(needle)
            || (subject.code || '').toLowerCase().includes(needle)
            || (subject.termLabel || '').toLowerCase().includes(needle),
        );
    }, [subjects, query]);

    return (
        <div>
            <input
                type="search"
                value={query}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                placeholder={ui.transcriptSubjectsSearchPlaceholder}
                className="input"
                style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    color: 'var(--text)',
                    fontSize: '13px',
                }}
            />

            {filtered.length === 0 ? (
                <p
                    style={{
                        marginTop: '16px',
                        fontSize: '13px',
                        color: 'var(--muted)',
                    }}
                >
                    {ui.transcriptSubjectsNoMatches}
                </p>
            ) : (
                <div
                    className="rounded-2xl"
                    style={{
                        background: 'var(--surface-overlay-2)',
                        border: '1px solid var(--border)',
                        overflow: 'hidden',
                        marginTop: '12px',
                    }}
                >
                    <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                        {filtered.map((subject, index) => (
                            <SubjectRow
                                key={`${subject.code || subject.subject}-${index}`}
                                subject={subject}
                                ui={ui}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function SubjectRow({ subject, ui }: { subject: TranscriptSubjectRecord; ui: HistoryUi }) {
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
                        {subject.subject || '—'}
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
                        {subject.code ? <span>{ui.transcriptCode}: {subject.code}</span> : null}
                        {subject.termLabel ? <span>{subject.termLabel}</span> : null}
                        <span>{ui.transcriptCredits}: {subject.credits || '—'}</span>
                        <span>
                            {ui.transcriptGpa}:{' '}
                            {typeof subject.gpa === 'number' ? subject.gpa.toFixed(2) : '—'}
                        </span>
                    </div>
                </div>
                <LetterGradeChip letter={subject.letterGrade} />
            </div>
        </div>
    );
}
