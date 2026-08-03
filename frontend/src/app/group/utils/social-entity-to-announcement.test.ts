import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import {
    socialAnnouncementToCoordinatorView,
    socialEntityToAnnouncementView,
} from './social-entity-to-announcement';

// Builds a minimal `SocialEntityView` for the announcement scope with sane
// defaults. Tests override only the fields they care about so the assertion
// focuses on the mapping rule.
function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    viewCount?: number;
    hasViewed?: boolean;
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'ann-1',
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:global',
            authorUserId: 'coordinator-1',
            payload: { title: 'Hello', body: 'World', priority: 'low' },
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: [],
        myReactions: [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        viewCount: overrides.viewCount ?? 0,
        hasViewed: overrides.hasViewed ?? false,
    };
}

describe('socialEntityToAnnouncementView', () => {
    it('maps a fully-populated entity into the announcement adapter shape', () => {
        // Full happy-path mapping — every announcement field the existing UI
        // reads is populated from the universal entity. Locks the contract
        // that CoordinatorPage / CuratorPage / StarostaPage depend on once
        // the integration shim wraps this.
        const view = makeView({
            entity: {
                id: 'ann-abc',
                authorUserId: 'coordinator-7',
                payload: {
                    title: 'Maintenance',
                    body: 'The system will be down at 22:00.',
                    priority: 'high',
                    targetGroups: ['ITS-21', 'CSE-22'],
                    expiresAt: '2026-02-01T00:00:00Z',
                },
            },
        });
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement).toEqual({
            id: 'ann-abc',
            title: 'Maintenance',
            body: 'The system will be down at 22:00.',
            priority: 'high',
            targetGroups: ['ITS-21', 'CSE-22'],
            expiresAt: '2026-02-01T00:00:00Z',
            authorUserId: 'coordinator-7',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            revokedAt: null,
            viewCount: 0,
            hasViewed: false,
            reactions: { items: [], mine: [] },
        });
    });

    it('surfaces aggregated reactions and myReactions on the adapter shape', () => {
        // The announcement card renders a `ReactionsBar` behind the
        // `socialFeedBeta` flag and reads `reactions.items` / `reactions.mine`
        // — the same envelope tasks / lessons / posts use. The universal
        // entity exposes the raw aggregates separately; the adapter re-shapes
        // them so the existing bar component does not need a second variant.
        const view = makeView();
        view.reactions = [
            { emoji: '👍', count: 3 },
            { emoji: '🎉', count: 1 },
        ];
        view.myReactions = ['👍'];
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.reactions).toEqual({
            items: [
                { emoji: '👍', count: 3 },
                { emoji: '🎉', count: 1 },
            ],
            mine: ['👍'],
        });
    });

    it('returns an empty reactions envelope when the entity has none', () => {
        // Defaults guarantee the bar can mount without a null guard. Locks
        // the contract that consumers never see `undefined` here.
        const view = makeView();
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.reactions).toEqual({ items: [], mine: [] });
    });

    it('surfaces viewCount and hasViewed from the universal entity view', () => {
        // View-tracking migration: `viewCount` is the distinct-user count
        // from `app_social_view`; `hasViewed` is a per-viewer flag. Both
        // were absent (always 0 / false) before the migration; now they
        // populate from the SocialEntityView the backend ships.
        const view = makeView({ viewCount: 17, hasViewed: true });
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.viewCount).toBe(17);
        expect(announcement.hasViewed).toBe(true);
    });

    it('defaults viewCount to 0 and hasViewed to false on a fresh entity', () => {
        // A brand-new announcement that nobody has opened yet should still
        // produce a number / boolean (never NaN, never undefined) so the
        // legacy back-mapper can read it without an `?? 0` guard.
        const view = makeView();
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.viewCount).toBe(0);
        expect(announcement.hasViewed).toBe(false);
    });

    it('clamps a negative or fractional viewCount to a safe non-negative integer', () => {
        // Belt-and-suspenders against malformed wire data (e.g. a future
        // signed-int regression). UI must never see fractional or negative
        // view counts; the adapter floors-and-clamps before forwarding.
        const view = makeView({ viewCount: -3 });
        expect(socialEntityToAnnouncementView(view).viewCount).toBe(0);
        const view2 = makeView({ viewCount: 3.7 });
        expect(socialEntityToAnnouncementView(view2).viewCount).toBe(3);
    });

    it('coerces a non-finite viewCount to 0', () => {
        // NaN / Infinity would corrupt the "X viewers" label render. We
        // fall through to 0 instead.
        const view = makeView({ viewCount: Number.NaN });
        expect(socialEntityToAnnouncementView(view).viewCount).toBe(0);
    });

    it('defaults missing payload fields to empty strings and a safe priority enum', () => {
        // Defensive against a payload that somehow lacks the required fields.
        // We never want to render literal `undefined` in the DOM, and an
        // unknown priority must coerce to a value `getAnnouncementAccent`-
        // shaped helpers can dispatch on (the shim chose 'medium' as the
        // escape hatch; we mirror that).
        const view = makeView({ entity: { payload: {} } });
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.title).toBe('');
        expect(announcement.body).toBe('');
        expect(announcement.priority).toBe('medium');
    });

    it('coerces an unknown priority string to the medium fallback', () => {
        // The social-store check constraint accepts only the four-priority
        // union, so an unknown value would have been rewritten by the shim.
        // Belt-and-suspenders: clamp on the read path too.
        const view = makeView({
            entity: { payload: { title: 't', body: 'b', priority: 'EXTREME' } },
        });
        expect(socialEntityToAnnouncementView(view).priority).toBe('medium');
    });

    it('omits targetGroups from the result when payload has no entry (broadcast)', () => {
        // The shim only writes `targetGroups` when the legacy target_mode is
        // 'groups'. The absence on the read side is meaningful: it signals a
        // broadcast to all-starostas rather than an empty group list. We must
        // preserve that signal — surfacing `targetGroups: []` would change the
        // UI's branching from "broadcast" to "no recipients".
        const view = makeView({ entity: { payload: { title: 't', body: 'b', priority: 'low' } } });
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.targetGroups).toBeUndefined();
    });

    it('omits targetGroups from the result when payload has an empty array', () => {
        // Equivalent broadcast case — an empty array would otherwise leak into
        // the UI as "no groups selected". The shim does not write this form
        // today, but a future hand-crafted payload might.
        const view = makeView({
            entity: { payload: { title: 't', body: 'b', priority: 'low', targetGroups: [] } },
        });
        expect(socialEntityToAnnouncementView(view).targetGroups).toBeUndefined();
    });

    it('filters non-string entries out of `targetGroups`', () => {
        // Defensive: the universal payload is `Record<string, unknown>`, so a
        // hand-crafted row could contain non-string entries. We coerce to a
        // clean `string[]`.
        const view = makeView({
            entity: {
                payload: { title: 't', body: 'b', priority: 'low', targetGroups: ['ok', 123, null, 'also-ok'] as unknown[] },
            },
        });
        expect(socialEntityToAnnouncementView(view).targetGroups).toEqual(['ok', 'also-ok']);
    });

    it('surfaces deletedAt under both `deletedAt` and `revokedAt` (legacy alias)', () => {
        // Existing UI reads `announcement.revokedAt` to render the "revoked"
        // chip. The universal entity uses `deletedAt`. Aliasing keeps both
        // call sites compilable; existing code paths pre-filtering on
        // `revokedAt` keep working without a rename.
        const view = makeView({
            entity: { deletedAt: '2026-03-01T10:00:00Z' },
        });
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.deletedAt).toBe('2026-03-01T10:00:00Z');
        expect(announcement.revokedAt).toBe('2026-03-01T10:00:00Z');
    });

    it('defaults viewCount to 0 on a fresh entity (view-tracking migration)', () => {
        // Pre-migration this asserted `toBeUndefined()` because the social
        // store had no per-entity counter. After the view-tracking migration
        // (`useSocialViewTracker` + `recordSocialView` + `app_social_view`),
        // the adapter always surfaces a number; a brand-new announcement
        // reads `0` rather than `undefined`. See `viewCount: 17` test above
        // for the populated case.
        const view = makeView();
        const announcement = socialEntityToAnnouncementView(view);
        expect(announcement.viewCount).toBe(0);
    });
});

