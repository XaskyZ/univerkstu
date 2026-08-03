import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import {
    createExtraLessonUnified,
    deleteExtraLessonUnified,
    permanentlyDeleteExtraLessonUnified,
    restoreExtraLessonUnified,
    splitIsoToDateAndTime,
    toggleExtraLessonReactionUnified,
    updateExtraLessonUnified,
    type SocialExtraLessonActionDeps,
} from './social-extra-lesson-actions';

// Unit tests for the unified extra-lesson write-path wrappers. Each test
// injects fakes via the `deps` argument (matching the convention in
// `social-feed-actions.test.ts` / `social-task-actions.test.ts`). No
// `vi.mock` ESM intercepts; the wrappers expose every API binding as an
// explicit dep so fakes are first-class.

function ok<T>(data?: T): ApiResponse<T> {
    return { success: true, data: data as T };
}

describe('splitIsoToDateAndTime', () => {
    it('splits an ISO Z timestamp into UTC date + HH:MM time', () => {
        // The bridge from universal `startsAt` (ISO) to legacy `date` +
        // `startTime` is the riskiest part of legacy mode — verify the UTC
        // projection is deterministic.
        expect(splitIsoToDateAndTime('2026-03-15T09:30:00Z')).toEqual({
            date: '2026-03-15',
            time: '09:30',
        });
    });

    it('returns empty strings for undefined or empty input', () => {
        // Defensive: callers may omit `endsAt`; the projection must yield a
        // deterministic empty shape rather than throwing.
        expect(splitIsoToDateAndTime(undefined)).toEqual({ date: '', time: '' });
        expect(splitIsoToDateAndTime('')).toEqual({ date: '', time: '' });
    });

    it('returns empty strings for unparseable input', () => {
        // Defensive — Date parsing yields NaN for garbage input; the helper
        // must catch that instead of forwarding NaN-padded strings.
        expect(splitIsoToDateAndTime('not-a-date')).toEqual({ date: '', time: '' });
    });
});

describe('createExtraLessonUnified', () => {
    it('beta path: calls createSocialEntity with kind=extra_lesson and group-scoped scopeId', async () => {
        // Locks the shape passed into the universal store. A regression that
        // dropped `scopeType`/`scopeId` would silently land lessons in an
        // empty scope where the read path would never surface them.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-lesson-1' }));
        const deps: SocialExtraLessonActionDeps = { createSocialEntity };
        const result = await createExtraLessonUnified(
            'ITS-21',
            {
                subject: 'Calculus review',
                startsAt: '2026-03-15T09:00:00Z',
                endsAt: '2026-03-15T10:30:00Z',
                teacher: 'Prof. Ivanov',
                room: '305',
                note: 'Bring chapter 4 notes',
            },
            true,
            deps,
        );
        expect(result.success).toBe(true);
        expect(createSocialEntity).toHaveBeenCalledTimes(1);
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            payload: {
                subject: 'Calculus review',
                startsAt: '2026-03-15T09:00:00Z',
                endsAt: '2026-03-15T10:30:00Z',
                teacher: 'Prof. Ivanov',
                room: '305',
                note: 'Bring chapter 4 notes',
            },
        });
    });

    it('beta path: drops undefined / empty optional fields from the payload', async () => {
        // Explicit-undefined keys would serialize away in JSON, but pruning
        // is what the AJV validator relies on for forward-strict payloads.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-lesson-2' }));
        await createExtraLessonUnified(
            'CSE-22',
            { subject: 'Open Q&A', startsAt: '2026-03-20T15:00:00Z' },
            true,
            { createSocialEntity },
        );
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: 'group:CSE-22',
            payload: {
                subject: 'Open Q&A',
                startsAt: '2026-03-20T15:00:00Z',
            },
        });
    });

    it('legacy path: projects subject → title and ISO timestamps into date/startTime/endTime', async () => {
        // Verifies the legacy bridge: universal `subject` lands in the legacy
        // `title` column, and the ISO timestamps are split into date + HH:MM.
        const createGroupExtraLesson = vi.fn().mockResolvedValue(ok({ id: 'legacy-lesson-1' }));
        await createExtraLessonUnified(
            'ITS-21',
            {
                subject: 'L',
                startsAt: '2026-03-15T09:00:00Z',
                endsAt: '2026-03-15T10:30:00Z',
                room: '305',
                teacher: 'Prof. Ivanov',
                note: 'note',
            },
            false,
            { createGroupExtraLesson },
        );
        expect(createGroupExtraLesson).toHaveBeenCalledWith({
            groupKey: 'ITS-21',
            title: 'L',
            date: '2026-03-15',
            startTime: '09:00',
            endTime: '10:30',
            room: '305',
            teacher: 'Prof. Ivanov',
            note: 'note',
        });
    });
});

