'use client';

/**
 * `AnnouncementViewBridge` — инертный компонент: ничего не делает и не добавляет
 * DOM-узлов. Пропсы сохранены, чтобы вызывающие страницы (Coordinator/Curator/
 * Starosta) не менялись.
 */
export interface AnnouncementViewBridgeProps {
    entityId: string | null;
    enabled?: boolean;
    delayMs?: number;
}

export default function AnnouncementViewBridge(_props: AnnouncementViewBridgeProps): null {
    return null;
}
