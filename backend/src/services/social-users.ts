/**
 * Social user-hint search — backs the @mention autocomplete dropdown in the
 * social composers (FeedTab, CommentsThread, DialogsPanel, GlobalPanel).
 *
 * Scope semantics:
 *   - `group:<key>`        — restricted to active members of that group
 *   - `dm:<roomId>`        — the peer on the other side of the direct room
 *                            (must be a `direct:<low>::<high>` room id)
 *   - `global:chat`        — recent global chat participants (last N distinct
 *                            authors by recency). This is the only scope that
 *                            opens a soft global directory; access is bounded
 *                            implicitly because only people who already posted
 *                            in the global chat are exposed.
 *   - everything else      — returns [] (we deliberately do NOT expose a
 *                            true global directory; opt-in scopes only)
 *
 * Search rules:
 *   - empty query → []
 *   - case-insensitive PARTIAL match on `userId` and `displayName`
 *   - exact userId match → score 100
 *   - prefix match (userId/displayName starts with q) → score 50
 *   - substring match → score 10
 *   - higher score sorts first; ties broken by alphabetical userId
 *   - limit defaults to 10, capped at 25
 *
 * The viewer is always excluded from the result list — @-mentioning yourself
 * is not useful for notifications.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertCanReadGroup, normalizeGroupKey } from './group-space.js';
import { parseDirectRoomId } from './messaging.js';

export interface SocialUserHint {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
}

export const SOCIAL_USER_SEARCH_DEFAULT_LIMIT = 10;
export const SOCIAL_USER_SEARCH_MAX_LIMIT = 25;

/**
 * Pure helper — score a candidate against a (lowercased) query. Exported for
 * unit tests.
 *
 *   - returns 0 if neither userId nor displayName contains q
 *   - exact match on userId scores 100
 *   - exact match on displayName scores 90
 *   - prefix on userId scores 50, prefix on displayName scores 45
 *   - substring on userId scores 15, substring on displayName scores 10
 */
export function scoreSocialUserHint(
    candidate: { userId: string; displayName?: string | null },
    query: string,
): number {
    const q = query.toLowerCase();
    if (!q) return 0;
    const userId = candidate.userId.toLowerCase();
    const display = (candidate.displayName ?? '').toLowerCase();

    if (userId === q) return 100;
    if (display && display === q) return 90;
    if (userId.startsWith(q)) return 50;
    if (display && display.startsWith(q)) return 45;
    if (userId.includes(q)) return 15;
    if (display && display.includes(q)) return 10;
    return 0;
}

/**
 * Pure helper — given an unsanitized scope string (e.g. `"group:ITS-21"` or
 * `"dm:direct:alice::bob"`), split it into `{ scopeType, rawId }`. Returns
 * `null` when the scope is malformed or has an unsupported prefix.
 *
 * Exported for unit tests.
 */
export function parseSocialUserScope(
    scope: string,
): { scopeType: 'group' | 'dm' | 'global'; rawId: string } | null {
    if (typeof scope !== 'string') return null;
    const trimmed = scope.trim();
    if (!trimmed) return null;
    const sep = trimmed.indexOf(':');
    if (sep <= 0 || sep === trimmed.length - 1) return null;
    const type = trimmed.slice(0, sep);
    const rawId = trimmed.slice(sep + 1).trim();
    if (!rawId) return null;
    if (type === 'group') return { scopeType: 'group', rawId };
    if (type === 'dm') return { scopeType: 'dm', rawId };
    // The only valid `global:` scope today is `global:chat` — anything else
    // (e.g. `global:foo`) is rejected so we never accidentally open a true
    // global directory through a typo.
    if (type === 'global' && rawId === 'chat') return { scopeType: 'global', rawId };
    return null;
}

/**
 * Clamp a limit value to the configured bounds.
 *
 * Exported for unit tests.
 */
export function clampSocialUserSearchLimit(input: unknown): number {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
        return SOCIAL_USER_SEARCH_DEFAULT_LIMIT;
    }
    const rounded = Math.floor(input);
    if (rounded < 1) return 1;
    if (rounded > SOCIAL_USER_SEARCH_MAX_LIMIT) return SOCIAL_USER_SEARCH_MAX_LIMIT;
    return rounded;
}

async function requireSocialUsersPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialUsers] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

type CandidateRow = {
    user_id: string;
    display_name: string | null;
};

/**
 * Rank + truncate a candidate list against a query. Pure — exported for tests.
 */
export function rankSocialUserCandidates(
    candidates: ReadonlyArray<{ userId: string; displayName?: string | null }>,
    query: string,
    limit: number,
): SocialUserHint[] {
    const scored: Array<{ hint: SocialUserHint; score: number }> = [];
    for (const c of candidates) {
        const score = scoreSocialUserHint(c, query);
        if (score <= 0) continue;
        const hint: SocialUserHint = { userId: c.userId };
        if (c.displayName) hint.displayName = c.displayName;
        scored.push({ hint, score });
    }
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.hint.userId.localeCompare(b.hint.userId);
    });
    return scored.slice(0, limit).map((entry) => entry.hint);
}

/**
 * Resolve group members → list of `{ userId, displayName }` candidates.
 * Caller must have already passed an access check.
 */
async function loadGroupCandidates(
    client: PoolClient,
    groupKey: string,
): Promise<CandidateRow[]> {
    const normalized = normalizeGroupKey(groupKey);
    const result = await client.query<CandidateRow>(
        `
            select
                m.user_id,
                coalesce(
                    nullif(u.settings_json->>'leaderboardDisplayName', ''),
                    nullif(s.snapshot_json->>'fullName', ''),
                    nullif(s.snapshot_json#>>'{profileSummary,fullName}', '')
                ) as display_name
            from app_group_memberships m
            left join app_users u on u.user_id = m.user_id
            left join app_admin_user_snapshots s on s.user_id = m.user_id
            where m.group_key = $1 and m.active = true
        `,
        [normalized],
    );
    return result.rows;
}

