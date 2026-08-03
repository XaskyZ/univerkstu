/**
 * `useFocusHighlight` — drives the temporary `.entity-highlighted` class
 * on a card after a permalink redirect lands on a host surface with
 * `?focus=<entityId>` in the URL.
 *
 * Why a hook (and not just CSS or a one-shot effect inside each tab):
 *  - The host surfaces (`FeedTab`, `TasksTab`, `LessonsTab`,
 *    `DialogsPanel`, `GlobalPanel`, announcement pages) all render lists
 *    where the matching card is not known until the data loads. The hook
 *    captures the focus id once, then lets each card ask "am I the
 *    focused one?" via the returned `isHighlighted` predicate.
 *  - The highlight is timed (3s pulse, matches the CSS animation
 *    duration) — after the timer fires the predicate flips back to
 *    `false` and the class is removed from the DOM. We do not rely on
 *    `animation-fill-mode: forwards` so the highlight is naturally
 *    re-triggered if the same entity is shared again in the same session.
 *  - The scroll-into-view side effect happens once, scoped to the host
 *    surface, via `scrollFocusedIntoView`. Each card opts into
 *    self-registration through the returned `registerEntityNode`.
 *
 * Implementation:
 *  - State machine: `focusId` is read from the URL query (or a manual
 *    `setFocus` call) on mount. A 3s timer flips it to null. The
 *    predicate just compares to the current `focusId`.
 *  - `registerEntityNode(id)` returns a `ref` callback the card spreads
 *    on its outermost element. When the matching ref attaches AND the
 *    focus id is set, the hook calls `scrollIntoView` once and remembers
 *    the id so subsequent re-renders don't repeatedly re-scroll.
 *  - DOM access is gated by `typeof window !== 'undefined'` so the hook
 *    is safe to import from server components / SSR builds, even though
 *    the consuming surfaces are all client-only.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Highlight duration in ms. Mirrors the keyframe length in
 * `globals.css` (`.entity-highlighted` runs for `3s`). Exported so unit
 * tests can reference the same constant.
 */
export const ENTITY_HIGHLIGHT_DURATION_MS = 3000;

export interface UseFocusHighlightResult {
    /**
     * The currently-focused entity id, or `null` when the highlight is
     * already cleared. Cards typically use `isHighlighted` instead, but
     * the raw id is useful for badge labels / aria-live announcements.
     */
    focusId: string | null;
    /**
     * Predicate consumed by each card. Returns `true` while the
     * highlight timer is still active AND the given id matches the
     * focused entity. The card spreads `entity-highlighted` onto its
     * className when this returns `true`.
     */
    isHighlighted: (id: string) => boolean;
    /**
     * `ref` factory for self-registration. Spread on the outermost card
     * element — `<article ref={registerEntityNode(post.id)}>`. The hook
     * invokes `scrollIntoView({ behavior: 'smooth', block: 'center' })`
     * once when the matching node attaches.
     */
    registerEntityNode: (id: string) => (node: HTMLElement | null) => void;
    /**
     * Imperative override. Useful for SSE flows that want to highlight a
     * freshly-arrived entity without a URL change. Triggers the same 3s
     * timer.
     */
    setFocus: (id: string | null) => void;
    /**
     * Cancel any active highlight. Idempotent.
     */
    clearFocus: () => void;
}

/**
 * Pure helper — read the focus id from a URLSearchParams-compatible
 * source. Extracted so unit tests can exercise the parsing without a
 * Next router stub.
 *
 * Accepts either a `URLSearchParams` instance, a `string`, or `null`.
 * Strings are passed through `new URLSearchParams(...)` so call sites
 * can hand in `window.location.search` directly.
 */
