'use client';

export default function GroupTrashSection({
    title,
    hint,
    count,
    emptyText,
    children,
}: {
    title: string;
    hint: string;
    count: number;
    emptyText: string;
    children?: React.ReactNode;
}) {
    return (
        <section className="rounded-3xl p-4 space-y-3 surface-overlay-1" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="font-semibold text-fg">{title}</h4>
                    <p className="text-sm mt-1 text-muted-fg">{hint}</p>
                </div>
                <span className="chip" data-tone="muted">{count}</span>
            </div>
            {count === 0 ? <p className="text-sm text-muted-fg">{emptyText}</p> : children}
        </section>
    );
}
