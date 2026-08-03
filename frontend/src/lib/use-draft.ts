/**
 * `useDraft` — localStorage-backed autosave for composer text fields.
 *
 * The social surfaces (DM, global chat, comments, post/poll/event modals) all
 * share the same UX gripe: a casual refresh / surface switch wipes whatever
 * the user had typed but not yet sent. This hook persists the in-progress
 * value under a stable per-scope key and offers it back next time the
 * composer mounts.
 *
 * Design notes:
 *   - Pure helpers (`buildDraftKey`, `readDraft`, `writeDraft`, `clearDraft`)
 *     are exported separately so tests can exercise the persistence contract
 *     without needing a React renderer. Per project conventions React hooks
 *     are not unit-tested directly.
 *   - SSR-safe — every storage access checks `typeof window !== 'undefined'`
 *     and silently swallows access errors (private mode, disabled storage).
 *   - Empty values do NOT persist; an empty composer is treated as the user
 *     intentionally clearing the draft. This keeps the storage tidy and
 *     avoids resurrecting a stale empty hint on every reopen.
 *   - Restoration runs once per `key` change. Switching keys (e.g. the user
 *     opens a different DM room) re-attempts a restore against the new key.
 *   - The autosave is debounced (default 500ms) so a fast typist does not
 *     hammer `localStorage.setItem` on every keystroke.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Default namespace prefix for keys written by this hook. */
export const DEFAULT_DRAFT_NAMESPACE = 'social-draft:';

/** Default debounce window (ms) before the value is committed to storage. */
export const DEFAULT_DRAFT_DEBOUNCE_MS = 500;

/**
 * Build a deterministic, normalized draft key from a prefix and arbitrary
 * parts. Parts are joined with `:` and trimmed of whitespace. Empty parts
 * collapse to a single placeholder so a missing entity id never silently
 * merges with a different scope (e.g. `dm:` + `` becomes `dm:_` rather than
 * the ambiguous `dm:`).
 *
 * Examples:
 *   buildDraftKey('dm', 'room-42')                 -> 'dm:room-42'
 *   buildDraftKey('comment-reply', 'cmt-1')        -> 'comment-reply:cmt-1'
 *   buildDraftKey('global', 'chat')                -> 'global:chat'
 *   buildDraftKey('feed-create', '')               -> 'feed-create:_'
 */
export function buildDraftKey(prefix: string, ...parts: string[]): string {
    const safePrefix = (prefix || '').trim() || '_';
    const safeParts = parts.map((part) => {
        const trimmed = (part || '').trim();
        return trimmed.length > 0 ? trimmed : '_';
    });
    return [safePrefix, ...safeParts].join(':');
}

/**
 * Read the raw draft value stored under the given key. Returns `null` when:
 *   - no `window` is available (SSR / non-browser runtime)
 *   - the key is missing
 *   - storage access throws (private mode, quota errors, etc.)
 *
 * The value is returned verbatim — no JSON parsing — because drafts are
 * always plain strings.
 */
export function readDraft(key: string, namespace: string = DEFAULT_DRAFT_NAMESPACE): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const value = window.localStorage.getItem(`${namespace}${key}`);
        return value && value.length > 0 ? value : null;
    } catch {
        return null;
    }
}

/**
 * Persist the given value under the storage key. An empty / whitespace-only
 * value calls `clearDraft` instead so the key never holds an empty string
 * (which would later confuse `hasDraft` heuristics).
 *
 * Failures (quota, unavailable storage) are swallowed silently — drafts are
 * a "best effort" surface, never a source of truth.
 */
export function writeDraft(
    key: string,
    value: string,
    namespace: string = DEFAULT_DRAFT_NAMESPACE,
): void {
    if (typeof window === 'undefined') return;
    if (!value || value.trim().length === 0) {
        clearDraft(key, namespace);
        return;
    }
    try {
        window.localStorage.setItem(`${namespace}${key}`, value);
    } catch {
        // ignore — quota / private mode / disabled storage
    }
}

/** Remove a draft from storage. Safe to call when the key is already absent. */
export function clearDraft(key: string, namespace: string = DEFAULT_DRAFT_NAMESPACE): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(`${namespace}${key}`);
    } catch {
        // ignore
    }
}

