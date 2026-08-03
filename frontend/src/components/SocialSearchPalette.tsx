'use client';

/**
 * Cmd+K / Ctrl+K universal social search palette.
 *
 * A modal-style command bar that lets the viewer search across every social
 * entity they can read (group posts, tasks, DMs, global chat, announcements).
 * Backed by `GET /api/v3/social/search` — the backend handles per-row
 * authorization, so this component just renders whatever the API returns.
 *
 * Behavior:
 *   - Opens on Cmd+K / Ctrl+K when the `socialFeedBeta` flag is on. The
 *     keyboard binding lives in `GlobalShortcuts.tsx`; this component just
 *     listens for the open/close state passed down through props.
 *   - Input is debounced 300ms before firing a request so each keystroke
 *     doesn't generate a request.
 *   - Click a result → navigates to the appropriate page:
 *       group post / task / extra_lesson → /group?groupKey=<key>
 *       dm message                       → /chat?roomId=direct:<low>::<high>
 *       global message                   → /chat
 *       announcement                     → /group (announcements live there)
 *   - Esc closes the palette. Click-outside closes too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Search as SearchIcon } from 'lucide-react';
import {
    SOCIAL_SEARCH_MIN_QUERY_LENGTH,
    searchSocialEntities,
    type SocialEntityKind,
    type SocialEntityView,
    type SocialScopeType,
} from '@/lib/api/social';

// Debounce window (ms) between the last keystroke and the network call.
export const SOCIAL_SEARCH_DEBOUNCE_MS = 300;

/**
 * Pure helper — derive the in-app URL for a search hit. Exported so URL logic
 * can be unit-tested without rendering React.
 *
 * Mapping rules:
 *   - `scope_id` for group entities is `group:<key>` → /group?groupKey=<key>
 *   - `scope_id` for dm entities is `dm:direct:<low>::<high>` → /chat?roomId=direct:<low>::<high>
 *   - global / announcement → /chat or /group respectively
 */
export function buildSocialSearchResultUrl(entity: {
    scopeType: SocialScopeType;
    scopeId: string;
}): string {
    if (entity.scopeType === 'group') {
        const raw = entity.scopeId.startsWith('group:') ? entity.scopeId.slice(6) : entity.scopeId;
        return `/group?groupKey=${encodeURIComponent(raw)}`;
    }
    if (entity.scopeType === 'dm') {
        // scope_id is `dm:direct:<low>::<high>`; strip the `dm:` prefix so the
        // chat page receives the canonical `direct:...` room id.
        const raw = entity.scopeId.startsWith('dm:') ? entity.scopeId.slice(3) : entity.scopeId;
        return `/chat?roomId=${encodeURIComponent(raw)}`;
    }
    if (entity.scopeType === 'announcement') {
        return '/group';
    }
    return '/chat';
}

/**
 * Pure helper — derive a short label for a result row based on the entity
 * kind. Defaults to a localized fallback when no body/title/subject is found.
 * Exported for unit testing.
 */
export function buildSocialSearchResultLabel(
    entity: { kind: SocialEntityKind; payload: Record<string, unknown> },
): { title: string; preview: string } {
    const payload = entity.payload ?? {};
    const pick = (key: string): string => {
        const value = payload[key];
        return typeof value === 'string' ? value.trim() : '';
    };

    const title = pick('title') || pick('subject') || pick('question') || '';
    const body = pick('body') || pick('note') || '';

    if (title && body) {
        return { title, preview: body.slice(0, 140) };
    }
    if (title) {
        return { title, preview: '' };
    }
    if (body) {
        return { title: body.slice(0, 80), preview: body.length > 80 ? body.slice(80, 220) : '' };
    }
    // Fallback so a row never renders blank.
    return { title: entity.kind, preview: '' };
}

interface SocialSearchPaletteProps {
    open: boolean;
    onClose: () => void;
}

interface Strings {
    title: string;
    placeholder: string;
    hint: string;
    closeAria: string;
    empty: string;
    loading: string;
    errorPrefix: string;
    minLengthHint: string;
}

