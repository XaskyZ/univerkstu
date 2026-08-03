'use client';

import { useLanguage } from '@/lib/language-context';

/**
 * Тонкая статус-строка внутри control deck.
 * Показывает: "Логин: <username>" · text-link "Отключить".
 *
 * Cache-age не показываем здесь — это либо неточная информация,
 * либо дублирует "Обновлено: <date>" из metrics strip и freshHint.
 * Высота ~24-28px. На mobile username обрезается ellipsis,
 * но "Отключить" всегда остаётся видимым справа.
 */
export function GradesStatusLine({
    platonusUser,
    isStale,
    onDisconnect,
}: {
    platonusUser: string | null;
    isStale: boolean;
    onDisconnect: () => void;
}) {
    const { messages } = useLanguage();
    const status = messages.grades.status;

    const toneClass = isStale ? 'grades-status-line grades-status-line--warn' : 'grades-status-line';

    return (
        <div className={toneClass}>
            <div className="grades-status-line-info">
                {platonusUser ? (
                    <span className="grades-status-line-user" title={platonusUser}>
                        <span className="grades-status-line-user-label">{status.loginLabel}</span>{' '}
                        {platonusUser}
                    </span>
                ) : null}
            </div>

            <button
                type="button"
                onClick={onDisconnect}
                className="grades-status-line-disconnect"
                aria-label={messages.grades.disconnect}
            >
                {messages.grades.disconnect}
            </button>
        </div>
    );
}
