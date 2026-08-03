'use client';

import { useMemo } from 'react';
import { ChevronRight, User, Users } from 'lucide-react';
import type { PlatonusSubjectGrade } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import {
    getSubjectStatusKey,
    getSubjectStatusTone,
} from '../utils/grades-helpers';
import { getTotalDisplayValue } from '../utils/goal-assistant';
import { extractAcademicCodeParts, humanizeAcademicSuffix } from '../utils/grade-titles';
import type { SubjectStatusKey } from '../types';
import { GradeScoreRing } from './GradeScoreRing';

function getStatusLabel(
    status: SubjectStatusKey,
    messages: ReturnType<typeof useLanguage>['messages']
): string {
    const labels = messages.grades.statusLabel;
    if (status === 'final') return labels.final;
    if (status === 'awaiting-exam') return labels.awaitingExam;
    if (status === 'awaiting-final') return labels.awaitingFinal;
    if (status === 'blocked') return labels.blocked;
    return labels.noData;
}

export function GradesSubjectListItem({
    subject,
    isActive,
    onSelect,
}: {
    subject: PlatonusSubjectGrade;
    isActive: boolean;
    onSelect: () => void;
}) {
    const { messages, language } = useLanguage();
    const totalDisplay = getTotalDisplayValue(subject);
    const statusKey = getSubjectStatusKey(subject);
    const statusTone = getSubjectStatusTone(statusKey);
    const statusLabel = getStatusLabel(statusKey, messages);
    const codeParts = useMemo(() => extractAcademicCodeParts(subject.code), [subject.code]);
    const codeSuffixLabel = useMemo(
        () => humanizeAcademicSuffix(codeParts.suffix, language),
        [codeParts.suffix, language]
    );

    const tutors = (subject.tutors ?? []).filter((name) => name && name.trim().length > 0);
    const tutorPreview = tutors.length === 0
        ? null
        : tutors.length === 1
            ? tutors[0]
            : `${tutors[0]} +${tutors.length - 1}`;
    const TutorIcon = tutors.length > 1 ? Users : User;

    return (
        <button
            type="button"
            onClick={onSelect}
            className={isActive ? 'grades-subject-row grades-subject-row-active' : 'grades-subject-row'}
            aria-pressed={isActive}
            aria-label={`${subject.name}. ${statusLabel}`}
        >
            <GradeScoreRing value={totalDisplay} />

            <div className="grades-subject-row-body">
                <div className="grades-subject-row-title">{subject.name}</div>

                {(subject.code || tutorPreview) && (
                    <div className="grades-subject-row-meta">
                        {subject.code ? (
                            <span className="grades-subject-row-code">{codeParts.base || subject.code}</span>
                        ) : null}
                        {codeSuffixLabel ? (
                            <span className="grades-subject-row-code" style={{ color: 'var(--muted)' }}>
                                · {codeSuffixLabel}
                            </span>
                        ) : null}
                        {tutorPreview ? (
                            <span className="grades-subject-row-tutor">
                                <TutorIcon size={12} strokeWidth={2} aria-hidden />
                                <span className="grades-subject-row-tutor-text">{tutorPreview}</span>
                            </span>
                        ) : null}
                    </div>
                )}

                <span
                    className="grades-subject-row-status"
                    style={{
                        ['--tone-border' as string]: statusTone.border,
                        ['--tone-bg' as string]: statusTone.bg,
                        ['--tone-color' as string]: statusTone.color,
                    }}
                >
                    {statusLabel}
                </span>
            </div>

            <ChevronRight
                size={18}
                strokeWidth={2}
                aria-hidden
                className="grades-subject-row-chevron"
            />
        </button>
    );
}
