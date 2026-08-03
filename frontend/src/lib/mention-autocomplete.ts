/**
 * Pure helpers + hook for the @mention autocomplete dropdown used by the
 * social composers (FeedTab modal, CommentsThread, DialogsPanel).
 *
 * The hook is intentionally separate from the UI so the same trigger /
 * replace / debounce logic can be reused by any future composer surface
 * without re-implementing the textarea hookup. The pure helpers
 * (`detectMentionTrigger`, `replaceMentionToken`) carry the heavy lifting
 * and are covered by extensive unit tests — the React side is a thin
 * wrapper.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchSocialUsers, type SocialUserHint } from './api';

// === Pure helpers ===========================================================

/**
 * Result of `detectMentionTrigger`. `active=true` means the caret sits inside
 * a valid `@…` token; the dropdown should be open with `query` filtered
 * candidates. `tokenStart` is the index of the `@` character so the
 * `replaceMentionToken` helper can compute the slice to swap out.
 */
export interface MentionTrigger {
    active: boolean;
    query: string;
    tokenStart: number;
}

const INACTIVE: MentionTrigger = { active: false, query: '', tokenStart: -1 };

/**
 * Inspect `text` at `caretPos` and figure out whether we're in an `@xxx`
 * mention token. A token is "active" when:
 *
 *   - the most recent `@` before `caretPos` exists
 *   - the `@` is either at the start of the text OR preceded by a
 *     non-alphanumeric character (so `email@gmail.com` does NOT trigger)
 *   - the characters between `@` and `caretPos` are `[A-Za-z0-9_]*`
 *   - the slice does NOT contain a whitespace / newline (those terminate
 *     the token)
 *
 * `query` is the substring after `@` and BEFORE the caret. An empty query
 * (caret immediately after `@`) is still active — the dropdown opens with
 * an empty filter so the user sees an initial suggestion list.
 *
 * Pure — no DOM access.
 */
export function detectMentionTrigger(text: string, caretPos: number): MentionTrigger {
    if (typeof text !== 'string' || text.length === 0) return INACTIVE;
    if (!Number.isFinite(caretPos) || caretPos < 0) return INACTIVE;
    const clampedCaret = Math.min(caretPos, text.length);

    // Walk backwards from caretPos to find the nearest @, bailing on whitespace.
    let atIndex = -1;
    for (let i = clampedCaret - 1; i >= 0; i--) {
        const ch = text.charCodeAt(i);
        // whitespace (space, tab, newline, CR) terminates a candidate token
        if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
            return INACTIVE;
        }
        if (text.charAt(i) === '@') {
            atIndex = i;
            break;
        }
        if (!isHandleChar(text.charCodeAt(i))) {
            // anything other than word chars + @ terminates the token (.,;? etc)
            return INACTIVE;
        }
    }
    if (atIndex < 0) return INACTIVE;

    // Guard against email-local-parts: `@` must be either at index 0 or
    // preceded by a non-alphanumeric character.
    if (atIndex > 0) {
        const prevCh = text.charCodeAt(atIndex - 1);
        if (isAlphanumeric(prevCh)) return INACTIVE;
    }

    const query = text.slice(atIndex + 1, clampedCaret);
    // Defensive: ensure every character of the query is a valid handle char.
    for (let i = 0; i < query.length; i++) {
        if (!isHandleChar(query.charCodeAt(i))) return INACTIVE;
    }

    return { active: true, query, tokenStart: atIndex };
}

function isHandleChar(code: number): boolean {
    return (
        (code >= 0x30 && code <= 0x39) // 0-9
        || (code >= 0x41 && code <= 0x5a) // A-Z
        || (code >= 0x61 && code <= 0x7a) // a-z
        || code === 0x5f // _
    );
}

function isAlphanumeric(code: number): boolean {
    return (
        (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x5a)
        || (code >= 0x61 && code <= 0x7a)
    );
}

/**
 * Build the replacement text after the user picks a handle from the
 * dropdown. Replaces the `@query` slice (from `tokenStart` up to `caretPos`)
 * with `@handle ` (note the trailing space — matches typical chat UX so the
 * user can keep typing without manually adding a separator).
 *
 * Returns `{ next, nextCaret }` so the caller can write back to the textarea
 * state in a single setState call and reposition the caret right after the
 * inserted space.
 *
 * Pure — no DOM access.
 */
export function replaceMentionToken(
    text: string,
    trigger: MentionTrigger,
    caretPos: number,
    handle: string,
): { next: string; nextCaret: number } {
    if (!trigger.active || trigger.tokenStart < 0) {
        return { next: text, nextCaret: caretPos };
    }
    const safeHandle = (handle || '').trim();
    if (!safeHandle) {
        return { next: text, nextCaret: caretPos };
    }
    const clampedCaret = Math.min(Math.max(0, caretPos), text.length);
    const before = text.slice(0, trigger.tokenStart);
    const after = text.slice(clampedCaret);
    const insertion = `@${safeHandle} `;
    const next = `${before}${insertion}${after}`;
    const nextCaret = before.length + insertion.length;
    return { next, nextCaret };
}

// === Hook ===================================================================

