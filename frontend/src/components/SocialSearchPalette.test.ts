/**
 * Pure-helper unit tests for the SocialSearchPalette URL/label builders.
 * React rendering is intentionally NOT exercised here — per the AGENTS.md
 * testing conventions hooks and DOM-coupled APIs are out of scope. The
 * debounce + fetch wiring is verified via the API client tests in
 * `lib/api/social.test.ts` (`searchSocialEntities`).
 */
import { describe, expect, it } from 'vitest';
import {
    SOCIAL_SEARCH_DEBOUNCE_MS,
    buildSocialSearchResultLabel,
    buildSocialSearchResultUrl,
} from './SocialSearchPalette';

describe('SOCIAL_SEARCH_DEBOUNCE_MS', () => {
    it('uses a 300ms debounce window', () => {
        // Per the spec — the search palette debounces 300ms between keystrokes
        // to avoid one request per character. Hard-coded here so a regression
        // in the constant fails loudly instead of silently increasing API load.
        expect(SOCIAL_SEARCH_DEBOUNCE_MS).toBe(300);
    });
});

describe('buildSocialSearchResultUrl', () => {
    it('routes group hits to /group with the groupKey querystring (prefix stripped)', () => {
        expect(buildSocialSearchResultUrl({ scopeType: 'group', scopeId: 'group:ITS-21' }))
            .toBe('/group?groupKey=ITS-21');
    });

    it('falls back to the raw scope id when the `group:` prefix is missing', () => {
        // Defensive — legacy or operator-poked rows that lack the prefix
        // should still produce a valid URL.
        expect(buildSocialSearchResultUrl({ scopeType: 'group', scopeId: 'ITS-22' }))
            .toBe('/group?groupKey=ITS-22');
    });

    it('routes dm hits to /chat with the direct: roomId preserved', () => {
        expect(buildSocialSearchResultUrl({ scopeType: 'dm', scopeId: 'dm:direct:alice::bob' }))
            .toBe(`/chat?roomId=${encodeURIComponent('direct:alice::bob')}`);
    });

    it('routes announcement hits to /group (announcements live on the group page)', () => {
        expect(buildSocialSearchResultUrl({ scopeType: 'announcement', scopeId: 'announcement:global' }))
            .toBe('/group');
    });

    it('routes global chat hits to /chat', () => {
        expect(buildSocialSearchResultUrl({ scopeType: 'global', scopeId: 'global:chat' }))
            .toBe('/chat');
    });

    it('encodes group keys that contain url-unsafe characters', () => {
        expect(buildSocialSearchResultUrl({ scopeType: 'group', scopeId: 'group:ИТС-21' }))
            .toBe(`/group?groupKey=${encodeURIComponent('ИТС-21')}`);
    });
});

describe('buildSocialSearchResultLabel', () => {
    it('prefers payload.title for the title slot, payload.body for the preview', () => {
        const out = buildSocialSearchResultLabel({
            kind: 'post',
            payload: { title: 'Lecture 3', body: 'See attached notes' },
        });
        expect(out).toEqual({ title: 'Lecture 3', preview: 'See attached notes' });
    });

    it('uses payload.subject as a fallback title (for extra_lesson entities)', () => {
        const out = buildSocialSearchResultLabel({
            kind: 'extra_lesson',
            payload: { subject: 'Math practice', note: 'bring laptop' },
        });
        expect(out.title).toBe('Math practice');
        expect(out.preview).toBe('bring laptop');
    });

    it('uses payload.question as a fallback title (for poll entities)', () => {
        const out = buildSocialSearchResultLabel({
            kind: 'poll',
            payload: { question: 'Which day works?' },
        });
        expect(out.title).toBe('Which day works?');
        expect(out.preview).toBe('');
    });

    it('promotes payload.body up to the title slot when there is no title', () => {
        const out = buildSocialSearchResultLabel({
            kind: 'dm_message',
            payload: { body: 'hey there' },
        });
        expect(out.title).toBe('hey there');
        expect(out.preview).toBe('');
    });

    it('truncates the title to ≤80 characters when promoted from body', () => {
        const longBody = 'x'.repeat(120);
        const out = buildSocialSearchResultLabel({ kind: 'post', payload: { body: longBody } });
        expect(out.title.length).toBe(80);
        expect(out.preview.length).toBeGreaterThan(0);
    });

    it('falls back to the kind label when no text fields are present', () => {
        const out = buildSocialSearchResultLabel({ kind: 'task', payload: {} });
        expect(out).toEqual({ title: 'task', preview: '' });
    });

    it('trims whitespace-only payload values', () => {
        const out = buildSocialSearchResultLabel({
            kind: 'post',
            payload: { title: '   ', body: 'real body' },
        });
        expect(out.title).toBe('real body');
        expect(out.preview).toBe('');
    });
});
