/**
 * Adapter from `SocialEntityView` (universal social store) → a task-shaped
 * view consumed by `TasksTab` and `TaskCard`.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the group tasks list
 * is read from `/api/v3/social/scope/group/group:<key>/entities?kind=task`
 * instead of `/api/v3/group/tasks`. The adapter keeps the existing UI
 * components — including `TaskCard`'s props contract — unchanged.
 *
 * Mapping rules (mirror the Phase 1c shim in
 * `backend/src/services/group-tasks-shim.ts`):
 *  - `scopeId` is `group:<groupKey>`; we strip the `group:` prefix to recover
 *    the bare group key.
 *  - `payload` for a `task` entity is `{ title, body, dueAt?,
 *    completedByUserIds? }`. Body and dueAt are coerced to safe defaults when
 *    missing.
 *  - **Completion semantics**: the Phase 1c shim deliberately skipped mirroring
 *    per-user completion into the universal store (the legacy schema is a
 *    single boolean keyed on the row, not a per-user set — see notes in
 *    `group-tasks-shim.ts`). Phase 2 introduces the
 *    `payload.completedByUserIds` array. The adapter has no access to the
 *    current viewer id, so it can only answer "has anyone marked this done?"
 *    The boolean `completed` is therefore true when the array is non-empty.
 *    Per-user truth has to come from the consumer (e.g. TasksTab) by
 *    comparing the array against the viewer's id.
 *  - `completedAt` / `completedBy` are surfaced from the first entry in the
 *    array purely so legacy-shaped UI doesn't break — they are best-effort,
 *    not authoritative. There is no separate timestamp per user in Phase 1.
 *  - Reactions are aggregated server-side and arrive as
 *    `{ reactions: [{emoji,count}], myReactions: string[] }`; we re-shape
 *    them into the `{ items, mine }` envelope that legacy task UI expects.
 *  - Soft-delete fields (`deletedAt`) survive.
 *
 * Pure function — no React, no fetch. Used by the hook AND by tests directly.
 */
import type { SocialEntityView } from '@/lib/api/social';

const SCOPE_PREFIX = 'group:';

function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value ? value : undefined;
}

function readCompletedBy(payload: Record<string, unknown>): string[] {
    const value = payload['completedByUserIds'];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

function stripGroupPrefix(scopeId: string): string {
    return scopeId.startsWith(SCOPE_PREFIX) ? scopeId.slice(SCOPE_PREFIX.length) : scopeId;
}

/**
 * Task-shaped view returned by the adapter. Intentionally lightweight —
 * mirrors the **subset** of `GroupTaskView` that `TaskCard` actually reads,
 * plus the raw `completedByUserIds` array so consumers that know the current
 * viewer can derive per-user truth.
 *
 * We do NOT extend `GroupTaskView` directly because the legacy view carries
 * fields the universal store doesn't track yet (subject, description,
 * priority — those live in the legacy table only until Phase 2 promotes them
 * into payload).
 */
export interface GroupTaskAdapterShape {
    id: string;
    groupKey: string;
    title: string;
    body: string;
    dueAt?: string;
    /**
     * True when at least one user has marked this task done. See header docs:
     * per-user truth must be derived by the caller from `completedByUserIds`.
     */
    completed: boolean;
    /** Best-effort timestamp surfaced from the entity row for UI parity. */
    completedAt?: string;
    /** First entry in `completedByUserIds`, surfaced for legacy-shaped UI. */
    completedBy?: string;
    /** Raw list so callers can derive per-user state when they know the viewer id. */
    completedByUserIds: string[];
    authorUserId: string;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    deletedBy: string | null;
    reactions: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

export function socialEntityToTaskView(view: SocialEntityView): GroupTaskAdapterShape {
    const entity = view.entity;
    const payload = entity.payload || {};
    const completedByUserIds = readCompletedBy(payload);
    const completedAt = readOptionalString(payload, 'completedAt');
    return {
        id: entity.id,
        groupKey: stripGroupPrefix(entity.scopeId),
        title: readString(payload, 'title'),
        body: readString(payload, 'body'),
        dueAt: readOptionalString(payload, 'dueAt'),
        completed: completedByUserIds.length > 0,
        completedAt: completedAt,
        completedBy: completedByUserIds.length > 0 ? completedByUserIds[0] : undefined,
        completedByUserIds,
        authorUserId: entity.authorUserId,
        pinned: entity.pinned,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
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
