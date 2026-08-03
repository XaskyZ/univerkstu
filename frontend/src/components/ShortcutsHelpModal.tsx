'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import {
    formatCombo,
    type RegisteredShortcut,
    type ShortcutGroup,
    useKeyboardShortcuts,
} from '@/lib/keyboard-shortcuts';

/**
 * Help modal listing all registered keyboard shortcuts, grouped by category.
 *
 * - Opened by the `?` shortcut handled in the provider.
 * - Closed via the close button, click on the overlay, or Escape (handled
 *   locally so we don't depend on the global shortcut listener while a
 *   modal is open).
 * - Restores focus to the previously-focused element on close — minimal
 *   focus management, no full trap.
 */
export function ShortcutsHelpModal() {
    const { helpOpen, closeHelp, shortcuts } = useKeyboardShortcuts();
    const { messages } = useLanguage();
    const ui = messages.shortcuts;
    const containerRef = useRef<HTMLDivElement>(null);
    const previouslyFocused = useRef<Element | null>(null);
    const mounted = typeof window !== 'undefined';

    // Group shortcuts by category, preserving registration order within group.
    const grouped = useMemo(() => {
        const byGroup: Record<ShortcutGroup, RegisteredShortcut[]> = {
            navigation: [],
            actions: [],
            misc: [],
        };
        for (const item of shortcuts) {
            byGroup[item.group].push(item);
        }
        return byGroup;
    }, [shortcuts]);

    useEffect(() => {
        if (!helpOpen) return;
        previouslyFocused.current = document.activeElement;
        // Defer focus until after the portal renders.
        const id = window.setTimeout(() => {
            containerRef.current?.focus();
        }, 0);
        return () => {
            window.clearTimeout(id);
            if (previouslyFocused.current instanceof HTMLElement) {
                previouslyFocused.current.focus();
            }
        };
    }, [helpOpen]);

    useEffect(() => {
        if (!helpOpen) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeHelp();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [helpOpen, closeHelp]);

    useEffect(() => {
        if (!helpOpen) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [helpOpen]);

    if (!mounted || !helpOpen) return null;

    const groupTitle: Record<ShortcutGroup, string> = {
        navigation: ui.groupNavigation,
        actions: ui.groupActions,
        misc: ui.groupMisc,
    };

    const orderedGroups: ShortcutGroup[] = ['navigation', 'actions', 'misc'];

    const overlay = (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
            style={{ background: 'var(--overlay-modal-backdrop)' }}
            onClick={(event) => {
                if (event.target === event.currentTarget) closeHelp();
            }}
            role="presentation"
        >
            <div
                ref={containerRef}
                role="dialog"
                aria-modal="true"
                aria-label={ui.helpTitle}
                tabIndex={-1}
                className="w-full flex flex-col"
                style={{
                    maxWidth: 520,
                    maxHeight: '80vh',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 20,
                    boxShadow: 'var(--shadow-modal-strong)',
                    color: 'var(--text)',
                    outline: 'none',
                }}
            >
                <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>
                            {ui.helpTitle}
                        </h2>
                        <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted)' }}>
                            {ui.closeHint}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={closeHelp}
                        aria-label={messages.common.close}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                        style={{
                            color: 'var(--muted)',
                            background: 'var(--surface-overlay-2, transparent)',
                        }}
                    >
                        <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                    </button>
                </div>
                <div
                    aria-hidden
                    className="mx-4 h-px flex-shrink-0"
                    style={{ background: 'var(--border)', opacity: 0.5 }}
                />
                <div className="overflow-y-auto flex-1 px-5 py-4" style={{ display: 'grid', gap: 20 }}>
                    {orderedGroups.map((group) => {
                        const items = grouped[group];
                        if (items.length === 0) return null;
                        return (
                            <section key={group}>
                                <h3
                                    className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                                    style={{ color: 'var(--muted)' }}
                                >
                                    {groupTitle[group]}
                                </h3>
                                <ul style={{ display: 'grid', gap: 6 }}>
                                    {items.map((item) => (
                                        <li
                                            key={item.combo}
                                            className="flex items-center justify-between gap-3 py-1.5"
                                        >
                                            <span
                                                className="text-[14px]"
                                                style={{ color: 'var(--text)' }}
                                            >
                                                {item.description || item.combo}
                                            </span>
                                            <kbd
                                                style={{
                                                    fontFamily:
                                                        'ui-monospace, SFMono-Regular, Menlo, monospace',
                                                    fontSize: 12,
                                                    padding: '4px 8px',
                                                    borderRadius: 6,
                                                    border: '1px solid var(--border)',
                                                    background:
                                                        'var(--surface-overlay-1, var(--card))',
                                                    color: 'var(--text)',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {formatCombo(item.combo)}
                                            </kbd>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
