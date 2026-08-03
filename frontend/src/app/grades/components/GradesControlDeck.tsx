'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import type { PlatonusGradesData, PlatonusSemester } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import {
    GradesSearchBar,
    type GradesFilterKey,
} from '@/app/grades/components/GradesSearchBar';
import { GradesMetricsStrip } from '@/app/grades/components/GradesMetricsStrip';
import { GradesStatusLine } from '@/app/grades/components/GradesStatusLine';

/**
 * Один общий control deck сверху `/grades`. Заменяет связку:
 *   app-header + grades-connection-banner + grades-overview-card + grades-search-bar.
 *
 * Внутри — единственный визуальный контейнер с тонкими разделителями между секциями:
 *   1. compact header (title + semester + refresh)
 *   2. status line (Platonus user · cache age · disconnect)
 *   3. metrics strip (GPA · subjects · updated)
 *   4. search + filter chips
 *
 * Логика fetch/cache/disconnect остаётся в `GradesView` — сюда приходят только handlers.
 */
export function GradesControlDeck({
    semesters,
    selectedYear,
    selectedSemester,
    onSemesterChange,
    onRefresh,
    refreshing,
    platonusUser,
    cacheAgeMin,
    isStale,
    onDisconnect,
    grades,
    searchQuery,
    onSearchChange,
    filter,
    onFilterChange,
    filterCounts,
    showSearch,
}: {
    semesters: PlatonusSemester[];
    selectedYear: number;
    selectedSemester: number;
    onSemesterChange: (value: string) => void;
    onRefresh: () => void;
    refreshing: boolean;
    platonusUser: string | null;
    cacheAgeMin: number | null;
    isStale: boolean;
    onDisconnect: () => void;
    grades: PlatonusGradesData | null;
    searchQuery: string;
    onSearchChange: (next: string) => void;
    filter: GradesFilterKey;
    onFilterChange: (next: GradesFilterKey) => void;
    filterCounts: Record<GradesFilterKey, number>;
    showSearch: boolean;
}) {
    const { messages } = useLanguage();

    const isFreshAndConnected =
        Boolean(platonusUser) &&
        cacheAgeMin !== null &&
        cacheAgeMin < 30 &&
        !isStale &&
        !refreshing;

    return (
        <section className="grades-deck" aria-label={messages.grades.title}>
            <div className="grades-deck-row grades-deck-row--head">
                <h1 className="grades-deck-title">{messages.grades.title}</h1>

                <div className="grades-deck-head-actions">
                    <label className="grades-deck-semester">
                        <span className="sr-only">{messages.grades.controlDeck.semesterAria}</span>
                        <select
                            value={`${selectedYear}/${selectedSemester}`}
                            onChange={(event) => onSemesterChange(event.target.value)}
                            className="grades-deck-semester-select"
                            aria-label={messages.grades.controlDeck.semesterAria}
                        >
                            {semesters.map((semester) => (
                                <option
                                    key={`${semester.year}/${semester.semester}`}
                                    value={`${semester.year}/${semester.semester}`}
                                >
                                    {semester.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="grades-deck-refresh"
                        aria-label={messages.grades.refresh}
                        title={messages.grades.refresh}
                    >
                        {refreshing ? (
                            <Loader2 size={16} strokeWidth={2.25} className="animate-spin" aria-hidden />
                        ) : (
                            <RefreshCw size={16} strokeWidth={2.25} aria-hidden />
                        )}
                    </button>
                </div>
            </div>

            {platonusUser ? (
                <div className="grades-deck-row grades-deck-row--status">
                    <GradesStatusLine
                        platonusUser={platonusUser}
                        isStale={isStale}
                        onDisconnect={onDisconnect}
                    />
                </div>
            ) : null}

            <div className="grades-deck-row grades-deck-row--metrics">
                <GradesMetricsStrip
                    gpa={grades?.meta.gpa}
                    totalSubjects={grades?.meta.totalSubjects}
                    parsedAt={grades?.meta.parsedAt}
                    loading={!grades}
                />
            </div>

            {isFreshAndConnected ? (
                <div className="grades-deck-row grades-deck-row--hint">
                    <p className="grades-deck-hint">{messages.grades.controlDeck.freshHint}</p>
                </div>
            ) : null}

            {showSearch ? (
                <div className="grades-deck-row grades-deck-row--search">
                    <GradesSearchBar
                        query={searchQuery}
                        onQueryChange={onSearchChange}
                        filter={filter}
                        onFilterChange={onFilterChange}
                        counts={filterCounts}
                    />
                </div>
            ) : null}
        </section>
    );
}
