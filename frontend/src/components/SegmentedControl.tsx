'use client';

import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
    ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    disabled?: boolean;
    ariaLabel?: string;
}

/**
 * Generic iOS-style 2-4 segment chooser. Used immediately for the Language
 * picker on /settings, but kept generic so other settings sub-screens can
 * reuse it (e.g. "list view" vs "grid view" toggles).
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    disabled = false,
    ariaLabel,
}: SegmentedControlProps<T>) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="inline-flex items-center rounded-full p-1"
            style={{
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
            }}
        >
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={option.ariaLabel || undefined}
                        disabled={disabled}
                        onClick={() => onChange(option.value)}
                        className="segmented-control-option px-3 py-1.5 text-xs font-semibold rounded-full transition-colors disabled:opacity-50"
                        style={{
                            background: active ? 'var(--primary)' : 'transparent',
                            color: active ? 'var(--button-primary-fg)' : 'var(--text)',
                            minWidth: 36,
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
