'use client';

import { useLanguage } from '@/lib/language-context';
import { formatParsedAt, formatRelativeParsedAge } from '@/app/grades/utils/grades-helpers';

/**
 * Compact 3-tile strip: GPA · Subjects · Updated.
 * Полностью заменяет старую `grades-overview-card`.
 *
 * Высота ≤ 72px на мобильных. На очень узких экранах допускается горизонтальный scroll.
 */
export function GradesMetricsStrip({
    gpa,
    totalSubjects,
    parsedAt,
    loading,
}: {
    gpa: number | null | undefined;
    totalSubjects: number | null | undefined;
    parsedAt: string | undefined;
    loading: boolean;
}) {
    const { messages, language } = useLanguage();
    const metrics = messages.grades.metrics;

    const locale = language === 'kz' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU';
    const formatted = formatParsedAt(parsedAt, locale).replace(', ', ' ');
    const relative = formatRelativeParsedAge(parsedAt, language);

    const gpaText =
        typeof gpa === 'number' && Number.isFinite(gpa) && gpa > 0 ? gpa.toFixed(2) : '—';
    const subjectsText =
        typeof totalSubjects === 'number' && totalSubjects >= 0 ? String(totalSubjects) : '—';

    return (
        <div className="grades-metrics-strip" role="group">
            <div className="grades-metric-tile">
                <div className="grades-metric-tile-label">{metrics.gpaLabel}</div>
                <div
                    className={
                        loading
                            ? 'grades-metric-tile-value grades-metric-tile-value--loading'
                            : 'grades-metric-tile-value'
                    }
                >
                    {loading ? '··' : gpaText}
                </div>
                {!loading && gpaText !== '—' ? (
                    <div className="grades-metric-tile-caption">{metrics.gpaCaption}</div>
                ) : null}
            </div>

            <div className="grades-metric-tile">
                <div className="grades-metric-tile-label">{metrics.subjectsLabel}</div>
                <div
                    className={
                        loading
                            ? 'grades-metric-tile-value grades-metric-tile-value--loading'
                            : 'grades-metric-tile-value'
                    }
                >
                    {loading ? '··' : subjectsText}
                </div>
            </div>

            <div className="grades-metric-tile">
                <div className="grades-metric-tile-label">{metrics.updatedLabel}</div>
                <div className="grades-metric-tile-value grades-metric-tile-value--small">
                    {formatted || '—'}
                </div>
                {relative ? <div className="grades-metric-tile-caption">{relative}</div> : null}
            </div>
        </div>
    );
}