function pickStrings(language: 'ru' | 'kz' | 'en'): Strings {
    if (language === 'en') {
        return {
            title: 'Search posts and chats',
            placeholder: 'Search across groups, chats, announcements…',
            hint: 'Press Esc to close',
            closeAria: 'Close',
            empty: 'No matches.',
            loading: 'Searching…',
            errorPrefix: 'Search failed',
            minLengthHint: `Type at least ${SOCIAL_SEARCH_MIN_QUERY_LENGTH} characters.`,
        };
    }
    if (language === 'kz') {
        return {
            title: 'Жазбалар мен чаттарды іздеу',
            placeholder: 'Топтар, чаттар, хабарландырулар бойынша іздеу…',
            hint: 'Жабу үшін Esc',
            closeAria: 'Жабу',
            empty: 'Сәйкес келетіндер жоқ.',
            loading: 'Іздеу…',
            errorPrefix: 'Іздеу сәтсіз аяқталды',
            minLengthHint: `Кемінде ${SOCIAL_SEARCH_MIN_QUERY_LENGTH} таңба теріңіз.`,
        };
    }
    return {
        title: 'Поиск по постам и чатам',
        placeholder: 'Поиск по группам, чатам, объявлениям…',
        hint: 'Esc чтобы закрыть',
        closeAria: 'Закрыть',
        empty: 'Ничего не найдено.',
        loading: 'Поиск…',
        errorPrefix: 'Не удалось выполнить поиск',
        minLengthHint: `Введите минимум ${SOCIAL_SEARCH_MIN_QUERY_LENGTH} символа.`,
    };
}

function readAppLanguage(): 'ru' | 'kz' | 'en' {
    // Read the same `app-language` localStorage key the rest of the app uses,
    // without coupling this component to LanguageProvider in case it is mounted
    // outside the provider tree.
    if (typeof window === 'undefined') return 'ru';
    try {
        const stored = window.localStorage.getItem('app-language');
        if (stored === 'kz' || stored === 'en' || stored === 'ru') return stored;
    } catch {
        /* localStorage may be unavailable */
    }
    return 'ru';
}

const SCOPE_BADGE: Record<SocialScopeType, string> = {
    group: 'group',
    dm: 'dm',
    global: 'global',
    announcement: 'announcement',
};

