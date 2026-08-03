import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type PageShellProps = ComponentPropsWithoutRef<'div'> & {
    children: ReactNode;
    animated?: boolean;
};

type PageMainProps = {
    children: ReactNode;
    className?: string;
    width?: 'default' | 'wide';
    spacing?: 'md' | 'lg';
};

type PageStateCardProps = {
    message: ReactNode;
    tone?: 'muted' | 'danger';
    className?: string;
};

function joinClasses(...values: Array<string | false | null | undefined>) {
    return values.filter(Boolean).join(' ');
}

export function PageShell({ children, className, animated = true, ...props }: PageShellProps) {
    return (
        <div className={joinClasses(animated && 'page-shell', className)} {...props}>
            {children}
        </div>
    );
}

export function PageMain({ children, className, width = 'default', spacing = 'md' }: PageMainProps) {
    return (
        <main
            className={joinClasses(
                'page-main',
                spacing === 'lg' ? 'page-main-spacing-lg' : 'page-main-spacing-md',
                width === 'wide' && 'group-workspace-main--wide',
                className
            )}
        >
            {children}
        </main>
    );
}

export function PageStateCard({ message, tone = 'muted', className }: PageStateCardProps) {
    return (
        <section className={joinClasses('card p-6', className)}>
            <p
                className={joinClasses(
                    'page-state-card-message',
                    tone === 'danger' ? 'page-state-card-message-danger' : 'page-state-card-message-muted'
                )}
            >
                {message}
            </p>
        </section>
    );
}