export interface UseDraftOpts {
    /**
     * Unique storage key for this draft scope (e.g. `dm:room-42`,
     * `comment-top:entity-uuid`). When the key changes the hook attempts a
     * fresh restore against the new key.
     */
    key: string;
    /**
     * Current composer value. The hook persists this value (debounced) on
     * every change. Pass the raw composer state — the hook handles trimming
     * and empty-value semantics internally.
     */
    value: string;
    /**
     * Invoked once with the restored draft when one is found on mount /
     * after the key changes. Callers should funnel the value back into their
     * composer state setter. The hook will NOT re-call this on subsequent
     * value updates — only on a fresh restore.
     */
    onRestore?: (draft: string) => void;
    /** Override the autosave debounce (ms). Defaults to 500ms. */
    debounceMs?: number;
    /** Override the storage namespace prefix. Defaults to `social-draft:`. */
    storageNamespace?: string;
}

export interface UseDraftReturn {
    /**
     * True between a successful restore and the next time `clearDraft()` is
     * called explicitly OR the user submits / clears the composer. The flag
     * powers the optional "Восстановлен черновик" hint banner above the
     * composer; it is otherwise advisory.
     */
    hasDraft: boolean;
    /**
     * Manually clear the stored draft. Components call this after a
     * successful send / submit so the next mount does not resurrect the
     * just-sent text.
     */
    clearDraft: () => void;
}

/**
 * React hook that wires a single composer's value into localStorage. The
 * caller owns the composer state — this hook is a side-effect layer.
 */
export function useDraft(opts: UseDraftOpts): UseDraftReturn {
    const {
        key,
        value,
        onRestore,
        debounceMs = DEFAULT_DRAFT_DEBOUNCE_MS,
        storageNamespace = DEFAULT_DRAFT_NAMESPACE,
    } = opts;

    // `hasDraft` tracks whether the current mount started from a restored
    // value. It flips to false once the composer is cleared (e.g. after send)
    // so the dismissable hint banner disappears at the right moment.
    const [hasDraft, setHasDraft] = useState<boolean>(false);

    // Keep the latest `onRestore` reference in a ref so the restore effect
    // does not depend on a callback identity that changes every render.
    const onRestoreRef = useRef<UseDraftOpts['onRestore']>(onRestore);
    useEffect(() => {
        onRestoreRef.current = onRestore;
    }, [onRestore]);

    // Restoration effect — fires once per key change. We deliberately do NOT
    // re-restore on namespace changes because changing the namespace
    // mid-mount would be a bizarre API misuse; if a caller really needs to
    // switch namespaces they should remount the consumer.
    useEffect(() => {
        if (!key) {
            setHasDraft(false);
            return;
        }
        const restored = readDraft(key, storageNamespace);
        if (restored && restored.length > 0) {
            setHasDraft(true);
            // Call after the current microtask so the consumer's setState in
            // `onRestore` does not interleave with our own setHasDraft above.
            onRestoreRef.current?.(restored);
        } else {
            setHasDraft(false);
        }
    // We do NOT include `storageNamespace` in deps — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    // Autosave effect — debounced write whenever `value` changes. An empty
    // value triggers `clearDraft` (writeDraft handles that branch
    // internally) and also flips `hasDraft` to false so the hint hides.
    const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!key) return;
        if (writeTimer.current !== null) {
            clearTimeout(writeTimer.current);
            writeTimer.current = null;
        }
        const trimmed = value ? value.trim() : '';
        if (trimmed.length === 0) {
            // Empty composer — drop the draft immediately (no debounce) so
            // closing+reopening does not flash a stale hint. We still bypass
            // `clearDraft` to avoid an extra storage round-trip if there was
            // never a draft to begin with.
            if (hasDraft) setHasDraft(false);
            writeDraft(key, '', storageNamespace); // delegates to clearDraft
            return;
        }
        writeTimer.current = setTimeout(() => {
            writeTimer.current = null;
            writeDraft(key, value, storageNamespace);
        }, debounceMs);
        return () => {
            if (writeTimer.current !== null) {
                clearTimeout(writeTimer.current);
                writeTimer.current = null;
            }
        };
    }, [key, value, debounceMs, storageNamespace, hasDraft]);

    const clearDraftCallback = useCallback(() => {
        if (!key) return;
        clearDraft(key, storageNamespace);
        setHasDraft(false);
    }, [key, storageNamespace]);

    return { hasDraft, clearDraft: clearDraftCallback };
}
