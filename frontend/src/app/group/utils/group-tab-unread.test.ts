/**
 * Unit tests for the pure helpers behind the group-space tab unread badge.
 * The React + DOM side (subscribe / auto-mark-read / badge rendering) is
 * covered by GroupSpacePage integration in practice — per project test
 * conventions we keep hooks/components out of unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
    GROUP_UNREAD_TABS,
    buildGroupScopeKey,
    isGroupUnreadTab,
    shouldBumpGroupScope,
} from './group-tab-unread';

describe('GROUP_UNREAD_TABS', () => {
    it('covers feed, tasks and lessons in that order', () => {
        expect(GROUP_UNREAD_TABS).toEqual(['feed', 'tasks', 'lessons']);
    });
});

describe('isGroupUnreadTab', () => {
    it('returns true for the three social-bearing tabs', () => {
        expect(isGroupUnreadTab('feed')).toBe(true);
        expect(isGroupUnreadTab('tasks')).toBe(true);
        expect(isGroupUnreadTab('lessons')).toBe(true);
    });

    it('returns false for non-social tabs', () => {
        expect(isGroupUnreadTab('files')).toBe(false);
        expect(isGroupUnreadTab('members')).toBe(false);
        expect(isGroupUnreadTab('requests')).toBe(false);
        expect(isGroupUnreadTab('roles')).toBe(false);
    });

    it('returns false for falsy / non-string input', () => {
        expect(isGroupUnreadTab(null)).toBe(false);
        expect(isGroupUnreadTab(undefined)).toBe(false);
        expect(isGroupUnreadTab('')).toBe(false);
        // @ts-expect-error — defensive against runtime garbage
        expect(isGroupUnreadTab(42)).toBe(false);
    });
});

describe('buildGroupScopeKey', () => {
    it('prefixes the trimmed groupKey with the scope namespace', () => {
        expect(buildGroupScopeKey('ITS-21')).toBe('group:ITS-21');
        expect(buildGroupScopeKey('  ITS-21  ')).toBe('group:ITS-21');
    });

    it('returns null for empty / whitespace-only / non-string input', () => {
        expect(buildGroupScopeKey('')).toBeNull();
        expect(buildGroupScopeKey('   ')).toBeNull();
        expect(buildGroupScopeKey(null)).toBeNull();
        expect(buildGroupScopeKey(undefined)).toBeNull();
    });
});

describe('shouldBumpGroupScope', () => {
    const base = {
        socialBeta: true,
        eventScopeType: 'group',
        eventScopeId: 'ITS-21',
        eventAuthorUserId: 'peer-user',
        groupScopeKey: 'group:ITS-21',
        viewerUserId: 'me',
    } as const;

    it('returns true for a peer-authored entity in the matching group scope', () => {
        expect(shouldBumpGroupScope(base)).toBe(true);
    });

    it('returns false when the beta flag is off', () => {
        expect(shouldBumpGroupScope({ ...base, socialBeta: false })).toBe(false);
    });

    it('returns false when no group scope key is bound', () => {
        expect(shouldBumpGroupScope({ ...base, groupScopeKey: null })).toBe(false);
    });

    it('returns false for non-group scope types (dm, global, announcement)', () => {
        expect(shouldBumpGroupScope({ ...base, eventScopeType: 'dm' })).toBe(false);
        expect(shouldBumpGroupScope({ ...base, eventScopeType: 'global' })).toBe(false);
        expect(shouldBumpGroupScope({ ...base, eventScopeType: 'announcement' })).toBe(false);
    });

    it('returns false when the event scope id does not match the subscribed group', () => {
        expect(shouldBumpGroupScope({ ...base, eventScopeId: 'OTHER-GROUP' })).toBe(false);
    });

    it('returns false when the author is the viewer (own writes)', () => {
        expect(shouldBumpGroupScope({
            ...base,
            eventAuthorUserId: 'me',
        })).toBe(false);
    });

    it('returns false when the viewer id is missing (signed out / SSR)', () => {
        expect(shouldBumpGroupScope({ ...base, viewerUserId: null })).toBe(false);
    });
});
