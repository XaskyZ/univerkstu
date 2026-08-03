import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import { socialEntityToExtraLessonView } from './social-entity-to-extra-lesson';

// Builds a minimal `SocialEntityView` (kind=extra_lesson) with sane defaults.
// Tests override only the fields they care about so each assertion focuses on
// the mapping rule under test.
function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    reactions?: SocialEntityView['reactions'];
    myReactions?: SocialEntityView['myReactions'];
    commentCount?: number;
    attachmentCount?: number;
    isPinned?: boolean;
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'lesson-1',
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'starosta-1',
            payload: {
                subject: 'Math review',
                startsAt: '2026-03-15T09:00:00Z',
            },
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: overrides.reactions ?? [],
        myReactions: overrides.myReactions ?? [],
        commentCount: overrides.commentCount ?? 0,
        attachmentCount: overrides.attachmentCount ?? 0,
        isPinned: overrides.isPinned ?? false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('socialEntityToExtraLessonView', () => {
    it('maps a fully-populated extra-lesson entity (subject, teacher, room, startsAt/endsAt, note)', () => {
        // Full happy-path mapping — every field LessonCard relies on is
        // populated from the universal entity. Locks the contract for the
        // beta read surface.
        const view = makeView({
            entity: {
                id: 'lesson-abc',
                authorUserId: 'curator-9',
                payload: {
                    subject: 'Calculus consultation',
                    teacher: 'Prof. Ivanov',
                    room: '305',
                    startsAt: '2026-03-15T09:00:00Z',
                    endsAt: '2026-03-15T10:30:00Z',
                    note: 'Bring chapter 4 notes',
                },
            },
        });
        const lesson = socialEntityToExtraLessonView(view);
        expect(lesson).toMatchObject({
            id: 'lesson-abc',
            groupKey: 'ITS-21',
            subject: 'Calculus consultation',
            teacher: 'Prof. Ivanov',
            room: '305',
            startsAt: '2026-03-15T09:00:00Z',
            endsAt: '2026-03-15T10:30:00Z',
            note: 'Bring chapter 4 notes',
            authorUserId: 'curator-9',
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedBy: null,
        });
    });

    it('leaves optional fields (teacher, room, endsAt, note) undefined when payload omits them', () => {
        // Open-ended lessons with no end time / no room are legitimate. The
        // adapter must NOT coerce missing optional fields to '' — the legacy
        // UI treats empty strings differently from `undefined`.
        const view = makeView({
            entity: {
                payload: {
                    subject: 'Free consultation',
                    startsAt: '2026-03-20T15:00:00Z',
                },
            },
        });
        const lesson = socialEntityToExtraLessonView(view);
        expect(lesson.teacher).toBeUndefined();
        expect(lesson.room).toBeUndefined();
        expect(lesson.endsAt).toBeUndefined();
        expect(lesson.note).toBeUndefined();
        expect(lesson.subject).toBe('Free consultation');
        expect(lesson.startsAt).toBe('2026-03-20T15:00:00Z');
    });

    it('strips the `group:` prefix from scopeId to recover the bare group key', () => {
        const view = makeView({ entity: { scopeId: 'group:CSE-22A' } });
        expect(socialEntityToExtraLessonView(view).groupKey).toBe('CSE-22A');
    });

    it('preserves `pinned` from the entity row', () => {
        // Pinned lessons are not a UX feature today, but the universal store
        // tracks the bit. Surfacing it keeps the adapter forward-compatible
        // with any UI that introduces pinning later.
        const view = makeView({ entity: { pinned: true } });
        expect(socialEntityToExtraLessonView(view).pinned).toBe(true);
    });

    it('preserves soft-delete fields (deletedAt + deletedByUserId → deletedBy)', () => {
        // Trash list reads on the universal entity rely on these fields.
        const view = makeView({
            entity: {
                deletedAt: '2026-02-15T10:00:00Z',
                deletedByUserId: 'moderator-9',
                deletedReason: 'duplicate',
            },
        });
        const lesson = socialEntityToExtraLessonView(view);
        expect(lesson.deletedAt).toBe('2026-02-15T10:00:00Z');
        expect(lesson.deletedBy).toBe('moderator-9');
    });

    it('reshapes reactions into the {items, mine} envelope (with non-empty data)', () => {
        // Even though current LessonCard does not render reactions, the
        // adapter surfaces them so a future UI can opt in without re-plumbing.
        const view = makeView({
            reactions: [
                { emoji: '👍', count: 3 },
                { emoji: '🎉', count: 1 },
            ],
            myReactions: ['👍'],
        });
        const lesson = socialEntityToExtraLessonView(view);
        expect(lesson.reactions).toEqual({
            items: [
                { emoji: '👍', count: 3 },
                { emoji: '🎉', count: 1 },
            ],
            mine: ['👍'],
        });
    });

    it('returns an empty reactions envelope when none are present', () => {
        // Defensive default — never surface `undefined` to a consumer that
        // expects to iterate `lesson.reactions.items`.
        const view = makeView();
        const lesson = socialEntityToExtraLessonView(view);
        expect(lesson.reactions).toEqual({ items: [], mine: [] });
    });
});
