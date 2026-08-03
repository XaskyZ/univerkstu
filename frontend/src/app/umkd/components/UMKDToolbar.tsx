'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import {
    DEFAULT_FILTER_STATE,
    UMKD_FILE_TYPES,
    UMKD_SORTS,
    UmkdFilterState,
    UmkdSort,
} from '../utils/umkd-filters';
import { UmkdFileType } from '../utils/file-type';

interface UMKDToolbarProps {
    state: UmkdFilterState;
    onChange: (next: UmkdFilterState) => void;
    visibleCount?: number;
    totalCount?: number;
}

const SEARCH_DEBOUNCE_MS = 250;

export function UMKDToolbar({ state, onChange }: UMKDToolbarProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.toolbar;

    // Render-phase state reconciliation: when the external `state.query`
    // changes (e.g. URL navigation, reset filters), pull it into the local
    // input draft without scheduling an extra effect.
    const [queryDraft, setQueryDraft] = useState(state.query);
    const [externalQuery, setExternalQuery] = useState(state.query);
    if (state.query !== externalQuery) {
        setExternalQuery(state.query);
        setQueryDraft(state.query);
    }

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounce search updates outbound to the parent.
    useEffect(() => {
        if (queryDraft === externalQuery) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onChange({ ...state, query: queryDraft });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [queryDraft, externalQuery, onChange, state]);

    const typeLabels = useMemo<Record<UmkdFileType, string>>(
        () => ({
            pdf: t.typePdf,
            doc: t.typeDoc,
            ppt: t.typePpt,
            excel: t.typeExcel,
            archive: t.typeArchive,
            other: t.typeOther,
        }),
        [t.typePdf, t.typeDoc, t.typePpt, t.typeExcel, t.typeArchive, t.typeOther]
    );

    const sortLabels = useMemo<Record<UmkdSort, string>>(
        () => ({
            'name-asc': t.sortByName,
            'date-desc': t.sortByDateDesc,
            'date-asc': t.sortByDateAsc,
            'size-desc': t.sortBySizeDesc,
            'size-asc': t.sortBySizeAsc,
        }),
        [t.sortByName, t.sortByDateDesc, t.sortByDateAsc, t.sortBySizeDesc, t.sortBySizeAsc]
    );

    // For chip semantics: empty `state.types` means "all selected".
    const allSelected =
        state.types.length === 0 || state.types.length === UMKD_FILE_TYPES.length;

    const toggleType = useCallback(
        (type: UmkdFileType) => {
            const current = new Set<UmkdFileType>(
                state.types.length === 0 ? UMKD_FILE_TYPES : state.types
            );
            if (current.has(type)) {
                current.delete(type);
            } else {
                current.add(type);
            }
            // If user just deselected the last chip, fall back to "all".
            const next = current.size === 0 ? [] : UMKD_FILE_TYPES.filter((t) => current.has(t));
            // If user just selected every type, collapse to "all".
            const nextTypes = next.length === UMKD_FILE_TYPES.length ? [] : next;
            onChange({ ...state, types: nextTypes });
        },
        [state, onChange]
    );

    const selectAll = useCallback(() => {
        onChange({ ...state, types: [] });
    }, [state, onChange]);

    const handleSort = useCallback(
        (e: React.ChangeEvent<HTMLSelectElement>) => {
            const sort = e.target.value as UmkdSort;
            onChange({ ...state, sort });
        },
        [state, onChange]
    );

    return (
        <div className="umkd-toolbar flex flex-col gap-3">
            <input
                type="search"
                inputMode="search"
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
                className="input"
                style={{ padding: '10px 14px', fontSize: '0.95rem' }}
            />

            <div className="flex flex-col gap-2">
                <span
                    className="text-xs uppercase tracking-wide"
                    style={{ color: 'var(--muted)', letterSpacing: '0.04em' }}
                >
                    {t.filterType}
                </span>
                <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label={t.filterType}
                >
                    <button
                        type="button"
                        className="chip"
                        data-active={allSelected ? 'true' : 'false'}
                        aria-pressed={allSelected}
                        onClick={selectAll}
                    >
                        {t.typeAll}
                    </button>
                    {UMKD_FILE_TYPES.map((type) => {
                        const active = !allSelected && state.types.includes(type);
                        return (
                            <button
                                key={type}
                                type="button"
                                className="chip"
                                data-active={active ? 'true' : 'false'}
                                aria-pressed={active}
                                onClick={() => toggleType(type)}
                            >
                                {typeLabels[type]}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <label
                    htmlFor="umkd-sort"
                    className="text-xs uppercase tracking-wide"
                    style={{ color: 'var(--muted)', letterSpacing: '0.04em' }}
                >
                    {t.sortBy}
                </label>
                <select
                    id="umkd-sort"
                    value={state.sort}
                    onChange={handleSort}
                    className="input"
                    style={{
                        width: 'auto',
                        padding: '8px 12px',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                    }}
                >
                    {UMKD_SORTS.map((s) => (
                        <option key={s} value={s}>
                            {sortLabels[s]}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}

interface UMKDFilteredEmptyProps {
    onReset: () => void;
}

export function UMKDFilteredEmpty({ onReset }: UMKDFilteredEmptyProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.toolbar;
    return (
        <div className="empty-state">
            <h3 className="empty-state-title">{t.emptyFiltered}</h3>
            <button
                type="button"
                onClick={onReset}
                className="btn btn-primary mt-4"
            >
                {t.resetFilters}
            </button>
        </div>
    );
}

export { DEFAULT_FILTER_STATE };
