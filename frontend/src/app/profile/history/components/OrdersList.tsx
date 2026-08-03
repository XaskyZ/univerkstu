import type { ProfileOrderRecord } from '@/app/profile/components/types';
import type { HistoryUi } from '../history-i18n';

interface OrdersListProps {
    orders: ProfileOrderRecord[];
    ui: HistoryUi;
}

/**
 * Renders the transcript order log (academic enrollment, transfer, dismissal,
 * etc.). Each order has a `numberAndDate` header line plus an optional course
 * and description.
 */
export function OrdersList({ orders, ui }: OrdersListProps) {
    if (orders.length === 0) {
        return (
            <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                {ui.transcriptOrdersEmpty}
            </p>
        );
    }

    return (
        <div className="space-y-2">
            {orders.map((order, index) => (
                <div
                    key={`${order.numberAndDate}-${index}`}
                    className="rounded-xl"
                    style={{
                        background: 'var(--surface-overlay-2)',
                        border: '1px solid var(--border)',
                        padding: '10px 12px',
                    }}
                >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                        {order.numberAndDate}
                    </div>
                    {(order.course || order.description) && (
                        <div
                            style={{
                                marginTop: '4px',
                                fontSize: '12px',
                                color: 'var(--muted)',
                                wordBreak: 'break-word',
                            }}
                        >
                            {[
                                order.course ? `${ui.transcriptOrderCourse}: ${order.course}` : null,
                                order.description,
                            ]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
