import type { ReactNode } from 'react';

interface PageHeaderProps {
    /** Optional small label above the title (uppercase, tracked). */
    eyebrow?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    /** Right-side slot for refresh buttons, mode pickers, etc. */
    action?: ReactNode;
    /** Hero accent shown behind the title — pass an emoji, lucide icon, or custom node. */
    icon?: ReactNode;
}

/**
 * Unified page-top: eyebrow → title → subtitle, optional right-aligned action.
 * Replaces ad-hoc `<header>`/`<h1>` blocks at the top of each inner page so all
 * authenticated pages share the same rhythm and typography.
 */
export function PageHeader({ eyebrow, title, subtitle, action, icon }: PageHeaderProps) {
    return (
        <header className="page-header">
            <div className="page-header-text">
                {eyebrow ? <span className="page-header-eyebrow">{eyebrow}</span> : null}
                <div className="page-header-title-row">
                    {icon ? <span className="page-header-icon" aria-hidden>{icon}</span> : null}
                    <h1 className="page-header-title">{title}</h1>
                </div>
                {subtitle ? <p className="page-header-subtitle">{subtitle}</p> : null}
            </div>
            {action ? <div className="page-header-action">{action}</div> : null}
        </header>
    );
}