describe('updateExtraLessonUnified', () => {
    it('beta path: PATCHes only the provided payload fields', async () => {
        // The whole point of the social PATCH endpoint is partial updates —
        // verify we don't include other keys when the caller only asks to
        // change one.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updateExtraLessonUnified('e-1', { note: 'updated note' }, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-1', { payload: { note: 'updated note' } });
    });

    it('beta path: sends an empty patch when nothing was provided', async () => {
        // Defensive: the social PATCH endpoint accepts an empty patch as a
        // no-op. Make sure we don't accidentally inject a stale `payload: {}`
        // that would re-trigger validation against the schema.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updateExtraLessonUnified('e-2', {}, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-2', {});
    });

    it('beta path: forwards subject + startsAt + endsAt inside payload', async () => {
        // All three fields live under `payload` — assert they do not bubble
        // up to top-level patch keys (e.g. `pinned`).
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updateExtraLessonUnified(
            'e-3',
            { subject: 'New subject', startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T11:00:00Z' },
            true,
            { updateSocialEntity },
        );
        expect(updateSocialEntity).toHaveBeenCalledWith('e-3', {
            payload: {
                subject: 'New subject',
                startsAt: '2026-05-01T10:00:00Z',
                endsAt: '2026-05-01T11:00:00Z',
            },
        });
    });

    it('legacy path: forwards (lessonId, { title, date, startTime, endTime, room, teacher, note })', async () => {
        // Legacy schema requires title + date + start/end times — defaults to
        // empty strings so the request shape stays valid even when callers
        // omit them (they shouldn't).
        const updateGroupExtraLesson = vi.fn().mockResolvedValue(ok({ id: 'l' }));
        await updateExtraLessonUnified(
            'p-1',
            {
                subject: 'L2',
                startsAt: '2026-04-01T08:00:00Z',
                endsAt: '2026-04-01T09:00:00Z',
                room: '101',
                teacher: 'T',
                note: 'n',
            },
            false,
            { updateGroupExtraLesson },
        );
        expect(updateGroupExtraLesson).toHaveBeenCalledWith('p-1', {
            title: 'L2',
            date: '2026-04-01',
            startTime: '08:00',
            endTime: '09:00',
            room: '101',
            teacher: 'T',
            note: 'n',
        });
    });
});

describe('deleteExtraLessonUnified', () => {
    it('beta path: calls deleteSocialEntity with the reason string when provided', async () => {
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteExtraLessonUnified('e-4', 'duplicate', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-4', 'duplicate');
    });

    it('beta path: passes `undefined` reason through unchanged', async () => {
        // The social client treats undefined reason as "no querystring" —
        // make sure we don't accidentally coerce it to the literal string
        // 'undefined'.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteExtraLessonUnified('e-5', undefined, true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-5', undefined);
    });

    it('legacy path: ignores reason (the legacy endpoint has no reason param)', async () => {
        const deleteGroupExtraLesson = vi.fn().mockResolvedValue(ok({ deleted: true }));
        await deleteExtraLessonUnified('p-2', 'doesnt-matter', false, { deleteGroupExtraLesson });
        expect(deleteGroupExtraLesson).toHaveBeenCalledWith('p-2');
    });
});

describe('restoreExtraLessonUnified', () => {
    it('beta path: calls restoreSocialEntity with the entity id', async () => {
        const restoreSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await restoreExtraLessonUnified('e-6', true, { restoreSocialEntity });
        expect(restoreSocialEntity).toHaveBeenCalledWith('e-6');
    });

    it('legacy path: calls restoreDeletedGroupExtraLesson', async () => {
        const restoreDeletedGroupExtraLesson = vi.fn().mockResolvedValue(ok({ id: 'l' }));
        await restoreExtraLessonUnified('p-3', false, { restoreDeletedGroupExtraLesson });
        expect(restoreDeletedGroupExtraLesson).toHaveBeenCalledWith('p-3');
    });
});

describe('permanentlyDeleteExtraLessonUnified', () => {
    it('beta path: routes through deleteSocialEntity with reason=permanent', async () => {
        // Social store has no hard-delete primitive — assert we degrade
        // gracefully to a soft-delete with a discoverable reason.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await permanentlyDeleteExtraLessonUnified('e-7', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-7', 'permanent');
    });

    it('legacy path: routes through deleteGroupExtraLesson (legacy has no hard-delete either)', async () => {
        // `permanentlyDeleteGroupExtraLesson` does not exist in
        // `lib/api/group.ts` today; the legacy wrapper falls through to
        // soft-delete. Test pins that decision so a future contributor does
        // not accidentally swap in a non-existent function.
        const deleteGroupExtraLesson = vi.fn().mockResolvedValue(ok({ deleted: true }));
        await permanentlyDeleteExtraLessonUnified('p-4', false, { deleteGroupExtraLesson });
        expect(deleteGroupExtraLesson).toHaveBeenCalledWith('p-4');
    });
});

describe('toggleExtraLessonReactionUnified', () => {
    it('beta path: calls toggleSocialReaction with (lessonId, emoji)', async () => {
        const toggleSocialReaction = vi.fn().mockResolvedValue(ok({ added: true, reactions: [], mine: [] }));
        await toggleExtraLessonReactionUnified('e-8', '👍', true, 'ITS-21', { toggleSocialReaction });
        expect(toggleSocialReaction).toHaveBeenCalledWith('e-8', '👍');
    });

    it('legacy path: returns a non-success ApiResponse with LESSON_REACTION_LEGACY_UNSUPPORTED', async () => {
        // No `toggleGroupExtraLessonReaction` exists today; the wrapper
        // exposes the limitation via an error code instead of silently
        // no-opping.
        const result = await toggleExtraLessonReactionUnified('p-5', '🎉', false);
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('LESSON_REACTION_LEGACY_UNSUPPORTED');
        expect(typeof result.error).toBe('string');
    });
});
