'use client';

import { useEffect, useState } from 'react';
import { getLinkPreview, type LinkPreview } from '@/lib/api/social';

/**
 * Rich link preview ("unfurl") card.
 *
 * Renders under the body of a post / task / lesson / message when its text
 * contains an http(s) URL. The host fetches Open Graph metadata once on mount
 * (debounced via the URL string itself — re-mounting with the same URL hits
 * the in-flight cache; the backend has a separate persistent 7-day cache).
 *
 * Empty/loading/error states are intentionally minimal so the card never
 * dominates the message layout. When the backend returns `status !== 'ok'` or
 * no metadata at all, the component renders nothing and we leave the raw URL
 * in the body text as the fallback affordance.
 */
type FetchState =
    | { kind: 'loading'; url: string }
    | { kind: 'ready'; url: string; preview: LinkPreview }
    | { kind: 'error'; url: string };

export default function LinkPreviewCard({ url }: { url: string }) {
    // Single combined state tagged by URL so a prop change instantly switches
    // the rendered state to 'loading' for the new URL without setState-in-effect.
    const [state, setState] = useState<FetchState>(() => ({ kind: 'loading', url }));

    // If the URL prop changes between renders, derive the next loading state
    // from the prop directly (mid-render derivation is the recommended replacement
    // for setState-in-effect when the new state can be computed from props).
    let renderState = state;
    if (state.url !== url) {
        renderState = { kind: 'loading', url };
    }

    useEffect(() => {
        let cancelled = false;
        getLinkPreview(url)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data?.preview) {
                    setState({ kind: 'ready', url, preview: res.data.preview });
                } else {
                    setState({ kind: 'error', url });
                }
            })
            .catch(() => {
                if (cancelled) return;
                setState({ kind: 'error', url });
            });

        return () => {
            cancelled = true;
        };
    }, [url]);

    if (renderState.kind === 'error') return null;
    if (renderState.kind === 'loading') {
        // Compact skeleton so the layout doesn't jump once metadata arrives.
        // Single muted bar — no aggressive shimmer, the existing app shell
        // already animates pulsing skeletons via .skeleton when needed.
        return (
            <div
                className="rounded-2xl p-3 mt-2 text-xs"
                style={{
                    border: '1px solid var(--border)',
                    background: 'var(--surface-overlay-2)',
                    color: 'var(--muted)',
                    opacity: 0.75,
                }}
            >
                <span>{url}</span>
            </div>
        );
    }
    const preview = renderState.preview;
    if (preview.status !== 'ok') return null;

    const hasAnyText = Boolean(preview.title || preview.description || preview.siteName);
    if (!hasAnyText && !preview.imageUrl) return null;

    // Best-effort hostname extraction for the meta line (siteName is the
    // primary source; hostname is the fallback for pages that don't ship
    // og:site_name).
    let hostname = '';
    try {
        hostname = new URL(preview.url).hostname;
    } catch {
        hostname = '';
    }

    return (
        <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl mt-2 overflow-hidden no-underline"
            style={{
                border: '1px solid var(--border)',
                background: 'var(--surface-overlay-2)',
                color: 'var(--text)',
            }}
            data-testid="link-preview-card"
        >
            {preview.imageUrl ? (
                <div
                    style={{
                        width: '100%',
                        maxHeight: 200,
                        overflow: 'hidden',
                        background: 'var(--surface-overlay-1)',
                    }}
                >
                    {/* Using a plain <img> on purpose — the URL is arbitrary
                        and not pre-known at build time, so Next/Image's
                        remote-host whitelist would need every preview source
                        added. Width:100% + maxHeight clip keeps the layout
                        sane regardless of source dimensions. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={preview.imageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                        }}
                        onError={(e) => {
                            // Hide a broken image silently so the card collapses
                            // to its text-only variant.
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </div>
            ) : null}
            <div className="p-3 space-y-1">
                {preview.title ? (
                    <div
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text)', lineHeight: 1.3 }}
                    >
                        {preview.title}
                    </div>
                ) : null}
                {preview.description ? (
                    <div
                        className="text-xs"
                        style={{
                            color: 'var(--muted)',
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        }}
                    >
                        {preview.description}
                    </div>
                ) : null}
                {preview.siteName || hostname ? (
                    <div
                        className="text-xs"
                        style={{ color: 'var(--muted)', opacity: 0.75 }}
                    >
                        {preview.siteName || hostname}
                    </div>
                ) : null}
            </div>
        </a>
    );
}
