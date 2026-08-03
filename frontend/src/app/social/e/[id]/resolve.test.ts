import { describe, it, expect } from 'vitest';
import {
    FALLBACK_DESTINATION,
    buildEntityPermalinkPath,
    buildLoginReturnUrl,
    resolveEntityDestination,
    type ResolvableEntity,
} from './resolve';

function entity(partial: Partial<ResolvableEntity> & Pick<ResolvableEntity, 'kind'>): ResolvableEntity {
    return {
        id: 'entity-1',
        scopeType: 'group',
        scopeId: 'ITS-21',
        ...partial,
    } as ResolvableEntity;
}

describe('resolveEntityDestination', () => {
    it('routes group posts to /group with groupKey + focus', () => {
        const url = resolveEntityDestination(entity({ kind: 'post', id: 'p1', scopeId: 'ITS-21' }));
        expect(url).toBe('/group?groupKey=ITS-21&focus=p1');
    });

    it('routes group tasks to /group with groupKey + focus', () => {
        const url = resolveEntityDestination(entity({ kind: 'task', id: 't1', scopeId: 'ITS-21' }));
        expect(url).toBe('/group?groupKey=ITS-21&focus=t1');
    });

    it('routes extra lessons to /group with groupKey + focus', () => {
        const url = resolveEntityDestination(entity({ kind: 'extra_lesson', id: 'l1', scopeId: 'ITS-21' }));
        expect(url).toBe('/group?groupKey=ITS-21&focus=l1');
    });

    it('routes polls to /group with groupKey + focus', () => {
        const url = resolveEntityDestination(entity({ kind: 'poll', id: 'po1', scopeId: 'ITS-21' }));
        expect(url).toBe('/group?groupKey=ITS-21&focus=po1');
    });

    it('routes events to /group with groupKey + focus', () => {
        const url = resolveEntityDestination(entity({ kind: 'event', id: 'e1', scopeId: 'ITS-21' }));
        expect(url).toBe('/group?groupKey=ITS-21&focus=e1');
    });

    it('routes announcements to /group with just focus (no groupKey)', () => {
        const url = resolveEntityDestination(
            entity({ kind: 'announcement', id: 'a1', scopeType: 'announcement', scopeId: 'global' }),
        );
        expect(url).toBe('/group?focus=a1');
    });

    it('routes dm messages to /chat with roomId + focus', () => {
        const url = resolveEntityDestination(
            entity({ kind: 'dm_message', id: 'm1', scopeType: 'dm', scopeId: 'direct:alice::bob' }),
        );
        expect(url).toBe('/chat?roomId=direct%3Aalice%3A%3Abob&focus=m1');
    });

    it('routes global messages to /chat with tab=global + focus', () => {
        const url = resolveEntityDestination(
            entity({ kind: 'global_message', id: 'g1', scopeType: 'global', scopeId: 'chat' }),
        );
        expect(url).toBe('/chat?tab=global&focus=g1');
    });

    it('falls back when group-scoped kind has an empty scopeId', () => {
        const url = resolveEntityDestination(entity({ kind: 'post', id: 'p1', scopeId: '' }));
        expect(url).toBe(FALLBACK_DESTINATION);
    });

    it('falls back when dm_message has an empty scopeId', () => {
        const url = resolveEntityDestination(
            entity({ kind: 'dm_message', id: 'm1', scopeType: 'dm', scopeId: '' }),
        );
        expect(url).toBe(FALLBACK_DESTINATION);
    });

    it('falls back when entity is null', () => {
        expect(resolveEntityDestination(null)).toBe(FALLBACK_DESTINATION);
    });

    it('falls back when entity is undefined', () => {
        expect(resolveEntityDestination(undefined)).toBe(FALLBACK_DESTINATION);
    });

    it('falls back when entity id is empty/whitespace', () => {
        const url = resolveEntityDestination(entity({ kind: 'post', id: '   ', scopeId: 'ITS-21' }));
        expect(url).toBe(FALLBACK_DESTINATION);
    });

    it('falls back when group-scoped kind is tagged with a non-group scopeType', () => {
        const url = resolveEntityDestination(
            entity({ kind: 'post', id: 'p1', scopeType: 'dm', scopeId: 'ITS-21' }),
        );
        expect(url).toBe(FALLBACK_DESTINATION);
    });

    it('falls back on an unknown kind', () => {
        const url = resolveEntityDestination({
            id: 'x1',
            // @ts-expect-error — intentionally outside the union to exercise the default branch
            kind: 'mystery',
            scopeType: 'group',
            scopeId: 'ITS-21',
        });
        expect(url).toBe(FALLBACK_DESTINATION);
    });

    it('encodes special characters in scopeId/id', () => {
        const url = resolveEntityDestination(
            entity({ kind: 'post', id: 'p 1/with', scopeId: 'GR P/1' }),
        );
        // URLSearchParams encodes spaces as `+` and `/` as `%2F` — both are valid
        // for the query layer; we just assert the dangerous characters are escaped.
        expect(url.startsWith('/group?')).toBe(true);
        expect(url).toContain('focus=');
        expect(url).toContain('groupKey=');
        expect(url).not.toContain(' ');
    });
});

describe('buildEntityPermalinkPath', () => {
    it('builds the /social/e/<id> path', () => {
        expect(buildEntityPermalinkPath('abc')).toBe('/social/e/abc');
    });

    it('url-encodes the id', () => {
        expect(buildEntityPermalinkPath('a b/c')).toBe('/social/e/a%20b%2Fc');
    });

    it('returns null for empty/whitespace input', () => {
        expect(buildEntityPermalinkPath('')).toBeNull();
        expect(buildEntityPermalinkPath('   ')).toBeNull();
        expect(buildEntityPermalinkPath(null)).toBeNull();
        expect(buildEntityPermalinkPath(undefined)).toBeNull();
    });
});

describe('buildLoginReturnUrl', () => {
    it('encodes the return path into the query string', () => {
        expect(buildLoginReturnUrl('/social/e/abc')).toBe('/login?return=%2Fsocial%2Fe%2Fabc');
    });

    it('falls back to bare /login for empty input', () => {
        expect(buildLoginReturnUrl('')).toBe('/login');
        expect(buildLoginReturnUrl('   ')).toBe('/login');
    });
});
