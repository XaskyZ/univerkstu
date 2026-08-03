'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import { ALLOWED_REACTION_EMOJI, type ReactionAggregate } from '@/lib/api';
import { getReactionsUi } from './reactions-i18n';

interface ReactionsBarProps {
    reactions: ReactionAggregate[];
    mine: string[];
    onToggle: (emoji: string) => Promise<void>;
}

/**
 * Horizontal row of 5 fixed emoji buttons with their counters. Each button
 * works as a toggle:
 *   - if the user has not picked this emoji yet → optimistically +1 and
 *     mark it active;
 *   - if the user already picked it → optimistically -1 and unmark.
 *
 * On error we roll back to the previous snapshot so the visible state stays
 * consistent with what the server will replace it with on the next refresh.
 *
 * No new themed colours: active state uses the existing `--primary` token,
 * inactive uses the standard chip-style border + surface tokens.
 */
export default function ReactionsBar({ reactions, mine, onToggle }: ReactionsBarProps) {
    const { language } = useLanguage();
    const ui = useMemo(() => getReactionsUi(language), [language]);

    // Optimistic state — seeded from props so the parent stays the source of
    // truth, but we render local changes immediately while the request flies.
    const [optimisticCounts, setOptimisticCounts] = useState<Map<string, number>>(new Map());
    const [optimisticMine, setOptimisticMine] = useState<Set<string> | null>(null);
    const [busyEmoji, setBusyEmoji] = useState<string | null>(null);

    const countsFromServer = useMemo(() => {
        const map = new Map<string, number>();
        for (const item of reactions) {
            map.set(item.emoji, item.count);
        }
        return map;
    }, [reactions]);

    const mineSet = useMemo(() => {
        if (optimisticMine) return optimisticMine;
        return new Set(mine);
    }, [optimisticMine, mine]);

    const getCount = useCallback(
        (emoji: string): number => {
            if (optimisticCounts.has(emoji)) {
                return optimisticCounts.get(emoji) || 0;
            }
            return countsFromServer.get(emoji) || 0;
        },
        [optimisticCounts, countsFromServer],
    );

    const handleToggle = useCallback(
        async (emoji: string) => {
            if (busyEmoji) return;
            const wasMine = mineSet.has(emoji);
            const prevCount = getCount(emoji);
            const nextCount = Math.max(0, prevCount + (wasMine ? -1 : 1));

            // Optimistic update — record both directions so a follow-up render
            // before refresh stays consistent.
            const nextCounts = new Map(optimisticCounts);
            nextCounts.set(emoji, nextCount);
            const nextMine = new Set(mineSet);
            if (wasMine) nextMine.delete(emoji);
            else nextMine.add(emoji);
            setOptimisticCounts(nextCounts);
            setOptimisticMine(nextMine);

            setBusyEmoji(emoji);
            try {
                await onToggle(emoji);
                // On success the parent will refetch and pass new props; clear
                // the optimistic overlay so server data wins again.
                setOptimisticCounts(new Map());
                setOptimisticMine(null);
            } catch {
                // Roll back to the pre-click snapshot.
                setOptimisticCounts(optimisticCounts);
                setOptimisticMine(optimisticMine);
            } finally {
                setBusyEmoji(null);
            }
        },
        [busyEmoji, mineSet, getCount, optimisticCounts, optimisticMine, onToggle],
    );

    return (
        <div
            role="group"
            aria-label={ui.barLabel}
            className="flex items-center gap-2 flex-wrap"
        >
            {ALLOWED_REACTION_EMOJI.map((emoji) => {
                const active = mineSet.has(emoji);
                const count = getCount(emoji);
                const busy = busyEmoji === emoji;
                return (
                    <button
                        key={emoji}
                        type="button"
                        aria-label={ui.pickAria(emoji)}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => void handleToggle(emoji)}
                        // Minimum 44px tap target on mobile per the spec.
                        style={{
                            minHeight: 36,
                            minWidth: 44,
                            padding: '6px 10px',
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: busy ? 'progress' : 'pointer',
                            border: active
                                ? '1px solid rgba(var(--primary-rgb), 0.6)'
                                : '1px solid var(--border)',
                            background: active
                                ? 'rgba(var(--primary-rgb), 0.12)'
                                : 'var(--surface-overlay-1)',
                            color: 'var(--text)',
                            opacity: busy ? 0.7 : 1,
                            transition: 'background 0.15s ease, border-color 0.15s ease',
                        }}
                    >
                        <span aria-hidden="true" style={{ fontSize: 16 }}>{emoji}</span>
                        {count > 0 ? (
                            <span
                                style={{
                                    fontVariantNumeric: 'tabular-nums',
                                    color: active ? 'var(--primary)' : 'var(--muted)',
                                }}
                            >
                                {count}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