describe('socialAnnouncementToCoordinatorView', () => {
    it('back-maps to the legacy CoordinatorAnnouncementView shape (zero-view default)', () => {
        // Integration layer relies on the back-mapper to keep existing pages
        // working. Locks the round-trip: every CoordinatorAnnouncementView
        // field is populated from the adapter shape. `viewCount=0` is now
        // the real default for a fresh announcement (the view-tracking
        // migration backfills real counts as users browse the page).
        const view = makeView({
            entity: {
                id: 'ann-xyz',
                authorUserId: 'coordinator-3',
                payload: {
                    title: 'T',
                    body: 'B',
                    priority: 'critical',
                    targetGroups: ['ITS-21'],
                    expiresAt: '2026-04-01T00:00:00Z',
                },
            },
        });
        const adapter = socialEntityToAnnouncementView(view);
        const legacy = socialAnnouncementToCoordinatorView(adapter);
        expect(legacy).toEqual({
            id: 'ann-xyz',
            authorUserId: 'coordinator-3',
            title: 'T',
            body: 'B',
            priority: 'critical',
            targetMode: 'groups',
            targetGroups: ['ITS-21'],
            expiresAt: '2026-04-01T00:00:00Z',
            revokedAt: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            viewCount: 0,
            viewedAt: null,
        });
    });

    it('back-maps targetMode=all_starostas when targetGroups is absent (broadcast)', () => {
        // Broadcast announcements come back from the adapter with no
        // `targetGroups`. Re-deriving the legacy `targetMode` flag is the
        // back-mapper's responsibility.
        const view = makeView({
            entity: { payload: { title: 'T', body: 'B', priority: 'low' } },
        });
        const legacy = socialAnnouncementToCoordinatorView(socialEntityToAnnouncementView(view));
        expect(legacy.targetMode).toBe('all_starostas');
        expect(legacy.targetGroups).toEqual([]);
    });

    it('passes a non-zero viewCount through the legacy back-mapper', () => {
        // After the view-tracking migration the universal entity carries a
        // real viewCount. The back-mapper must surface that number on the
        // legacy `CoordinatorAnnouncementView` so the existing footer label
        // ("Просмотров: N") shows the universal count when the beta flag is
        // on, not the hard-coded 0 it used to render.
        const view = makeView({
            entity: { payload: { title: 'T', body: 'B', priority: 'low' } },
            viewCount: 42,
        });
        const legacy = socialAnnouncementToCoordinatorView(socialEntityToAnnouncementView(view));
        expect(legacy.viewCount).toBe(42);
    });

    it('back-maps social priority to legacy enum (low→info, medium/high→warning, critical→critical)', () => {
        // Lossy bridge — locks the contract so the legacy
        // `getAnnouncementAccent` helper can still dispatch correctly.
        const cases: Array<[string, string]> = [
            ['low', 'info'],
            ['medium', 'warning'],
            ['high', 'warning'],
            ['critical', 'critical'],
        ];
        for (const [social, legacy] of cases) {
            const view = makeView({
                entity: { payload: { title: 'T', body: 'B', priority: social } },
            });
            const mapped = socialAnnouncementToCoordinatorView(socialEntityToAnnouncementView(view));
            expect(mapped.priority).toBe(legacy);
        }
    });
});
