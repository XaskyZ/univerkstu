'use client';

import type { KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface HideToggleProps {
    expanded: boolean;
    onToggle: () => void;
    labelExpanded: string;
    labelCollapsed: string;
    sublabel?: string;
}

/**
 * Standalone tappable card that collapses/expands a secondary section.
 *
 * Visually similar to a SettingsRow: full-width card with a title +
 * optional sublabel on the left and a chevron caret on the right. The
 * caret rotates 180° based on `expanded` state.
 *
 * Keyboard accessible (`Enter` / `Space`). Uses semantic CSS variables
 * only — no Tailwind colour utilities, no `dark:` modifiers.
 */
export default function HideToggle({
    expanded,
    onToggle,
    labelExpanded,
    labelCollapsed,
    sublabel,
}: HideToggleProps) {
    const label = expanded ? labelExpanded : labelCollapsed;

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            onToggle();
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            onClick={onToggle}
            onKeyDown={handleKeyDown}
            className="card mb-3 flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors"
            style={{ color: 'var(--text)' }}
        >
            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {label}
                </div>
                {sublabel ? (
                    <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                        {sublabel}
                    </div>
                ) : null}
            </div>
            <span
                aria-hidden
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-transform"
                style={{
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
            >
                {expanded ? (
                    <ChevronUp className="h-4 w-4" strokeWidth={2} />
                ) : (
                    <ChevronDown className="h-4 w-4" strokeWidth={2} />
                )}
            </span>
        </div>
    );
}
