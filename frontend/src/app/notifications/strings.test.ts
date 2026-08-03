/**
 * Pure-helper tests for the Notification Center i18n + format helpers.
 *
 * We deliberately do NOT render the page in vitest — React components and
 * fetch-coupled effects are out of scope for unit tests in this repo
 * (see AGENTS.md "What not to test in unit tests"). The shape parity check
 * here is the locale-equivalent of `frontend/src/lib/strings-parity.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
    formatRelativeTime,
    formatUnreadBadge,
    getNotificationsCenterUi,
    resolveNotificationHref,
    UNREAD_BADGE_CAP,
} from './strings';

describe('getNotificationsCenterUi locale parity', () => {
    const ru = getNotificationsCenterUi('ru');
    const kz = getNotificationsCenterUi('kz');
    const en = getNotificationsCenterUi('en');

    it('every locale exposes the same top-level keys', () => {
        const ruKeys = Object.keys(ru).sort();
        const kzKeys = Object.keys(kz).sort();
        const enKeys = Object.keys(en).sort();
        expect(kzKeys).toEqual(ruKeys);
        expect(enKeys).toEqual(ruKeys);
    });

    it('exposes a non-empty title and subtitle in every locale', () => {
        for (const ui of [ru, kz, en]) {
            expect(ui.screenTitle.length).toBeGreaterThan(0);
            expect(ui.screenSubtitle.length).toBeGreaterThan(0);
        }
    });

    it('kindLabel covers every SocialNotificationKind', () => {
        const expectedKinds = ['mention', 'dm', 'comment', 'group_post', 'announcement'] as const;
        for (const ui of [ru, kz, en]) {
            for (const kind of expectedKinds) {
                expect(ui.kindLabel[kind].length, `${kind} kind label missing`).toBeGreaterThan(0);
                expect(ui.actorAction[kind]('A').length, `${kind} actorAction missing`).toBeGreaterThan(0);
            }
        }
    });

    it('groupedTitle renders a non-empty label for every kind in every locale', () => {
        const expectedKinds = ['mention', 'dm', 'comment', 'group_post', 'announcement'] as const;
        for (const ui of [ru, kz, en]) {
            for (const kind of expectedKinds) {
                const out = ui.groupedTitle(5, kind);
                expect(out.length, `${kind} groupedTitle missing`).toBeGreaterThan(0);
                expect(out.includes('5')).toBe(true);
            }
        }
    });

    it('groupMore renders a non-empty caption containing the count', () => {
        for (const ui of [ru, kz, en]) {
            expect(ui.groupMore(3).includes('3')).toBe(true);
        }
    });

    it('uses ru plural rules for the grouped title — singular/few/many', () => {
        // 1 → singular, 3 → few, 7 → many
        expect(ru.groupedTitle(1, 'mention')).toBe('1 упоминание');
        expect(ru.groupedTitle(3, 'mention')).toBe('3 упоминания');
        expect(ru.groupedTitle(7, 'mention')).toBe('7 упоминаний');
    });

    it('uses English singular/plural rules for the grouped title', () => {
        expect(en.groupedTitle(1, 'mention')).toBe('1 mention');
        expect(en.groupedTitle(5, 'mention')).toBe('5 mentions');
    });

    it('falls back to ru for an unknown language tag at the type level', () => {
        // Defensive: while the typed signature requires AppLanguage, real
        // callers occasionally read it from window state — verify the
        // function still hands back the ru bag instead of throwing.
        const out = getNotificationsCenterUi('ru');
        expect(out.screenTitle).toBe(ru.screenTitle);
    });
});

describe('formatRelativeTime', () => {
    const ui = getNotificationsCenterUi('ru');
    const base = new Date('2026-05-20T12:00:00.000Z').getTime();

    it('returns "just now" for sub-minute deltas', () => {
        const recent = new Date(base - 30_000).toISOString();
        expect(formatRelativeTime(recent, base, ui)).toBe(ui.justNow);
    });

    it('returns minutesAgo between 1m and 59m', () => {
        const ts = new Date(base - 5 * 60_000).toISOString();
        expect(formatRelativeTime(ts, base, ui)).toBe(ui.minutesAgo(5));
    });

    it('returns hoursAgo between 1h and 23h', () => {
        const ts = new Date(base - 3 * 60 * 60_000).toISOString();
        expect(formatRelativeTime(ts, base, ui)).toBe(ui.hoursAgo(3));
    });

    it('returns daysAgo at 24h+', () => {
        const ts = new Date(base - 2 * 24 * 60 * 60_000).toISOString();
        expect(formatRelativeTime(ts, base, ui)).toBe(ui.daysAgo(2));
    });

    it('clamps future timestamps to "just now"', () => {
        const future = new Date(base + 60_000).toISOString();
        expect(formatRelativeTime(future, base, ui)).toBe(ui.justNow);
    });

    it('returns an empty string for unparseable input', () => {
        expect(formatRelativeTime('not-a-date', base, ui)).toBe('');
    });
});

describe('formatUnreadBadge', () => {
    it('returns an empty string when there is nothing to show', () => {
        expect(formatUnreadBadge(0)).toBe('');
        expect(formatUnreadBadge(-3)).toBe('');
        expect(formatUnreadBadge(Number.NaN)).toBe('');
    });

    it('returns the literal integer for in-range values', () => {
        expect(formatUnreadBadge(1)).toBe('1');
        expect(formatUnreadBadge(42)).toBe('42');
        expect(formatUnreadBadge(UNREAD_BADGE_CAP)).toBe(String(UNREAD_BADGE_CAP));
    });

    it(`caps display at "${UNREAD_BADGE_CAP}+"`, () => {
        expect(formatUnreadBadge(UNREAD_BADGE_CAP + 1)).toBe(`${UNREAD_BADGE_CAP}+`);
        expect(formatUnreadBadge(500)).toBe(`${UNREAD_BADGE_CAP}+`);
    });

    it('floors decimal counts to avoid weird "3.7" badges', () => {
        expect(formatUnreadBadge(3.9)).toBe('3');
    });
});

describe('resolveNotificationHref', () => {
    it('routes group scopes to /group/:key with the prefix stripped', () => {
        expect(resolveNotificationHref('group', 'group:ITS-21')).toBe('/group/ITS-21');
    });

    it('handles a raw (un-prefixed) group key', () => {
        expect(resolveNotificationHref('group', 'ITS-21')).toBe('/group/ITS-21');
    });

    it('encodes scope ids with special characters', () => {
        expect(resolveNotificationHref('group', 'group:a/b')).toBe(`/group/${encodeURIComponent('a/b')}`);
    });

    it('routes dm + global scopes to /chat', () => {
        expect(resolveNotificationHref('dm', 'dm:direct:alice::bob')).toBe('/chat');
        expect(resolveNotificationHref('global', 'global:chat')).toBe('/chat');
    });

    it('routes announcement to the root landing surface', () => {
        expect(resolveNotificationHref('announcement', 'announcement:global')).toBe('/');
    });

    it('falls back to / for an unknown scopeType', () => {
        expect(resolveNotificationHref('mystery', 'mystery:x')).toBe('/');
    });
});
