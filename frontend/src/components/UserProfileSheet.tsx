'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';
import FriendActionButton from '@/components/FriendActionButton';
import { useLanguage } from '@/lib/language-context';

function getInitials(label: string, userId: string): string {
    const source = label.trim() || userId.trim();
    const tokens = source.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        return `${tokens[0][0] || ''}${tokens[1][0] || ''}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
}

export default function UserProfileSheet({
    targetUserId,
    label,
    groupKey = null,
    subtitle = null,
    description = null,
    actions = null,
    trigger,
    triggerClassName = '',
    triggerStyle,
}: {
    targetUserId: string;
    label: string;
    groupKey?: string | null;
    subtitle?: string | null;
    description?: string | null;
    actions?: ReactNode;
    trigger: ReactNode;
    triggerClassName?: string;
    triggerStyle?: CSSProperties;
}) {
    const { language } = useLanguage();
    const [open, setOpen] = useState(false);
    const dialogRef = useRef<HTMLDialogElement | null>(null);

    const ui = useMemo(() => {
        if (language === 'en') return { profile: 'Profile', group: 'Group', close: 'Close', actions: 'Actions', userId: 'User ID' };
        if (language === 'kz') return { profile: 'Профиль', group: 'Топ', close: 'Жабу', actions: 'Әрекеттер', userId: 'Пайдаланушы ID' };
        return { profile: 'Профиль', group: 'Группа', close: 'Закрыть', actions: 'Действия', userId: 'ID пользователя' };
    }, [language]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                className={triggerClassName}
                style={triggerStyle}
            >
                {trigger}
            </button>

            <dialog
                ref={dialogRef}
                className="profile-sheet-dialog"
                onClick={(event) => {
                    if (event.target === event.currentTarget) setOpen(false);
                }}
                onCancel={(event) => {
                    event.preventDefault();
                    setOpen(false);
                }}
                onClose={() => setOpen(false)}
            >
                <div className="profile-sheet-panel">
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label={ui.close}
                        className="profile-sheet-close"
                    >
                        <X size={16} strokeWidth={2.4} />
                    </button>

                    <div className="profile-sheet-scroll">
                        <div className="profile-sheet-hero">
                            <div className="profile-sheet-hero-row">
                                <div className="profile-sheet-avatar">
                                    {getInitials(label, targetUserId)}
                                </div>
                                <div className="profile-sheet-meta">
                                    <div className="profile-sheet-eyebrow">{ui.profile}</div>
                                    <div className="profile-sheet-title">{label}</div>
                                    <div className="profile-sheet-id">{ui.userId}: {targetUserId}</div>
                                </div>
                            </div>

                            {(groupKey || subtitle || description) && (
                                <div className="profile-sheet-extra">
                                    {(groupKey || subtitle) && (
                                        <div className="profile-sheet-tags">
                                            {groupKey && (
                                                <span className="profile-sheet-tag profile-sheet-tag-primary">
                                                    {ui.group}: {groupKey}
                                                </span>
                                            )}
                                            {subtitle && (
                                                <span className="profile-sheet-tag">{subtitle}</span>
                                            )}
                                        </div>
                                    )}
                                    {description && (
                                        <div className="profile-sheet-desc">{description}</div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="profile-sheet-actions-card">
                            <div className="profile-sheet-eyebrow">{ui.actions}</div>
                            <div className="profile-sheet-actions-list">
                                <FriendActionButton targetUserId={targetUserId} />
                                {actions}
                            </div>
                        </div>
                    </div>

                    <div className="profile-sheet-footer">
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="profile-sheet-close-btn"
                        >
                            {ui.close}
                        </button>
                    </div>
                </div>
            </dialog>
        </>
    );
}
