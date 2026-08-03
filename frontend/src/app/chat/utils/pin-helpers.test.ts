import { describe, it, expect } from 'vitest';
import {
    formatPinnedSnippet,
    getPinUi,
    isMessagePinnable,
    pickPinnedMessages,
} from './pin-helpers';

describe('isMessagePinnable — DM', () => {
    it('lets the author pin their own message', () => {
        // Outbound DM message — the viewer is the author. Either peer can
        // pin in DM, including the sender of the message itself.
        expect(
            isMessagePinnable(
                'dm',
                { id: 'msg-1', authorUserId: 'me' },
                { userId: 'me', peerUserId: 'peer' },
            ),
        ).toBe(true);
    });

    it('lets the peer pin an inbound DM message', () => {
        // Inbound DM — viewer is the room's peer and the author is the
        // counterpart. Both peers are participants so both may pin.
        expect(
            isMessagePinnable(
                'dm',
                { id: 'msg-2', authorUserId: 'peer' },
                { userId: 'me', peerUserId: 'peer' },
            ),
        ).toBe(true);
    });

    it('rejects an unauthenticated viewer regardless of authorship', () => {
        // Guard against rendering the pin button before auth state loads.
        expect(
            isMessagePinnable(
                'dm',
                { id: 'msg-3', authorUserId: 'me' },
                { userId: null, peerUserId: 'peer' },
            ),
        ).toBe(false);
    });

    it('rejects pending optimistic ids', () => {
        // Pending messages have no entity row yet, so the universal pin
        // endpoint would 404. Hide the affordance until the round-trip
        // completes.
        expect(
            isMessagePinnable(
                'dm',
                { id: '__pending_42', authorUserId: 'me' },
                { userId: 'me', peerUserId: 'peer' },
            ),
        ).toBe(false);
    });

    it('falls back to author-equality when peer is unknown', () => {
        // Room metadata not loaded yet — accept the conservative case where
        // the viewer matches the author. Prevents non-participants from
        // pinning when we don't yet know who the peer is.
        expect(
            isMessagePinnable(
                'dm',
                { id: 'msg-4', authorUserId: 'me' },
                { userId: 'me' },
            ),
        ).toBe(true);
        expect(
            isMessagePinnable(
                'dm',
                { id: 'msg-5', authorUserId: 'someone-else' },
                { userId: 'me' },
            ),
        ).toBe(false);
    });
});

describe('isMessagePinnable — global', () => {
    it('lets a moderator pin any global-chat message', () => {
        // Mod gate is the only thing checked for the global path; author
        // identity is irrelevant.
        expect(
            isMessagePinnable(
                'global',
                { id: 'g-1', authorUserId: 'someone' },
                { userId: 'me', canModerate: true },
            ),
        ).toBe(true);
    });

    it('rejects a regular user even on their own message', () => {
        // Authorship is intentionally NOT a privilege in global chat —
        // matches the legacy admin-pin semantic.
        expect(
            isMessagePinnable(
                'global',
                { id: 'g-2', authorUserId: 'me' },
                { userId: 'me', canModerate: false },
            ),
        ).toBe(false);
    });
});

describe('formatPinnedSnippet', () => {
    it('returns the body unchanged when it fits the limit', () => {
        // Short messages don't get the ellipsis appended.
        expect(formatPinnedSnippet('Hello there', 80)).toBe('Hello there');
    });

    it('truncates long bodies with a trailing ellipsis', () => {
        // 100-char body → 80-char output including the `…` (the slice keeps
        // 79 chars + the ellipsis = 80 visible codepoints).
        const long = 'a'.repeat(100);
        const out = formatPinnedSnippet(long, 80);
        expect(out.length).toBe(80);
        expect(out.endsWith('…')).toBe(true);
    });

    it('collapses internal whitespace and trims', () => {
        // Newlines and tabs in the original body would expand the visible
        // length; collapsing keeps the rail single-line.
        expect(formatPinnedSnippet('  hello\n   world\t!  ', 80)).toBe('hello world !');
    });

    it('returns an empty string for null / undefined / blank input', () => {
        // Defensive — the rail caller renders the placeholder when blank.
        expect(formatPinnedSnippet(null)).toBe('');
        expect(formatPinnedSnippet(undefined)).toBe('');
        expect(formatPinnedSnippet('   ')).toBe('');
    });
});

describe('pickPinnedMessages', () => {
    it('keeps only entries with `pinned: true` and preserves input order', () => {
        // Order preservation matters because the rail caller decides the
        // sort (e.g. newest-pinned first).
        const messages = [
            { id: 'a', pinned: false },
            { id: 'b', pinned: true },
            { id: 'c', pinned: true },
            { id: 'd', pinned: false },
        ];
        expect(pickPinnedMessages(messages).map((m) => m.id)).toEqual(['b', 'c']);
    });

    it('treats missing pinned field as false', () => {
        // Defensive against legacy shapes that never set the boolean.
        const messages = [{ id: 'x' }, { id: 'y', pinned: true }];
        expect(pickPinnedMessages(messages).map((m) => m.id)).toEqual(['y']);
    });
});

describe('getPinUi — locale parity', () => {
    const ru = getPinUi('ru');
    const kz = getPinUi('kz');
    const en = getPinUi('en');

    it('returns the same key set across ru / kz / en', () => {
        // Locale parity guard — any new key must be translated in all three.
        const ruKeys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(ruKeys);
        expect(Object.keys(en).sort()).toEqual(ruKeys);
    });

    it('every value is a non-empty string', () => {
        for (const ui of [ru, kz, en]) {
            for (const [key, value] of Object.entries(ui)) {
                expect(typeof value, `${key} must be a string`).toBe('string');
                expect((value as string).length, `${key} must be non-empty`).toBeGreaterThan(0);
            }
        }
    });

    it('ru and en strings differ across the majority of entries', () => {
        // Catch copy-paste mistakes where the en factory accidentally returns
        // the ru literal. Allow a couple of identical entries (proper nouns,
        // very short tokens) just in case.
        const stringKeys = Object.keys(ru) as Array<keyof typeof ru>;
        const identical = stringKeys.filter((k) => ru[k] === en[k]);
        expect(identical.length / stringKeys.length).toBeLessThan(0.1);
    });
});
