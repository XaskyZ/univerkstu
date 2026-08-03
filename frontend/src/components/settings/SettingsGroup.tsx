'use client';

import { Children, type ReactNode } from 'react';

interface SettingsGroupProps {
    title?: string;
    description?: string;
    children: ReactNode;
}

/**
 * Sectioned container with an uppercase eyebrow header and a rounded `.card`
 * containing rows divided by a thin border between them. Supersedes the older
 * SettingsSection, which only added a header above a stack of cards. Here the
 * children themselves do not draw their own card chrome — the group does.
 */
export function SettingsGroup({ title, description, children }: SettingsGroupProps) {
    const items = Children.toArray(children).filter(Boolean);

    return (
        <section className="space-y-2 reveal-on-scroll">
            {title ? (
                <header className="px-1">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-fg">{title}</h2>
                    {description ? <p className="mt-1 text-xs text-muted-fg/80">{description}</p> : null}
                </header>
            ) : null}
            <div className="card overflow-hidden">
                {items.map((child, index) => (
                    <div
                        key={index}
                        style={index > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
                    >
                        {child}
                    </div>
                ))}
            </div>
        </section>
    );
}
