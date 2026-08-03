import { ChevronDown } from 'lucide-react';
import type {
    StudentAcademicOptions,
    StudentEducPlan,
} from './types';
import { useLanguage } from '@/lib/language-context';

interface ProfileQuestionnaireAccordionProps {
    educPlan?: StudentEducPlan | null;
    academicOptions?: StudentAcademicOptions | null;
}

/**
 * Full anketa (study plan, ОOD/БД/ПД, all academic options) collapsed under a
 * `<details>`. Куратор + practice are surfaced higher on the page; only the
 * detailed cycle counts / academic option totals live here.
 */
export function ProfileQuestionnaireAccordion({
    educPlan,
    academicOptions,
}: ProfileQuestionnaireAccordionProps) {
    const { messages } = useLanguage();
    const hasEducPlan = Boolean(
        educPlan?.summary?.admissionYear
        || educPlan?.summary?.totalSemesters
        || educPlan?.cycleCounts?.ood !== null
        || educPlan?.cycleCounts?.bd !== null
        || educPlan?.cycleCounts?.pd !== null
    );
    const hasAcademicOptions = Boolean(
        (academicOptions?.retake.availableCount || 0) > 0
        || (academicOptions?.retake.submittedCount || 0) > 0
        || (academicOptions?.fx.availableCount || 0) > 0
        || (academicOptions?.fx.submittedCount || 0) > 0
        || (academicOptions?.gpaIncrease.availableCount || 0) > 0
        || (academicOptions?.gpaIncrease.submittedCount || 0) > 0
        || academicOptions?.gpaIncrease.annualCost
    );

    if (!hasEducPlan && !hasAcademicOptions) {
        return null;
    }

    return (
        <details
            className="card animate-fadeInUp"
            style={{ animationDelay: '200ms', padding: 0 }}
        >
            <summary
                className="flex items-center justify-between gap-3 cursor-pointer select-none px-4 py-4"
                style={{ listStyle: 'none' }}
            >
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-fg truncate">
                        {messages.profile.you.questionnaireTitle}
                    </div>
                    <div className="text-xs mt-0.5 text-muted-fg truncate">
                        {messages.profile.you.questionnaireSummary}
                    </div>
                </div>
                <ChevronDown
                    className="w-4 h-4 shrink-0 transition-transform"
                    style={{ color: 'var(--muted)' }}
                    aria-hidden
                />
            </summary>

            <div className="p-4 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
                {hasEducPlan && educPlan && (
                    <div>
                        <div className="text-xs mb-2 text-muted-fg">
                            {messages.profile.educPlan}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <InfoTile
                                label={messages.profile.admissionYear}
                                value={educPlan.summary.admissionYear ? String(educPlan.summary.admissionYear) : '—'}
                            />
                            <InfoTile
                                label={messages.profile.totalSemesters}
                                value={educPlan.summary.totalSemesters ? String(educPlan.summary.totalSemesters) : '—'}
                            />
                            <InfoTile
                                label={messages.profile.cycleOod}
                                value={educPlan.cycleCounts.ood !== null ? String(educPlan.cycleCounts.ood) : '—'}
                            />
                            <InfoTile
                                label={messages.profile.cycleBd}
                                value={educPlan.cycleCounts.bd !== null ? String(educPlan.cycleCounts.bd) : '—'}
                            />
                            <InfoTile
                                label={messages.profile.cyclePd}
                                value={educPlan.cycleCounts.pd !== null ? String(educPlan.cycleCounts.pd) : '—'}
                            />
                            <InfoTile
                                label={messages.profile.additionalDisciplines}
                                value={educPlan.cycleCounts.additionalDisciplines !== null ? String(educPlan.cycleCounts.additionalDisciplines) : '—'}
                            />
                        </div>
                    </div>
                )}

                {hasAcademicOptions && academicOptions && (
                    <div>
                        <div className="text-xs mb-2 text-muted-fg">
                            {messages.profile.academicOptions}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <InfoTile label={messages.profile.retakeAvailable} value={String(academicOptions.retake.availableCount || 0)} />
                            <InfoTile label={messages.profile.retakeSubmitted} value={String(academicOptions.retake.submittedCount || 0)} />
                            <InfoTile label={messages.profile.fxAvailable} value={String(academicOptions.fx.availableCount || 0)} />
                            <InfoTile label={messages.profile.fxSubmitted} value={String(academicOptions.fx.submittedCount || 0)} />
                            <InfoTile label={messages.profile.gpaIncreaseAvailable} value={String(academicOptions.gpaIncrease.availableCount || 0)} />
                            <InfoTile label={messages.profile.gpaIncreaseSubmitted} value={String(academicOptions.gpaIncrease.submittedCount || 0)} />
                            <InfoTile label={messages.profile.gpaIncreaseAnnualCost} value={academicOptions.gpaIncrease.annualCost || '—'} span2 />
                        </div>
                    </div>
                )}
            </div>
        </details>
    );
}

function InfoTile({
    label,
    value,
    span2 = false,
}: {
    label: string;
    value: string;
    span2?: boolean;
}) {
    return (
        <div
            className={`rounded-xl px-3 py-3 surface-overlay-1 ${span2 ? 'sm:col-span-2' : ''}`}
            style={{ border: '1px solid var(--border)' }}
        >
            <div className="text-xs mb-1 text-muted-fg">{label}</div>
            <div className="text-sm font-medium break-words text-fg">{value}</div>
        </div>
    );
}
