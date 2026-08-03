import { describe, it, expect } from 'vitest';
import {
    subscribeCoordinatorAnnouncements,
    getCoordinatorAnnouncements,
    upsertCoordinatorAnnouncement,
    revokeCoordinatorAnnouncement,
    markCoordinatorAnnouncementViewed,
    type CoordinatorAnnouncement,
} from './coordinatorAnnouncements';

// Module-scope state isn't resettable from outside, so each test uses a unique tag
// in its IDs and filters the global list down to its own entries for assertions.
let testTag = 0;
const nextTag = () => `t${++testTag}`;

const baseUpsert = (tag: string): Parameters<typeof upsertCoordinatorAnnouncement>[0] => ({
    title: `Title ${tag}`,
    body: `Body ${tag}`,
    priority: 'info',
    targetMode: 'all_starostas',
    targetGroups: [],
});

const ownEntries = (tag: string) => getCoordinatorAnnouncements().filter((a) => a.title === `Title ${tag}`);

describe('getCoordinatorAnnouncements', () => {
    it('returns the live announcement list (current reference)', () => {
        const result = getCoordinatorAnnouncements();
        expect(Array.isArray(result)).toBe(true);
    });
});

describe('upsertCoordinatorAnnouncement', () => {
    it('creates a new announcement when no id given', () => {
        const tag = nextTag();
        const before = ownEntries(tag).length;
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const after = ownEntries(tag);
        expect(after.length).toBe(before + 1);
        const created = after[0];
        expect(created.id).toMatch(/^ann-\d+$/);
        expect(created.viewCount).toBe(0);
        expect(typeof created.createdAt).toBe('string');
        expect(new Date(created.createdAt).getTime()).toBeGreaterThan(0);
    });

    it('prepends new entries (newest first)', () => {
        const tag = nextTag();
        upsertCoordinatorAnnouncement({ ...baseUpsert(tag), body: 'first' });
        upsertCoordinatorAnnouncement({ ...baseUpsert(tag), body: 'second' });
        const own = ownEntries(tag);
        // Newest entry should be at index 0 of the global list (within the own subset).
        expect(own[0].body).toBe('second');
        expect(own[1].body).toBe('first');
    });

    it('updates an existing announcement when matching id is given', () => {
        // Note: the module generates IDs from `ann-${Date.now()}`, which can collide
        // across rapid-fire creates. So we track the specific entry by its body marker
        // instead of relying on id-uniqueness or length counts.
        const tag = nextTag();
        const originalMarker = `original-${tag}`;
        const updatedMarker = `updated-${tag}`;

        upsertCoordinatorAnnouncement({ ...baseUpsert(tag), body: originalMarker });
        const created = getCoordinatorAnnouncements().find((a) => a.body === originalMarker)!;
        expect(created).toBeDefined();

        upsertCoordinatorAnnouncement({
            ...baseUpsert(tag),
            id: created.id,
            body: updatedMarker,
        } as Parameters<typeof upsertCoordinatorAnnouncement>[0]);

        // After update: the same id now carries `updatedMarker`, and the previous
        // body is gone from that id.
        const refreshed = getCoordinatorAnnouncements().find((a) => a.id === created.id);
        expect(refreshed?.body).toBe(updatedMarker);
    });

    it('does nothing visible to own list when id does not match any entry', () => {
        // The implementation maps over the array — non-matching ids are simply not touched,
        // and no new entry is appended (since the input had an id).
        const tag = nextTag();
        const beforeLen = ownEntries(tag).length;
        upsertCoordinatorAnnouncement({
            ...baseUpsert(tag),
            id: 'definitely-does-not-exist-12345',
        } as Parameters<typeof upsertCoordinatorAnnouncement>[0]);
        expect(ownEntries(tag).length).toBe(beforeLen);
    });
});

describe('revokeCoordinatorAnnouncement', () => {
    it('sets revokedAt on the matching announcement', () => {
        const tag = nextTag();
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const created = ownEntries(tag)[0];
        expect(created.revokedAt).toBeFalsy();

        revokeCoordinatorAnnouncement(created.id);
        const updated = ownEntries(tag)[0];
        expect(updated.revokedAt).toBeTruthy();
        expect(new Date(updated.revokedAt!).getTime()).toBeGreaterThan(0);
    });

    it('is a no-op for unknown id (no entry mutated)', () => {
        const tag = nextTag();
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const before: CoordinatorAnnouncement = { ...ownEntries(tag)[0] };

        revokeCoordinatorAnnouncement('nope-unknown-id');
        const after = ownEntries(tag)[0];
        expect(after.revokedAt).toBe(before.revokedAt);
    });
});

describe('markCoordinatorAnnouncementViewed', () => {
    it('increments viewCount by 1', () => {
        const tag = nextTag();
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const created = ownEntries(tag)[0];
        expect(created.viewCount).toBe(0);

        markCoordinatorAnnouncementViewed(created.id);
        expect(ownEntries(tag)[0].viewCount).toBe(1);

        markCoordinatorAnnouncementViewed(created.id);
        markCoordinatorAnnouncementViewed(created.id);
        expect(ownEntries(tag)[0].viewCount).toBe(3);
    });

    it('is a no-op for unknown id', () => {
        const tag = nextTag();
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const before = ownEntries(tag)[0].viewCount;
        markCoordinatorAnnouncementViewed('nope-unknown');
        expect(ownEntries(tag)[0].viewCount).toBe(before);
    });
});

describe('subscribeCoordinatorAnnouncements', () => {
    it('notifies the listener on upsert / revoke / view', () => {
        let calls = 0;
        const unsub = subscribeCoordinatorAnnouncements(() => { calls += 1; });
        const tag = nextTag();
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const id = ownEntries(tag)[0].id;
        revokeCoordinatorAnnouncement(id);
        markCoordinatorAnnouncementViewed(id);
        expect(calls).toBeGreaterThanOrEqual(3);
        unsub();
    });

    it('returns an unsubscribe fn that stops further notifications', () => {
        let calls = 0;
        const unsub = subscribeCoordinatorAnnouncements(() => { calls += 1; });
        const tag = nextTag();
        upsertCoordinatorAnnouncement(baseUpsert(tag));
        const before = calls;
        unsub();
        upsertCoordinatorAnnouncement(baseUpsert(nextTag()));
        expect(calls).toBe(before);
    });

    it('supports multiple listeners — all are called', () => {
        let a = 0;
        let b = 0;
        const ua = subscribeCoordinatorAnnouncements(() => { a += 1; });
        const ub = subscribeCoordinatorAnnouncements(() => { b += 1; });
        upsertCoordinatorAnnouncement(baseUpsert(nextTag()));
        expect(a).toBe(1);
        expect(b).toBe(1);
        ua();
        ub();
    });
});
