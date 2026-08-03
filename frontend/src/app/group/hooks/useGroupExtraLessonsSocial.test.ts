import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import type { SocialEntityView, ListSocialEntitiesOptions, SocialScopeType } from '@/lib/api/social';
import { loadGroupExtraLessonsSocial } from './useGroupExtraLessonsSocial';

// Module-isolated tests for the pure data-flow primitive that backs
// `useGroupExtraLessonsSocial`. The hook wraps this with React state — see
// CLAUDE.md "What not to test in unit tests: React hooks" — so we exercise
// the load logic directly with an injected fetcher.

type Fetcher = (
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListSocialEntitiesOptions,
) => Promise<ApiResponse<{ entities: SocialEntityView[] }>>;

function makeView(id: string, subject: string, startsAt: string): SocialEntityView {
    return {
        entity: {
            id,
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'u-1',
            payload: { subject, startsAt },
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
        },
        reactions: [],
        myReactions: [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('loadGroupExtraLessonsSocial', () => {
    it('builds the scopeId `group:<key>` and asks for kind=extra_lesson with pinnedFirst=false', async () => {
        // Locks the contract — extra lessons query the social store with
        // `pinnedFirst: false` (chronological, not feed-style) and a higher
        // `limit: 100`. A regression here would either re-introduce a curated
        // pinned section the lessons UI does not render, or silently truncate
        // the list.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        await loadGroupExtraLessonsSocial('ITS-21', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('group', 'group:ITS-21', {
            kind: 'extra_lesson',
            limit: 100,
            pinnedFirst: false,
        });
    });

    it('maps each returned entity through `socialEntityToExtraLessonView`', async () => {
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: {
                entities: [
                    makeView('a', 'Algebra review', '2026-03-15T09:00:00Z'),
                    makeView('b', 'Geometry consultation', '2026-03-16T14:00:00Z'),
                ],
            },
        });
        const result = await loadGroupExtraLessonsSocial('ITS-21', fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.lessons).toHaveLength(2);
        expect(result.lessons[0]).toMatchObject({
            id: 'a',
            subject: 'Algebra review',
            startsAt: '2026-03-15T09:00:00Z',
            groupKey: 'ITS-21',
        });
        expect(result.lessons[1]).toMatchObject({
            id: 'b',
            subject: 'Geometry consultation',
            startsAt: '2026-03-16T14:00:00Z',
            groupKey: 'ITS-21',
        });
    });

    it('sorts lessons by `startsAt` ASC (chronological) after mapping', async () => {
        // The social API does not expose a `sortBy` query param, so the hook
        // applies the chronological order client-side. Verify that lessons
        // arriving out of order are re-sorted before reaching the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: {
                entities: [
                    makeView('late', 'Late lesson', '2026-04-10T12:00:00Z'),
                    makeView('early', 'Early lesson', '2026-03-01T09:00:00Z'),
                    makeView('mid', 'Mid lesson', '2026-03-20T15:00:00Z'),
                ],
            },
        });
        const result = await loadGroupExtraLessonsSocial('ITS-21', fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.lessons.map((lesson) => lesson.id)).toEqual(['early', 'mid', 'late']);
    });

    it('returns an error result with the API message when the call fails', async () => {
        // Error mapping is critical — `LessonsTab` surfaces the raw string in
        // the UI under the legacy-style `lessonsState.error` field.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: false,
            error: 'Server unavailable',
            errorCode: 'NETWORK_ERROR',
        });
        const result = await loadGroupExtraLessonsSocial('ITS-21', fetcher);
        expect(result).toEqual({ ok: false, error: 'Server unavailable' });
    });

    it('falls back to a generic message when the API result omits `error`', async () => {
        // Defensive: a non-success ApiResponse without `error` should still
        // produce a user-visible string rather than `undefined`.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: false });
        const result = await loadGroupExtraLessonsSocial('ITS-21', fetcher);
        expect(result).toEqual({ ok: false, error: 'Failed to load lessons' });
    });

    it('returns an empty lesson array when the backend returns no entities', async () => {
        // Empty lesson list is not an error — explicit assertion so we never
        // accidentally rebrand "empty" as "failure" in the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        const result = await loadGroupExtraLessonsSocial('CSE-22', fetcher);
        expect(result).toEqual({ ok: true, lessons: [] });
    });
});
