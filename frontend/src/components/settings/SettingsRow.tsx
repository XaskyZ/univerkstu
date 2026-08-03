'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface BaseProps {
    icon?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    /**
     * Slot rendered on the right side of the row (before the chevron). Useful
     * for value text, toggles, segmented controls, badges.
     */
    rightSlot?: ReactNode;
    /**
     * Whether to show the chevron at the very end (only relevant when the row
     * navigates). Defaults to true when `href` or `onClick` is provided, false
     * otherwise.
     */
    showChevron?: boolean;
    badge?: ReactNode;
    disabled?: boolean;
    className?: string;
}

interface LinkRowProps extends BaseProps {
    href: string;
    onClick?: never;
    type?: never;
    ariaLabel?: string;
}

interface ButtonRowProps extends BaseProps {
    href?: never;
    onClick: () => void;
    type?: 'button';
    ariaLabel?: string;
}

interface StaticRowProps extends BaseProps {
    href?: never;
    onClick?: never;
    type?: never;
    ariaLabel?: never;
}

type SettingsRowProps = LinkRowProps | ButtonRowProps | StaticRowProps;

/**
 * iOS-style settings entry-point row: icon (left) + title + optional subtitle
 * + right slot (value text OR toggle OR segmented OR chevron). Polymorphic:
 * renders as `<Link>` when `href` is set, `<button>` when `onClick` is set,
 * or a plain `<div>` for inline rows that embed their own interactive control
 * in `rightSlot`.
 */
export function SettingsRow(props: SettingsRowProps) {
    const navigates = 'href' in props || 'onClick' in props;
    const showChevron = props.showChevron ?? navigates;
    const innerClass = `w-full flex items-center gap-4 px-4 py-3.5 text-left transition-colors ${navigates ? 'active:scale-[0.99]' : ''} ${props.className ?? ''}`;

    const body = (
        <>
            {props.icon ? (
                <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(var(--primary-rgb), 0.10)', color: 'var(--primary)' }}
                    aria-hidden
                >
                    {props.icon}
                </span>
            ) : null}
            <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                    <span className="font-medium text-[15px] text-fg truncate">{props.title}</span>
                    {props.badge ? props.badge : null}
                </span>
                {props.subtitle ? (
                    <span className="block text-[12px] truncate mt-0.5 text-muted-fg">{props.subtitle}</span>
                ) : null}
            </span>
            {props.rightSlot ? (
                <span className="flex items-center gap-2 flex-shrink-0 text-[13px] text-muted-fg">
                    {props.rightSlot}
                </span>
            ) : null}
            {showChevron ? (
                <ChevronRight
                    className="w-5 h-5 flex-shrink-0"
                    style={{ color: 'var(--muted)', opacity: 0.5 }}
                    strokeWidth={2}
                    aria-hidden
                />
            ) : null}
        </>
    );

    if ('href' in props && props.href) {
        return (
            <Link
                href={props.href}
                aria-label={props.ariaLabel}
                className={innerClass}
            >
                {body}
            </Link>
        );
    }

    if ('onClick' in props && props.onClick) {
        return (
            <button
                type="button"
                onClick={props.onClick}
                disabled={props.disabled}
                aria-label={props.ariaLabel}
                className={`${innerClass} disabled:opacity-60`}
            >
                {body}
            </button>
        );
    }

    return <div className={innerClass}>{body}</div>;
}