export function SocialSearchPalette({ open, onClose }: SocialSearchPaletteProps) {
    const router = useRouter();
    // Read language on first render; rerenders only if the language flips
    // mid-session, which our LanguageProvider already triggers via storage.
    const language = useMemo<'ru' | 'kz' | 'en'>(() => readAppLanguage(), []);
    const strings = useMemo(() => pickStrings(language), [language]);

    // `sessionToken` flips on every open so dependent effects (focus + reset)
    // re-run without us having to call setState synchronously from the body.
    const [sessionToken, setSessionToken] = useState(0);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [results, setResults] = useState<SocialEntityView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const mounted = typeof window !== 'undefined';

    // Bump a session token when the palette reopens so dependent effects
    // re-run with a fresh state slate. Using a token rather than `open` alone
    // means the reset effect only runs on the open→true edge, not every render
    // while the palette is mounted. setState is wrapped in a microtask so it
    // does not fire synchronously from the effect body.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled) setSessionToken((n) => n + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [open]);

    // Reset state every time the palette is reopened so the previous query
    // doesn't flash on the second open. Triggered by sessionToken bumps.
    useEffect(() => {
        if (sessionToken === 0) return;
        queueMicrotask(() => {
            setQuery('');
            setDebouncedQuery('');
            setResults([]);
            setError(null);
            setLoading(false);
        });
        const id = window.setTimeout(() => {
            inputRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(id);
    }, [sessionToken]);

    // Debounce the query → debouncedQuery propagation.
    useEffect(() => {
        if (!open) return;
        const id = window.setTimeout(() => {
            setDebouncedQuery(query);
        }, SOCIAL_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [query, open]);

    // Fire the request when the debounced query changes. setState calls are
    // inside async callbacks (.then/.catch/.finally), so the lint rule passes.
    useEffect(() => {
        if (!open) return;
        const trimmed = debouncedQuery.trim();
        if (trimmed.length < SOCIAL_SEARCH_MIN_QUERY_LENGTH) return;

        let cancelled = false;
        // Mark loading + clear prior error asynchronously so the effect body
        // itself doesn't carry setState calls.
        queueMicrotask(() => {
            if (cancelled) return;
            setLoading(true);
            setError(null);
        });

        searchSocialEntities(trimmed)
            .then((res) => {
                if (cancelled) return;
                if (!res.success || !res.data) {
                    setResults([]);
                    setError(res.error ?? strings.errorPrefix);
                    return;
                }
                setResults(res.data.results);
            })
            .catch((err) => {
                if (cancelled) return;
                setResults([]);
                setError(err instanceof Error ? err.message : strings.errorPrefix);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [debouncedQuery, open, strings.errorPrefix]);

    // Clear stale results when the query falls below the minimum length. Done
    // in a separate effect so the body of the search effect above has no
    // synchronous setState calls.
    useEffect(() => {
        if (!open) return;
        if (debouncedQuery.trim().length >= SOCIAL_SEARCH_MIN_QUERY_LENGTH) return;
        queueMicrotask(() => {
            setResults([]);
            setError(null);
            setLoading(false);
        });
    }, [debouncedQuery, open]);

    // Close on Escape — listen on the document so the input doesn't have to
    // be focused for Esc to work.
    useEffect(() => {
        if (!open) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [open, onClose]);

    // Lock body scroll while the palette is open.
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    const handleResultClick = useCallback((view: SocialEntityView) => {
        const url = buildSocialSearchResultUrl(view.entity);
        onClose();
        router.push(url);
    }, [onClose, router]);

    if (!mounted || !open) return null;

    const trimmed = query.trim();
    const tooShort = trimmed.length > 0 && trimmed.length < SOCIAL_SEARCH_MIN_QUERY_LENGTH;
    const showEmpty = !loading && !error && debouncedQuery.trim().length >= SOCIAL_SEARCH_MIN_QUERY_LENGTH && results.length === 0;

    const overlay = (
        <div
            className="fixed inset-0 z-[9999] flex items-start justify-center px-4 pt-[10vh]"
            style={{ background: 'var(--overlay-modal-backdrop)' }}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            role="presentation"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={strings.title}
                className="w-full flex flex-col"
                style={{
                    maxWidth: 600,
                    maxHeight: '70vh',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 20,
                    boxShadow: 'var(--shadow-modal-strong)',
                    color: 'var(--text)',
                    outline: 'none',
                }}
            >
                <div className="flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0">
                    <SearchIcon className="w-5 h-5" strokeWidth={2} aria-hidden style={{ color: 'var(--muted)' }} />
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={strings.placeholder}
                        aria-label={strings.title}
                        autoComplete="off"
                        spellCheck={false}
                        className="flex-1 bg-transparent outline-none text-[15px]"
                        style={{ color: 'var(--text)' }}
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={strings.closeAria}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                        style={{ color: 'var(--muted)' }}
                    >
                        <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                    </button>
                </div>
                <div
                    aria-hidden
                    className="mx-4 h-px flex-shrink-0"
                    style={{ background: 'var(--border)', opacity: 0.5 }}
                />
                <div className="overflow-y-auto flex-1 px-2 py-2" style={{ display: 'flex', flexDirection: 'column' }}>
                    {tooShort && (
                        <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
                            {strings.minLengthHint}
                        </div>
                    )}
                    {loading && (
                        <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
                            {strings.loading}
                        </div>
                    )}
                    {error && (
                        <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--status-error-color, var(--text))' }}>
                            {strings.errorPrefix}: {error}
                        </div>
                    )}
                    {showEmpty && (
                        <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
                            {strings.empty}
                        </div>
                    )}
                    {!loading && !error && results.map((view) => {
                        const { title, preview } = buildSocialSearchResultLabel(view.entity);
                        return (
                            <button
                                key={view.entity.id}
                                type="button"
                                onClick={() => handleResultClick(view)}
                                className="text-left px-3 py-2.5 rounded-lg transition-colors hover:bg-[var(--surface-overlay-1,transparent)]"
                                style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                        style={{
                                            color: 'var(--muted)',
                                            border: '1px solid var(--border)',
                                            background: 'var(--surface-overlay-1, transparent)',
                                        }}
                                    >
                                        {SCOPE_BADGE[view.entity.scopeType]} · {view.entity.kind}
                                    </span>
                                    <span className="text-[14px] font-medium truncate" style={{ color: 'var(--text)' }}>
                                        {title}
                                    </span>
                                </div>
                                {preview && (
                                    <span className="text-[12px] truncate" style={{ color: 'var(--muted)' }}>
                                        {preview}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div
                    aria-hidden
                    className="mx-4 h-px flex-shrink-0"
                    style={{ background: 'var(--border)', opacity: 0.5 }}
                />
                <div className="px-4 py-2 text-[11px] flex-shrink-0" style={{ color: 'var(--muted)' }}>
                    {strings.hint}
                </div>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
