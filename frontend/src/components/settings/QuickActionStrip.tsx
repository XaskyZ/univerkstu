'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '@/lib/language-context';
import { QuickActionChip } from './QuickActionChip';

export interface QuickActionItem {
    key: string;
    icon: ReactNode;
    label: string;
    href: string;
    badge?: string;
}

interface QuickActionStripProps {
    items: QuickActionItem[];
    /**
     * How many chips are visible without scrolling. Per owner spec we cap at 6
     * visible / 10 total — the rest scroll horizontally.
     */
    visibleCount?: number;
}

/**
 * Horizontal scroll-snap row used at the top of /settings just below the
 * IdentityStrip. Renders chips with gradient fade-out edges and snap-mandatory
 * scrolling so partial chips don't dangle. Accepts up to 10 items per spec —
 * caller is responsible for trimming role-gated entries.
 */
export function QuickActionStrip({ items, visibleCount = 6 }: QuickActionStripProps) {
    const { messages } = useLanguage();
    const trimmed = items.slice(0, 10);

    return (
        <section
            className="relative"
            aria-label={messages.common.actions}
            data-visible-count={visibleCount}
            style={{
                padding: '10px 8px',
                borderRadius: 20,
                background: 'var(--surface-overlay-1)',
                border: '1px solid var(--border)',
            }}
        >
            <div
                className="flex items-start gap-3 overflow-x-auto pb-1 pt-0.5 px-1"
                style={{
                    scrollSnapType: 'x mandatory',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                }}
            >
                {trimmed.map((item) => (
                    <QuickActionChip
                        key={item.key}
                        icon={item.icon}
                        label={item.label}
                        href={item.href}
                        badge={item.badge}
                    />
                ))}
            </div>
        </section>
    );
}
