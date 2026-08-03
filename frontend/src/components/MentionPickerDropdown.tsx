'use client';

/**
 * Standalone presentational dropdown for the @mention autocomplete picker.
 *
 * Has no internal state — every aspect (open, candidates, highlight,
 * positioning) is driven by props so the parent composer keeps full control
 * over the state machine. This keeps the component reusable across the three
 * composer surfaces (FeedTab modal, CommentsThread, DialogsPanel) without
 * forking three near-identical popovers.
 *
 * Styling: semantic CSS variables only — no `text-blue-*`, no `dark:*`. The
 * focus ring uses `var(--primary)`; the row hover uses `var(--surface-overlay-2)`
 * to match the rest of the social UI.
 */

import { useEffect, useRef } from 'react';
import type { SocialUserHint } from '@/lib/api';

export interface MentionPickerDropdownProps {
    /** When false, nothing is rendered. */
    open: boolean;
    /** Loaded candidates — the highlighted row reflects `selectedIndex`. */
    candidates: SocialUserHint[];
    /** Index of the currently-highlighted candidate. */
    selectedIndex: number;
    /** Called when a row is clicked. */
    onSelect: (handle: string) => void;
    /** Called when the user moves the mouse over a row (so highlight follows). */
    onHover?: (index: number) => void;
    /** True while the search is in flight — shows a loading row. */
    loading?: boolean;
    /** Override the loading copy (defaults to 'Searching...'). */
    loadingLabel?: string;
    /** Override the empty-state copy (defaults to 'No matches'). */
    emptyLabel?: string;
    /**
     * Optional ARIA label for the listbox so screen readers announce the
     * picker correctly. Defaults to a generic English label — i18n is
     * supplied via the language-context-aware caller when present.
     */
    listboxLabel?: string;
}

export default function MentionPickerDropdown({
    open,
    candidates,
    selectedIndex,
    onSelect,
    onHover,
    loading = false,
    loadingLabel = 'Searching...',
    emptyLabel = 'No matches',
    listboxLabel = 'Mention suggestions',
}: MentionPickerDropdownProps) {
    const activeRowRef = useRef<HTMLLIElement | null>(null);

    // Keep the highlighted row visible when keyboard nav scrolls past the
    // viewport. Scoped to nearest-scroll so we don't yank the document.
    useEffect(() => {
        if (!open) return;
        const node = activeRowRef.current;
        if (node && typeof node.scrollIntoView === 'function') {
            node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }, [open, selectedIndex]);

    if (!open) return null;

    return (
        <div
            className="card"
            role="presentation"
            style={{
                position: 'absolute',
                zIndex: 50,
                marginTop: 4,
                maxHeight: 240,
                overflowY: 'auto',
                minWidth: 220,
                maxWidth: 360,
                padding: 4,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
            }}
        >
            <ul
                role="listbox"
                aria-label={listboxLabel}
                style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
                {loading && candidates.length === 0 ? (
                    <li
                        role="option"
                        aria-selected={false}
                        aria-disabled={true}
                        style={{
                            padding: '8px 10px',
                            fontSize: 13,
                            color: 'var(--muted)',
                        }}
                    >
                        {loadingLabel}
                    </li>
                ) : null}

                {!loading && candidates.length === 0 ? (
                    <li
                        role="option"
                        aria-selected={false}
                        aria-disabled={true}
                        style={{
                            padding: '8px 10px',
                            fontSize: 13,
                            color: 'var(--muted)',
                        }}
                    >
                        {emptyLabel}
                    </li>
                ) : null}

                {candidates.map((candidate, index) => {
                    const active = index === selectedIndex;
                    return (
                        <li
                            key={candidate.userId}
                            ref={active ? activeRowRef : null}
                            role="option"
                            aria-selected={active}
                            // Use onMouseDown (not onClick) so the click handler
                            // fires BEFORE the textarea blurs and we lose the
                            // selection state needed for replaceMentionToken.
                            onMouseDown={(event) => {
                                event.preventDefault();
                                onSelect(candidate.userId);
                            }}
                            onMouseEnter={() => onHover?.(index)}
                            style={{
                                padding: '8px 10px',
                                borderRadius: 8,
                                cursor: 'pointer',
                                background: active ? 'var(--surface-overlay-2)' : 'transparent',
                                outline: active ? '2px solid var(--primary)' : 'none',
                                outlineOffset: -2,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                            }}
                        >
                            <span
                                style={{
                                    color: 'var(--text)',
                                    fontWeight: 600,
                                    fontSize: 13,
                                    lineHeight: 1.2,
                                }}
                            >
                                @{candidate.userId}
                            </span>
                            {candidate.displayName ? (
                                <span
                                    style={{
                                        color: 'var(--muted)',
                                        fontSize: 12,
                                        lineHeight: 1.2,
                                    }}
                                >
                                    {candidate.displayName}
                                </span>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
