'use client';

/**
 * Permalink resolver page for social entities.
 *
 * Route: `/social/e/[id]`
 *
 * The frontend has no SSR auth context, so the redirect happens on the
 * client. The flow is:
 *
 *   1. Wait for the `AuthProvider` to finish bootstrapping (`loading`).
 *   2. If the viewer is unauthenticated, bounce them to
 *      `/login?return=/social/e/<id>` — the login page can pick up the
 *      `return` query in a future iteration; for now the existing flow
 *      lands logged-in users on /schedule and they can paste / re-open
 *      the link.
 *   3. Otherwise `getSocialEntity(id)` to fetch metadata and run
 *      `resolveEntityDestination` to compute the in-app target URL.
 *   4. Replace the current history entry with the target so the back
 *      button skips this stub page.
 *   5. On any error (entity missing / network down) show a tiny
 *      `PageStateCard` so the user understands what happened.
 *
 * Implementation notes:
 *  - We use `router.replace`, not `router.push`, to avoid an entry in
 *    the back-stack. The permalink page is purely a routing relay.
 *  - We deliberately do NOT trigger any data fetch other than the
 *    `getSocialEntity` round-trip. The destination page owns its own
 *    data fetching; reading the entity here is only about computing
 *    where to send the viewer.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { getSocialEntity } from '@/lib/api';
import { buildLoginReturnUrl, resolveEntityDestination } from './resolve';

type ResolveState =
    | { kind: 'loading' }
    | { kind: 'redirecting' }
    | { kind: 'not-found' }
    | { kind: 'error'; message: string };

export default function SocialEntityPermalinkPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const { isAuth, loading: authLoading } = useAuth();
    const { messages } = useLanguage();

    // `params.id` is the dynamic [id] segment. Next.js URL-decodes it for us,
    // so we can pass it straight through to the API client which re-encodes
    // it inside the request URL.
    const rawId = typeof params?.id === 'string' ? params.id : '';
    const entityId = rawId.trim();

    const [state, setState] = useState<ResolveState>({ kind: 'loading' });

    // Bail out into the not-found render branch synchronously when the
    // segment is empty. Doing this here (instead of `setState` inside the
    // effect) keeps the lint rule happy — the effect should only react
    // to external systems, not derive its own state.
    const missingId = !authLoading && entityId.length === 0;

    useEffect(() => {
        // Don't resolve while auth is still booting — flashing through the
        // not-auth bounce on a returning visitor with a valid token would
        // be a poor UX.
        if (authLoading) return;
        if (!entityId) return;

        if (!isAuth) {
            // Unauthenticated viewers bounce through /login with a return
            // URL pointing back at this permalink. The login page will
            // pick it up in a follow-up; for now the redirect itself is
            // the load-bearing affordance (the URL stays bookmarkable).
            router.replace(buildLoginReturnUrl(`/social/e/${encodeURIComponent(entityId)}`));
            return;
        }

        let cancelled = false;

        (async () => {
            const result = await getSocialEntity(entityId);
            if (cancelled) return;
            if (!result.success || !result.data) {
                if (result.statusCode === 404) {
                    setState({ kind: 'not-found' });
                    return;
                }
                setState({
                    kind: 'error',
                    message: result.error || messages.share.permalinkError,
                });
                return;
            }
            const target = resolveEntityDestination(result.data.entity.entity);
            router.replace(target);
        })();

        return () => {
            cancelled = true;
        };
    }, [authLoading, entityId, isAuth, messages.share.permalinkError, router]);

    return (
        <PageShell>
            <PageMain className="space-y-4">
                {missingId ? (
                    <PageStateCard
                        message={messages.share.permalinkNotFound}
                        tone="danger"
                    />
                ) : state.kind === 'loading' || state.kind === 'redirecting' ? (
                    <PageStateCard message={messages.share.permalinkLoading} />
                ) : state.kind === 'not-found' ? (
                    <PageStateCard
                        message={messages.share.permalinkNotFound}
                        tone="danger"
                    />
                ) : state.kind === 'error' ? (
                    <PageStateCard message={state.message} tone="danger" />
                ) : null}
            </PageMain>
        </PageShell>
    );
}
