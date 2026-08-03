'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

interface QuickActionChipProps {
    icon: ReactNode;
    label: string;
    href: string;
    badge?: string;
}

/**
 * Single chip rendered inside QuickActionStrip: a 48px circle icon stacked on
 * top of an 11px label. Tap target is at least 64px tall to feel natural on
 * mobile, and the chip uses a semantic primary tint instead of a hardcoded
 * blue.
 */
export function QuickActionChip({ icon, label, href, badge }: QuickActionChipProps) {
    return (
        <Link
            href={href}
            aria-label={label}
            className="flex flex-col items-center gap-1.5 shrink-0 snap-start active:scale-[0.96] transition-transform"
            style={{ width: 68 }}
        >
            <span className="relative inline-flex items-center justify-center">
                <span
                    className="inline-flex items-center justify-center"
                    style={{
                        width: 48,
                        height: 48,
                        borderRadius: 16,
                        background: 'rgba(var(--primary-rgb), 0.14)',
                        color: 'var(--primary)',
                        border: '1px solid rgba(var(--primary-rgb), 0.18)',
                    }}
                    aria-hidden
                >
                    {icon}
                </span>
                {badge ? (
                    <span
                        className="absolute -top-1 -right-1 chip"
                        data-tone="warning"
                        data-size="sm"
                        style={{ padding: '2px 6px', fontSize: 9 }}
                    >
                        {badge}
                    </span>
                ) : null}
            </span>
            <span
                className="text-[11px] text-center text-fg leading-tight w-full truncate"
                style={{ maxWidth: 64 }}
            >
                {label}
            </span>
        </Link>
    );
}
