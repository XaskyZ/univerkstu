/**
 * Adapter from `SocialEntityView` (universal social store) → a poll-shaped
 * view consumed by `PollCard` and the poll feed surfaces.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the feed reads
 * `kind=poll` entities from `/api/v3/social/scope/group/group:<key>/entities`
 * and renders them via `PollCard`. The adapter:
 *  - strips the `group:` prefix to recover the bare group key
 *  - normalizes `payload.options` into UI-friendly rows with derived
 *    `voteCount` + `voters`
 *  - derives `myVote` from `payload.votes` against the viewer id
 *  - surfaces `closedAt` + `pinned` so the card can render read-only / pinned
 *  - re-shapes reactions into the legacy `{ items, mine }` envelope
 *
 * Pure function — no React, no fetch. Used by both `PollCard` (via the feed)
 * and the unit tests directly.
 */
import type { SocialEntityView } from '@/lib/api/social';

const SCOPE_PREFIX = 'group:';

function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readOptionalIsoString(payload: Record<string, unknown>, key: string): string | null {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function stripGroupPrefix(scopeId: string): string {
    return scopeId.startsWith(SCOPE_PREFIX) ? scopeId.slice(SCOPE_PREFIX.length) : scopeId;
}

/**
 * One row in the rendered options list. The adapter does the per-row math
 * (voter list, count) so the card can render the bar without re-computing.
 */
export interface PollOptionView {
    id: string;
    label: string;
    voteCount: number;
    /** Sorted user-id list — order is preserved as stored on the payload. */
    voters: string[];
}

/**
 * Shape returned by `socialEntityToPollView`. Intentionally narrow — it
 * carries only the fields the UI actually reads. `reactions` mirrors the
 * legacy post envelope so the existing `ReactionsBar` works unchanged.
 */
export interface PollAdapterShape {
    id: string;
    groupKey: string;
    question: string;
    options: PollOptionView[];
    /**
     * Viewer's currently-selected option id, or `null` if they haven't voted.
     * For multi-choice polls this is the *first* option in payload order;
     * `myVotes` (plural) carries the complete set.
     */
    myVote: string | null;
    /**
     * Every option the viewer has voted for. Always an array — length-1 for
     * single-choice polls, 0..N for multi-choice. Clients that render multi-
     * choice should drive UI off this field.
     */
    myVotes: string[];
    /**
     * `true` when the poll accepts multiple selections per viewer. Drives
     * the checkbox vs. radio rendering in `PollCard` and the vote handler's
     * toggle behavior. Defaults to `false` for legacy / unset payloads.
     */
    multiChoice: boolean;
    /** Sum of every option's voter count. */
    totalVotes: number;
    /** ISO timestamp when the poll was closed; `null` while still accepting votes. */
    closedAt: string | null;
    authorUserId: string;
    createdAt: string;
    updatedAt: string;
    pinned: boolean;
    deletedAt: string | null;
    deletedBy: string | null;
    reactions: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

/**
 * Adapt a `SocialEntityView` of kind=poll into a `PollAdapterShape`. Robust
 * against:
 *  - missing `options` array (returns `[]`)
 *  - malformed option entries (skipped — `id` and `label` must be strings)
 *  - missing `votes` map (every option gets `voteCount: 0`)
 *  - votes referring to unknown options (counted in `totalVotes` only via the
 *    options that DO match; unknown buckets are ignored — defensive against a
 *    payload that has been edited to drop an option without cleaning votes)
 *
 * `viewerUserId` is required to compute `myVote`. Pass `''` for anonymous
 * surfaces — `myVote` resolves to `null`.
 */
export function socialEntityToPollView(
    view: SocialEntityView,
    viewerUserId: string,
): PollAdapterShape {
    const entity = view.entity;
    const payload = (entity.payload || {}) as Record<string, unknown>;
    const rawOptions = Array.isArray(payload.options) ? payload.options : [];
    const rawVotes = (payload.votes && typeof payload.votes === 'object')
        ? (payload.votes as Record<string, unknown>)
        : {};

    const options: PollOptionView[] = [];
    let myVote: string | null = null;
    const myVotes: string[] = [];
    let totalVotes = 0;

    for (const raw of rawOptions) {
        if (!raw || typeof raw !== 'object') continue;
        const optObj = raw as Record<string, unknown>;
        const id = typeof optObj.id === 'string' ? optObj.id : null;
        const label = typeof optObj.label === 'string' ? optObj.label : null;
        if (!id || label === null) continue;
        const voters: string[] = Array.isArray(rawVotes[id])
            ? (rawVotes[id] as unknown[]).filter((u): u is string => typeof u === 'string')
            : [];
        if (viewerUserId && voters.includes(viewerUserId)) {
            if (myVote === null) myVote = id;
            myVotes.push(id);
        }
        totalVotes += voters.length;
        options.push({
            id,
            label,
            voteCount: voters.length,
            voters,
        });
    }

    const multiChoice = payload.multiChoice === true;

    return {
        id: entity.id,
        groupKey: stripGroupPrefix(entity.scopeId),
        question: readString(payload, 'question'),
        options,
        myVote,
        myVotes,
        multiChoice,
        totalVotes,
        closedAt: readOptionalIsoString(payload, 'closedAt'),
        authorUserId: entity.authorUserId,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        pinned: entity.pinned,
        deletedAt: entity.deletedAt,
        deletedBy: entity.deletedByUserId,
        reactions: {
            items: view.reactions.map((aggregate) => ({
                emoji: aggregate.emoji,
                count: aggregate.count,
            })),
            mine: [...view.myReactions],
        },
    };
}