export interface UseMentionAutocompleteOpts {
    /** Scope passed straight through to `searchSocialUsers`. E.g. `"group:ITS-21"` or `"dm:direct:a::b"`. */
    scope: string;
    /** How long to wait (ms) after the last keystroke before firing the search. */
    debounceMs?: number;
    /** Hard cap on candidates fetched from the backend. Defaults to 10. */
    limit?: number;
}

export interface UseMentionAutocompleteState {
    /** True when the dropdown should be visible. */
    isOpen: boolean;
    /** Current `@query` substring (without the `@`). */
    query: string;
    /** Cached candidate list for the latest query. */
    candidates: SocialUserHint[];
    /** True while the latest search is in flight. */
    loading: boolean;
    /** Currently highlighted candidate index (for keyboard nav). */
    selectedIndex: number;
    /** Stored trigger position so callers can run `replaceMentionToken` later. */
    trigger: MentionTrigger;
}

export interface UseMentionAutocompleteApi extends UseMentionAutocompleteState {
    /** Open the dropdown for the given trigger position. */
    open: (trigger: MentionTrigger) => void;
    /** Close the dropdown and clear candidates. */
    close: () => void;
    /** Manually nudge the highlighted candidate. */
    setSelectedIndex: (index: number) => void;
    /** Helpers for keyboard handlers. */
    moveSelection: (delta: number) => void;
}

/**
 * Drives the dropdown state for a single composer surface. The hook does
 * NOT touch the DOM directly — the consumer wires the `open` / `close` /
 * `moveSelection` calls into its own `onChange` / `onKeyDown` handlers.
 *
 * Search is debounced so a rapid `@` `a` `b` keystroke burst issues one
 * request, not three. When the trigger closes (caret leaves the token,
 * whitespace inserted, Esc pressed) the in-flight search result is dropped.
 */
export function useMentionAutocomplete(opts: UseMentionAutocompleteOpts): UseMentionAutocompleteApi {
    const debounceMs = opts.debounceMs ?? 120;
    const limit = opts.limit ?? 10;
    const scope = opts.scope;

    const [state, setState] = useState<UseMentionAutocompleteState>({
        isOpen: false,
        query: '',
        candidates: [],
        loading: false,
        selectedIndex: 0,
        trigger: INACTIVE,
    });

    // We carry a per-search request id so a stale resolved promise cannot
    // overwrite a fresher result.
    const requestIdRef = useRef(0);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearDebounce = useCallback(() => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => clearDebounce(), [clearDebounce]);

    const close = useCallback(() => {
        clearDebounce();
        requestIdRef.current += 1; // invalidate any in-flight request
        setState({
            isOpen: false,
            query: '',
            candidates: [],
            loading: false,
            selectedIndex: 0,
            trigger: INACTIVE,
        });
    }, [clearDebounce]);

    const runSearch = useCallback(
        async (query: string, requestId: number) => {
            try {
                const response = await searchSocialUsers(scope, query, limit);
                if (requestId !== requestIdRef.current) return;
                if (response.success && response.data) {
                    setState((current) => ({
                        ...current,
                        candidates: response.data!.users,
                        loading: false,
                        // Reset highlight to 0 each new result set so the user
                        // can keep tapping Enter / arrows on a known anchor.
                        selectedIndex: 0,
                    }));
                } else {
                    setState((current) => ({
                        ...current,
                        candidates: [],
                        loading: false,
                        selectedIndex: 0,
                    }));
                }
            } catch {
                if (requestId !== requestIdRef.current) return;
                setState((current) => ({
                    ...current,
                    candidates: [],
                    loading: false,
                    selectedIndex: 0,
                }));
            }
        },
        [scope, limit],
    );

    const open = useCallback(
        (trigger: MentionTrigger) => {
            if (!trigger.active) {
                close();
                return;
            }
            const query = trigger.query;
            setState((current) => ({
                ...current,
                isOpen: true,
                query,
                trigger,
                loading: true,
            }));
            clearDebounce();
            requestIdRef.current += 1;
            const requestId = requestIdRef.current;
            debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;
                void runSearch(query, requestId);
            }, debounceMs);
        },
        [close, clearDebounce, debounceMs, runSearch],
    );

    const setSelectedIndex = useCallback((index: number) => {
        setState((current) => {
            if (current.candidates.length === 0) {
                return current.selectedIndex === 0 ? current : { ...current, selectedIndex: 0 };
            }
            const max = current.candidates.length - 1;
            const clamped = Math.min(Math.max(0, index), max);
            return current.selectedIndex === clamped ? current : { ...current, selectedIndex: clamped };
        });
    }, []);

    const moveSelection = useCallback((delta: number) => {
        setState((current) => {
            if (current.candidates.length === 0) return current;
            const max = current.candidates.length - 1;
            // Wrap around — Down at bottom -> top, Up at top -> bottom. Matches
            // typical chat-app autocomplete behaviour.
            let next = current.selectedIndex + delta;
            if (next < 0) next = max;
            else if (next > max) next = 0;
            return current.selectedIndex === next ? current : { ...current, selectedIndex: next };
        });
    }, []);

    return useMemo<UseMentionAutocompleteApi>(
        () => ({
            ...state,
            open,
            close,
            setSelectedIndex,
            moveSelection,
        }),
        [state, open, close, setSelectedIndex, moveSelection],
    );
}