/**
 * Resolve DM peer → single-element candidate list. The viewer must be one of
 * the two participants of the parsed `direct:` room; otherwise we return [].
 */
async function loadDmPeerCandidates(
    client: PoolClient,
    rawRoomId: string,
    viewerUserId: string,
): Promise<CandidateRow[]> {
    const direct = parseDirectRoomId(rawRoomId);
    if (!direct) return [];
    if (viewerUserId !== direct.low && viewerUserId !== direct.high) return [];
    const peerUserId = viewerUserId === direct.low ? direct.high : direct.low;
    const result = await client.query<CandidateRow>(
        `
            select
                u.user_id,
                coalesce(
                    nullif(u.settings_json->>'leaderboardDisplayName', ''),
                    nullif(s.snapshot_json->>'fullName', ''),
                    nullif(s.snapshot_json#>>'{profileSummary,fullName}', '')
                ) as display_name
            from app_users u
            left join app_admin_user_snapshots s on s.user_id = u.user_id
            where u.user_id = $1
            limit 1
        `,
        [peerUserId],
    );
    return result.rows;
}

/**
 * Resolve recent global-chat participants → candidate list. Pulls distinct
 * `author_user_id` rows from `app_social_entity` filtered to the global chat
 * scope and ordered by their most recent activity (latest message wins).
 *
 * We pull a wider pool (100) than the dropdown shows so the ranking step has
 * room to score / sort by query match. The recency ordering is only used to
 * decide who makes the pool when there are more than 100 distinct authors —
 * once inside the pool, `rankSocialUserCandidates` re-orders by query score.
 *
 * Soft-deleted entities (`deleted_at IS NOT NULL`) are excluded so banned /
 * removed participants don't keep showing up as suggestions.
 */
async function loadGlobalChatCandidates(
    client: PoolClient,
): Promise<CandidateRow[]> {
    const result = await client.query<CandidateRow>(
        `
            select
                e.author_user_id as user_id,
                coalesce(
                    nullif(u.settings_json->>'leaderboardDisplayName', ''),
                    nullif(s.snapshot_json->>'fullName', ''),
                    nullif(s.snapshot_json#>>'{profileSummary,fullName}', '')
                ) as display_name
            from (
                select author_user_id, max(created_at) as last_activity
                from app_social_entity
                where scope_type = 'global'
                  and scope_id = 'chat'
                  and kind = 'global_message'
                  and deleted_at is null
                group by author_user_id
                order by max(created_at) desc
                limit 100
            ) e
            left join app_users u on u.user_id = e.author_user_id
            left join app_admin_user_snapshots s on s.user_id = e.author_user_id
            order by e.last_activity desc
        `,
    );
    return result.rows;
}

/**
 * Public entry point: search for @mention candidates within a scope.
 *
 * Returns `[]` (never throws on unknown scope / forbidden access) so the UI
 * can render the dropdown without distinguishing between "no match" and
 * "forbidden". The viewer is always filtered out of the result list.
 */
export async function searchSocialUsers(
    scope: string,
    query: string,
    viewerUserId: string,
    limit?: number,
): Promise<SocialUserHint[]> {
    const trimmedViewer = (viewerUserId ?? '').trim();
    if (!trimmedViewer) return [];
    const normalizedQuery = (typeof query === 'string' ? query : '').trim();
    if (!normalizedQuery) return [];
    const parsed = parseSocialUserScope(scope);
    if (!parsed) return [];
    const cappedLimit = clampSocialUserSearchLimit(limit);

    if (parsed.scopeType === 'group') {
        try {
            await assertCanReadGroup(trimmedViewer, parsed.rawId);
        } catch {
            return [];
        }
        const rows = await requireSocialUsersPostgres('searchSocialUsers:group', (client) =>
            loadGroupCandidates(client, parsed.rawId),
        );
        const candidates = rows
            .filter((row) => row.user_id !== trimmedViewer)
            .map<{ userId: string; displayName?: string | null }>((row) => ({
                userId: row.user_id,
                displayName: row.display_name,
            }));
        return rankSocialUserCandidates(candidates, normalizedQuery, cappedLimit);
    }

    if (parsed.scopeType === 'dm') {
        const rows = await requireSocialUsersPostgres('searchSocialUsers:dm', (client) =>
            loadDmPeerCandidates(client, parsed.rawId, trimmedViewer),
        );
        const candidates = rows.map<{ userId: string; displayName?: string | null }>((row) => ({
            userId: row.user_id,
            displayName: row.display_name,
        }));
        return rankSocialUserCandidates(candidates, normalizedQuery, cappedLimit);
    }

    if (parsed.scopeType === 'global') {
        // No additional access check — anyone authenticated can read the
        // global chat (the legacy endpoint already permits it) and we only
        // expose people who already posted there. The viewer is excluded
        // below so self-mention is filtered out as elsewhere.
        const rows = await requireSocialUsersPostgres('searchSocialUsers:global', (client) =>
            loadGlobalChatCandidates(client),
        );
        const candidates = rows
            .filter((row) => row.user_id !== trimmedViewer)
            .map<{ userId: string; displayName?: string | null }>((row) => ({
                userId: row.user_id,
                displayName: row.display_name,
            }));
        return rankSocialUserCandidates(candidates, normalizedQuery, cappedLimit);
    }

    return [];
}
