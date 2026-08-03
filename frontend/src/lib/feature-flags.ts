/**
 * Lightweight user-opt-in feature flag store backed by localStorage.
 *
 * Flags are stored under the `featureFlag:<name>` key with the literal string
 * value `'1'` (enabled) or absent (disabled). This keeps reads cheap and
 * synchronous so SSR / non-browser environments fall back to `false` without
 * needing a provider.
 *
 * Phase 2 of the social-store migration uses `socialFeedBeta` to gate the
 * group-feed read path on `/api/v3/social/*`. Once the cutover is complete the
 * flag (and this helper) will be removed.
 */
'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_PREFIX = 'featureFlag:';

export type FeatureFlagName = 'socialFeedBeta';

function storageKey(name: FeatureFlagName): string {
    return `${STORAGE_PREFIX}${name}`;
}

/**
 * Returns the current value synchronously. Safe on SSR — when `window` is
 * undefined the flag is treated as disabled.
 */
export function readFeatureFlag(name: FeatureFlagName): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(storageKey(name)) === '1';
    } catch {
        return false;
    }
}

export function writeFeatureFlag(name: FeatureFlagName, value: boolean): void {
    if (typeof window === 'undefined') return;
    try {
        if (value) {
            window.localStorage.setItem(storageKey(name), '1');
        } else {
            window.localStorage.removeItem(storageKey(name));
        }
        // Broadcast within the same tab so listening components rerender. The
        // built-in `storage` event only fires across tabs, so we add a custom
        // one for in-tab consumers (the toggle UI itself + any open hook).
        window.dispatchEvent(new CustomEvent('featureflagchange', { detail: { name, value } }));
    } catch {
        // ignore — localStorage may be disabled (private mode, etc.)
    }
}

/**
 * React subscription hook. Implemented on top of `useSyncExternalStore` so the
 * browser value is read during the initial render (no setState-in-effect) and
 * hydration stays consistent — the server snapshot is always `false`, and the
 * client snapshot reads `localStorage` synchronously after hydration completes.
 */
export function useFeatureFlag(name: FeatureFlagName): boolean {
    return useSyncExternalStore<boolean>(
        (notify) => {
            const onChange = (event: Event) => {
                const detail = (event as CustomEvent<{ name?: FeatureFlagName }>).detail;
                // Same-tab events carry a `detail.name`. Cross-tab `storage`
                // events do not — fall through to a recheck in either case.
                if (detail && detail.name && detail.name !== name) return;
                notify();
            };
            window.addEventListener('featureflagchange', onChange);
            window.addEventListener('storage', onChange);
            return () => {
                window.removeEventListener('featureflagchange', onChange);
                window.removeEventListener('storage', onChange);
            };
        },
        () => readFeatureFlag(name),
        () => false,
    );
}