// === Composer adapter =======================================================

export interface UseMentionableTextareaOpts {
    /** Same as `UseMentionAutocompleteOpts.scope`. */
    scope: string;
    /** Current textarea value (controlled component). */
    value: string;
    /** Setter called when the picker replaces a token. */
    onChange: (next: string) => void;
    /** Optional override for the debounce window. */
    debounceMs?: number;
    /** Optional override for the result limit. */
    limit?: number;
}

export interface UseMentionableTextareaApi {
    autocomplete: UseMentionAutocompleteApi;
    /** Wire into the textarea's `onSelect` and `onChange`. */
    handleSelectionChange: (caretPos: number) => void;
    /** Run inside the textarea's `onKeyDown`. Returns true when the event was consumed. */
    handleKeyDown: (event: {
        key: string;
        shiftKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
        currentTarget: { selectionStart: number | null } | null;
    }) => boolean;
    /** Click handler for a candidate row in the dropdown. */
    handlePickCandidate: (handle: string, caretPosOverride?: number) => void;
    /** Last known caret position — exposed so the dropdown can compute its anchor. */
    caretPos: number;
}

/**
 * Wraps `useMentionAutocomplete` with a textarea-aware adapter that:
 *
 *   - watches caret position changes and runs `detectMentionTrigger`
 *   - handles ↑ / ↓ navigation, Enter (select), Esc (close)
 *   - rewrites the textarea value through `onChange` when a candidate is
 *     picked (and bumps the caret past the inserted handle)
 *
 * The three composers share this hook so the dropdown wiring stays
 * identical across surfaces. The caller still owns its own `onKeyDown` for
 * submit-on-Enter / shift+Enter newline — when the dropdown is open we
 * consume Enter and return `true`; the caller checks the return value to
 * decide whether to forward the event to its own submit handler.
 */
export function useMentionableTextarea(opts: UseMentionableTextareaOpts): UseMentionableTextareaApi {
    const autocomplete = useMentionAutocomplete({
        scope: opts.scope,
        debounceMs: opts.debounceMs,
        limit: opts.limit,
    });
    const [caretPos, setCaretPos] = useState(0);
    const valueRef = useRef(opts.value);
    const caretRef = useRef(0);
    useEffect(() => {
        valueRef.current = opts.value;
    }, [opts.value]);

    const handleSelectionChange = useCallback(
        (next: number) => {
            const safe = Math.max(0, Math.min(next, valueRef.current.length));
            caretRef.current = safe;
            setCaretPos(safe);
            const trigger = detectMentionTrigger(valueRef.current, safe);
            if (trigger.active) {
                autocomplete.open(trigger);
            } else if (autocomplete.isOpen) {
                autocomplete.close();
            }
        },
        [autocomplete],
    );

    const handlePickCandidate = useCallback(
        (handle: string, caretPosOverride?: number) => {
            const trigger = autocomplete.trigger;
            if (!trigger.active) return;
            const caret = caretPosOverride ?? caretRef.current;
            const { next, nextCaret } = replaceMentionToken(valueRef.current, trigger, caret, handle);
            opts.onChange(next);
            // Update local refs so a follow-up keystroke detects the right
            // trigger state immediately (without waiting for the parent
            // value-prop to flush back through `valueRef`).
            valueRef.current = next;
            caretRef.current = nextCaret;
            setCaretPos(nextCaret);
            autocomplete.close();
        },
        [autocomplete, opts],
    );

    const handleKeyDown = useCallback(
        (event: {
            key: string;
            shiftKey: boolean;
            preventDefault: () => void;
            stopPropagation: () => void;
            currentTarget: { selectionStart: number | null } | null;
        }): boolean => {
            if (!autocomplete.isOpen) return false;
            // Esc closes the picker without forwarding.
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                autocomplete.close();
                return true;
            }
            if (autocomplete.candidates.length === 0) return false;
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                autocomplete.moveSelection(1);
                return true;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                autocomplete.moveSelection(-1);
                return true;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                const candidate = autocomplete.candidates[autocomplete.selectedIndex];
                if (!candidate) return false;
                event.preventDefault();
                event.stopPropagation();
                const caret = event.currentTarget?.selectionStart ?? caretRef.current;
                handlePickCandidate(candidate.userId, caret ?? caretRef.current);
                return true;
            }
            if (event.key === 'Tab') {
                const candidate = autocomplete.candidates[autocomplete.selectedIndex];
                if (!candidate) return false;
                event.preventDefault();
                event.stopPropagation();
                const caret = event.currentTarget?.selectionStart ?? caretRef.current;
                handlePickCandidate(candidate.userId, caret ?? caretRef.current);
                return true;
            }
            return false;
        },
        [autocomplete, handlePickCandidate],
    );

    return {
        autocomplete,
        handleSelectionChange,
        handleKeyDown,
        handlePickCandidate,
        caretPos,
    };
}
