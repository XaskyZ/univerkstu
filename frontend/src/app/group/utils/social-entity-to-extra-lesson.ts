/**
 * Adapter from `SocialEntityView` (universal social store) → an extra-lesson
 * shaped view consumed by `LessonsTab` and `LessonCard`.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the group extra
 * lessons list is read from
 * `/api/v3/social/scope/group/group:<key>/entities?kind=extra_lesson` instead
 * of `/api/v3/group/extra-lessons`. The adapter keeps the existing UI
 * components — including `LessonCard`'s props contract — unchanged.
 *
 * Mapping rules (mirror the Phase 1c shim in
 * `backend/src/services/group-extra-lessons-shim.ts`):
 *  - `scopeId` is `group:<groupKey>`; we strip the `group:` prefix to recover
 *    the bare group key.
 *  - `payload` for an `extra_lesson` entity is
 *    `{ subject, teacher?, room?, startsAt, endsAt?, note? }`.
 *  - `subject` is the canonical title field in the universal payload — the
 *    legacy `title` column was renamed to `subject` during Phase 1c. The
 *    adapter surfaces it as `subject` so the consumer can decide whether to
 *    bridge it back to a legacy `title` field for `LessonCard` rendering.
 *  - `startsAt` / `endsAt` are ISO timestamps (e.g. `2026-03-15T09:00:00Z`).
 *    The legacy table stored separate `date` + `startTime` / `endTime` pieces;
 *    the adapter does NOT split the ISO back apart here — it surfaces the raw
 *    strings and lets the consumer slice them when projecting to the legacy
 *    view (locale-aware date formatting lives in `LessonCard`).
 *  - Reactions are aggregated server-side and arrive as
 *    `{ reactions: [{emoji,count}], myReactions: string[] }`; we re-shape them
 *    into the `{ items, mine }` envelope that legacy lesson UI would expect.
 *    Lessons do not currently expose reactions in the legacy renderer, but the
 *    field is surfaced so any future UI can opt in without re-plumbing.
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

function stripGroupPrefix(scopeId: string): string {
    return scopeId.startsWith(SCOPE_PREFIX) ? scopeId.slice(SCOPE_PREFIX.length) : scopeId;
}

/**
 * Extra-lesson shaped view returned by the adapter. Intentionally lightweight —
 * mirrors the subset of fields the universal payload tracks today. Carries the
 * universal `subject` / `startsAt` / `endsAt` shape directly; downstream code
 * that needs the legacy `title` / `date` / `startTime` / `endTime` split is
 * responsible for projecting it (see `LessonsTab.adapterToLegacyLesson`).
 */
export interface GroupExtraLessonAdapterShape {
    id: string;
    groupKey: string;
    subject: string;
    teacher?: string;
    room?: string;
    /** ISO 8601 timestamp. */
    startsAt: string;
    /** ISO 8601 timestamp. Optional — open-ended lessons omit it. */
    endsAt?: string;
    note?: string;
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

export function socialEntityToExtraLessonView(view: SocialEntityView): GroupExtraLessonAdapterShape {
    const entity = view.entity;
    const payload = entity.payload || {};
    return {
        id: entity.id,
        groupKey: stripGroupPrefix(entity.scopeId),
        subject: readString(payload, 'subject'),
        teacher: readOptionalString(payload, 'teacher'),
        room: readOptionalString(payload, 'room'),
        startsAt: readString(payload, 'startsAt'),
        endsAt: readOptionalString(payload, 'endsAt'),
        note: readOptionalString(payload, 'note'),
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
