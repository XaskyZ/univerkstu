'use client';

import { Search, X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

export type GradesFilterKey = 'all' | 'final' | 'awaiting' | 'risk';

const FILTER_ORDER: GradesFilterKey[] = ['all', 'final', 'awaiting', 'risk'];

export function GradesSearchBar({
    query,
    onQueryChange,
    filter,
    onFilterChange,
    counts,
}: {
    query: string;
    onQueryChange: (next: string) => void;
    filter: GradesFilterKey;
    onFilterChange: (next: GradesFilterKey) => void;
    counts: Record<GradesFilterKey, number>;
}) {
    const { messages } = useLanguage();
    const filterLabels = messages.grades.filterLabel;

    function labelFor(key: GradesFilterKey): string {
        if (key === 'all') return filterLabels.all;
        if (key === 'final') return filterLabels.final;
        if (key === 'awaiting') return filterLabels.awaiting;
        return filterLabels.risk;
    }

    return (
        <div className="grades-search-bar">
            <div className="grades-search-input-wrap">
                <Search
                    size={16}
                    strokeWidth={2}
                    aria-hidden
                    className="grades-search-icon"
                />
                <input
                    type="search"
                    className="grades-search-input"
                    placeholder={messages.grades.searchPlaceholder}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                />
                {query.length > 0 ? (
                    <button
                        type="button"
                        className="grades-search-clear"
                        onClick={() => onQueryChange('')}
                        aria-label={messages.grades.searchClear}
                    >
                        <X size={14} strokeWidth={2} aria-hidden />
                    </button>
                ) : null}
            </div>

            <div className="grades-filter-row" role="group" aria-label={messages.grades.filterAriaLabel}>
                {FILTER_ORDER.map((key) => {
                    const isActive = key === filter;
                    const count = counts[key] ?? 0;
                    return (
                        <button
                            key={key}
                            type="button"
                            className={isActive ? 'grades-filter-chip grades-filter-chip-active' : 'grades-filter-chip'}
                            onClick={() => onFilterChange(key)}
                            aria-pressed={isActive}
                        >
                            <span>{labelFor(key)}</span>
                            <span className="grades-filter-count">{count}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