export function readFocusFromQuery(query: URLSearchParams | string | null | undefined): string | null {
    if (!query) return null;
    const params = typeof query === 'string' ? new URLSearchParams(query) : query;
    const raw = params.get('focus');
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Drive a 3s highlight after a permalink redirect.
 *
 * Typical usage inside a host surface:
 *
 *   const { isHighlighted, registerEntityNode } =
 *       useFocusHighlight(searchParams.get('focus'));
 *
 *   ...
 *
 *   <article
 *       ref={registerEntityNode(post.id)}
 *       className={isHighlighted(post.id) ? 'card entity-highlighted' : 'card'}
 *   >
 *       ...
 *   </article>
 */
export function useFocusHighlight(initialFocusId: string | null | undefined): UseFocusHighlightResult {
    // Derive the trimmed focus id straight from the input on every render.
    // Doing this inline (instead of mirroring into state via an effect) keeps
    // the lint rule "no setState in effect body" satisfied AND ensures a URL
    // change is reflected immediately rather than on the next render tick.
    const derivedFromInput = typeof initialFocusId === 'string' && initialFocusId.trim().length > 0
        ? initialFocusId.trim()
        : null;

    // Internal override drives the auto-clear timer + manual `setFocus`/
    // `clearFocus` callers. Treat `'__INHERIT__'` as the "no manual override
    // — fall back to derived input" sentinel because `null` is already a
    // valid override (manual clear).
    const [override, setOverride] = useState<string | null | '__INHERIT__'>('__INHERIT__');

    // The effective focus id is the manual override when one is set, else the
    // derived value from the prop. When the override clears (`__INHERIT__`),
    // we follow the latest input; when it explicitly sets `null`, the
    // highlight is suppressed even if the URL still carries `?focus=`.
    const focusId = override === '__INHERIT__' ? derivedFromInput : override;

    // Remember which entity nodes we've already scrolled to so re-renders
    // (e.g. parent state changes) don't reset the scroll position back
    // onto the highlighted card every time React reconciles the list.
    const scrolledIdsRef = useRef<Set<string>>(new Set());

    // Auto-clear the focus after the highlight duration. The timer is the
    // only piece of "external state" the effect maintains; calling
    // `setOverride(null)` inside the timer callback (NOT in the effect body)
    // is allowed by the lint rule because it runs asynchronously.
    useEffect(() => {
        if (focusId === null) return undefined;
        const timer = window.setTimeout(() => {
            setOverride(null);
        }, ENTITY_HIGHLIGHT_DURATION_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [focusId]);

    const isHighlighted = useCallback(
        (id: string): boolean => focusId !== null && id === focusId,
        [focusId],
    );

    const registerEntityNode = useCallback(
        (id: string) => (node: HTMLElement | null) => {
            if (!node) return;
            if (focusId !== id) return;
            if (scrolledIdsRef.current.has(id)) return;
            if (typeof window === 'undefined') return;
            scrolledIdsRef.current.add(id);
            // Schedule on the next frame so the surrounding list has a
            // chance to finish its current layout pass — scrolling
            // mid-reconcile occasionally misses the target on slow
            // devices when the surrounding cards are still measuring.
            window.requestAnimationFrame(() => {
                try {
                    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch {
                    // Older WebViews / jsdom may throw on the options
                    // argument — fall back to the no-arg form.
                    node.scrollIntoView();
                }
            });
        },
        [focusId],
    );

    const setFocus = useCallback((id: string | null) => {
        if (id === null) {
            setOverride(null);
            return;
        }
        const trimmed = id.trim();
        if (trimmed.length === 0) {
            setOverride(null);
            return;
        }
        // Reset the scroll-already cache so a re-shared id can re-scroll.
        scrolledIdsRef.current = new Set();
        setOverride(trimmed);
    }, []);

    const clearFocus = useCallback(() => setOverride(null), []);

    return useMemo<UseFocusHighlightResult>(
        () => ({ focusId, isHighlighted, registerEntityNode, setFocus, clearFocus }),
        [focusId, isHighlighted, registerEntityNode, setFocus, clearFocus],
    );
}
