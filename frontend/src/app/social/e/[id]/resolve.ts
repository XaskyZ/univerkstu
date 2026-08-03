/**
 * Pure entity → destination URL resolver.
 *
 * Permalinks land on `/social/e/[id]`. Once the entity is loaded the page
 * needs to redirect to the right "host" surface (Group / Chat / etc.) with
 * a `focus=<entityId>` query so the destination can scroll-and-highlight
 * the matching card.
 *
 * Kept in its own module (no React imports, no `next/navigation` bindings)
 * so it can be unit-tested without DOM / Next runtime stubs. Importable
 * from the redirect page AND from any future server-side share previews.
 *
 * Behaviour table mirrors `SOCIAL_STORE.md` — every supported `kind` must
 * have a clear destination, and the helper falls back to a safe default
 * (`/`) when the kind/scope combo isn't recognised. The fallback is
 * intentional: a malformed entity should not produce a broken redirect
 * loop, but it also shouldn't pretend to know where to send the viewer.
 */

import type { SocialEntityKind, SocialScopeType } from '@/lib/api/social';

/**
 * Minimal entity shape required by the resolver. The full
 * `SocialEntity` from `api/social.ts` is a superset; we pick only the
 * fields that actually influence the destination URL so call-sites can
 * pass either a raw `SocialEntity` or a smaller shim object.
 */
export interface ResolvableEntity {
    id: string;
    kind: SocialEntityKind;
    scopeType: SocialScopeType;
    /**
     * Raw (post-`buildScopeId`) scope identifier. For group entities this is
     * just the group key (`ITS-21`), NOT the namespaced `group:ITS-21` —
     * see the table in `SOCIAL_STORE.md`. Callers should pass the entity's
     * `scopeId` field verbatim.
     */
    scopeId: string;
}

/**
 * Default destination when no other branch applies. Hard-coded so the
 * resolver never returns `null` or `undefined` — every call site can
 * assume a string.
 */
export const FALLBACK_DESTINATION = '/';

function buildQuery(params: Record<string, string>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (!value) continue;
        search.set(key, value);
    }
    const result = search.toString();
    return result ? `?${result}` : '';
}

/**
 * Resolve a single social entity to its in-app destination URL.
 *
 * Rules:
 *  - Group-scoped entities (`post`, `task`, `extra_lesson`, `poll`,
 *    `event`) land on `/group?groupKey=<scopeId>&focus=<id>`.
 *  - Announcements land on `/group?focus=<id>` (the same shell renders
 *    the announcement strip; no `groupKey` needed for the announcement-
 *    global scope).
 *  - Direct-message replies land on `/chat?roomId=<scopeId>&focus=<id>`.
 *  - Global chat messages land on `/chat?tab=global&focus=<id>`.
 *  - Unknown kinds / missing ids return `FALLBACK_DESTINATION`.
 *
 * The helper never throws — even on a malformed entity it returns a
 * safe string the router can navigate to.
 */
export function resolveEntityDestination(entity: ResolvableEntity | null | undefined): string {
    if (!entity) return FALLBACK_DESTINATION;
    if (typeof entity.id !== 'string' || entity.id.trim().length === 0) {
        return FALLBACK_DESTINATION;
    }
    const id = entity.id.trim();
    const scopeId = typeof entity.scopeId === 'string' ? entity.scopeId.trim() : '';

    switch (entity.kind) {
        case 'post':
        case 'task':
        case 'extra_lesson':
        case 'poll':
        case 'event': {
            // Group-scoped entities must come with a non-empty scope id.
            // A missing scope means the entity is mis-tagged — fall back
            // rather than producing a broken `/group?groupKey=&focus=X`.
            if (entity.scopeType !== 'group' || !scopeId) {
                return FALLBACK_DESTINATION;
            }
            return `/group${buildQuery({ groupKey: scopeId, focus: id })}`;
        }
        case 'announcement': {
            // Announcement scope is `announcement:global` — there is no
            // per-group fan-out we need to encode in the URL. The
            // destination is the same shell every starosta / curator /
            // coordinator already lands on; the focus query picks out the
            // right card.
            return `/group${buildQuery({ focus: id })}`;
        }
        case 'dm_message': {
            if (entity.scopeType !== 'dm' || !scopeId) {
                return FALLBACK_DESTINATION;
            }
            return `/chat${buildQuery({ roomId: scopeId, focus: id })}`;
        }
        case 'global_message': {
            // Global chat sits behind the `global` tab in the chat page;
            // we always set `tab=global` so a deep-link from a different
            // tab still lands the viewer on the right pane.
            return `/chat${buildQuery({ tab: 'global', focus: id })}`;
        }
        default:
            return FALLBACK_DESTINATION;
    }
}

/**
 * Build the `/social/e/<id>` permalink URL for an entity. Used by the
 * share button to compose the absolute or relative href without each
 * call-site re-implementing the encoding rules. Returns `null` when
 * `entityId` is missing/blank so callers can hide the share affordance
 * gracefully.
 */
export function buildEntityPermalinkPath(entityId: string | null | undefined): string | null {
    if (typeof entityId !== 'string') return null;
    const trimmed = entityId.trim();
    if (trimmed.length === 0) return null;
    return `/social/e/${encodeURIComponent(trimmed)}`;
}

/**
 * Build the login-bounce URL used when an unauthenticated viewer hits a
 * permalink. Encodes the return path so post-login we can route the
 * viewer back to the original `/social/e/<id>` and re-resolve.
 */
export function buildLoginReturnUrl(returnPath: string): string {
    if (typeof returnPath !== 'string' || returnPath.trim().length === 0) {
        return '/login';
    }
    return `/login?return=${encodeURIComponent(returnPath)}`;
}
