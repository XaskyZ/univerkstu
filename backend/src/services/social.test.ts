import { describe, it, expect } from 'vitest';
import {
    SOCIAL_BODY_MAX_LENGTH,
    SOCIAL_COMMENT_MAX_LENGTH,
    SOCIAL_TITLE_MAX_LENGTH,
    buildScopeId,
    extractMentions,
    isAllowedReactionEmoji,
    validateBody,
    validateCommentBody,
    validateTitle,
} from './social.js';

// All tests here are pure-function checks. The CRUD stubs are not exercised
// because they throw `Phase 1a: ... not implemented` by design.

describe('validateBody', () => {
    it('rejects an empty string', () => {
        expect(() => validateBody('')).toThrow(/empty/i);
    });

    it('rejects whitespace-only input', () => {
        expect(() => validateBody('   \t\n  ')).toThrow(/empty/i);
    });

    it('rejects non-string input', () => {
        expect(() => validateBody(undefined)).toThrow(/string/i);
        expect(() => validateBody(null)).toThrow(/string/i);
        expect(() => validateBody(42)).toThrow(/string/i);
    });

    it('rejects bodies over the length cap', () => {
        const tooLong = 'x'.repeat(SOCIAL_BODY_MAX_LENGTH + 1);
        expect(() => validateBody(tooLong)).toThrow();
    });

    it('accepts a body exactly at the length cap', () => {
        const atLimit = 'x'.repeat(SOCIAL_BODY_MAX_LENGTH);
        expect(validateBody(atLimit)).toBe(atLimit);
    });

    it('trims leading and trailing whitespace', () => {
        expect(validateBody('  hello world  ')).toBe('hello world');
    });

    it('returns the trimmed value for a normal body', () => {
        expect(validateBody('quick brown fox')).toBe('quick brown fox');
    });
});

describe('validateTitle', () => {
    it('rejects an empty title', () => {
        expect(() => validateTitle('')).toThrow(/empty/i);
        expect(() => validateTitle('   ')).toThrow(/empty/i);
    });

    it('rejects titles over the length cap', () => {
        const tooLong = 'a'.repeat(SOCIAL_TITLE_MAX_LENGTH + 1);
        expect(() => validateTitle(tooLong)).toThrow();
    });

    it('accepts a title exactly at the length cap', () => {
        const atLimit = 'a'.repeat(SOCIAL_TITLE_MAX_LENGTH);
        expect(validateTitle(atLimit)).toBe(atLimit);
    });

    it('trims and returns the title', () => {
        expect(validateTitle('  Hello  ')).toBe('Hello');
    });
});

describe('validateCommentBody', () => {
    it('rejects an empty comment', () => {
        expect(() => validateCommentBody('')).toThrow(/empty/i);
        expect(() => validateCommentBody('   ')).toThrow(/empty/i);
    });

    it('rejects comments over the length cap', () => {
        const tooLong = 'c'.repeat(SOCIAL_COMMENT_MAX_LENGTH + 1);
        expect(() => validateCommentBody(tooLong)).toThrow();
    });

    it('accepts a comment exactly at the length cap', () => {
        const atLimit = 'c'.repeat(SOCIAL_COMMENT_MAX_LENGTH);
        expect(validateCommentBody(atLimit)).toBe(atLimit);
    });

    it('trims and returns the comment', () => {
        expect(validateCommentBody('  good point  ')).toBe('good point');
    });
});

describe('extractMentions', () => {
    it('extracts handles from the docstring example', () => {
        expect(extractMentions('Hello @alice and @bob! @alice again')).toEqual([
            'alice',
            'bob',
        ]);
    });

    it('returns [] when there are no @ characters', () => {
        expect(extractMentions('plain text with no mentions')).toEqual([]);
    });

    it('returns [] for a bare @ with no handle after it', () => {
        expect(extractMentions('hey @ what')).toEqual([]);
    });

    it('does NOT treat email local-part suffixes as mentions', () => {
        // The `gmail` after `user@` is preceded by an alphanumeric char, so the
        // lookbehind suppresses the match. Same for any email.
        expect(extractMentions('contact me at user@gmail.com')).toEqual([]);
        expect(extractMentions('send to admin@example.org please')).toEqual([]);
    });

    it('accepts numeric handles (student IDs are numeric)', () => {
        expect(extractMentions('ping @1 and @42')).toEqual(['1', '42']);
    });

    it('accepts underscore handles', () => {
        expect(extractMentions('cc @_name and @user_name_42')).toEqual([
            '_name',
            'user_name_42',
        ]);
    });

    it('terminates the handle at a dot — `@name.dot` captures only `name`', () => {
        expect(extractMentions('go @name.dot home')).toEqual(['name']);
    });

    it('preserves first-occurrence order and dedupes repeats', () => {
        expect(extractMentions('@b then @a then @b then @c then @a')).toEqual([
            'b',
            'a',
            'c',
        ]);
    });

    it('returns [] for non-string and empty input', () => {
        expect(extractMentions('')).toEqual([]);
        // @ts-expect-error — exercising defensive branch
        expect(extractMentions(null)).toEqual([]);
        // @ts-expect-error — exercising defensive branch
        expect(extractMentions(undefined)).toEqual([]);
    });

    it('handles consecutive mentions separated only by punctuation', () => {
        expect(extractMentions('@a,@b;@c!')).toEqual(['a', 'b', 'c']);
    });
});

describe('buildScopeId', () => {
    it('builds group scope ids', () => {
        expect(buildScopeId('group', 'ITS-21')).toBe('group:ITS-21');
    });

    it('builds dm scope ids', () => {
        expect(buildScopeId('dm', 'room-42')).toBe('dm:room-42');
    });

    it('builds global scope ids', () => {
        expect(buildScopeId('global', 'global')).toBe('global:global');
    });

    it('is idempotent — already-prefixed input is returned verbatim', () => {
        expect(buildScopeId('group', 'group:ITS-21')).toBe('group:ITS-21');
        expect(buildScopeId('dm', 'dm:room-42')).toBe('dm:room-42');
    });

    it('trims whitespace before deciding', () => {
        expect(buildScopeId('group', '  ITS-21  ')).toBe('group:ITS-21');
    });

    it('rejects empty / whitespace-only raw ids', () => {
        expect(() => buildScopeId('group', '')).toThrow();
        expect(() => buildScopeId('group', '   ')).toThrow();
    });

    it('rejects non-string raw ids', () => {
        // @ts-expect-error — defensive branch
        expect(() => buildScopeId('group', 123)).toThrow();
    });
});

describe('isAllowedReactionEmoji', () => {
    it('accepts each of the 5 spec-pinned emojis', () => {
        for (const e of ['👍', '❤️', '😂', '🎉', '😢']) {
            expect(isAllowedReactionEmoji(e)).toBe(true);
        }
    });

    it('rejects any other string', () => {
        expect(isAllowedReactionEmoji('🔥')).toBe(false);
        expect(isAllowedReactionEmoji('')).toBe(false);
        expect(isAllowedReactionEmoji('javascript:')).toBe(false);
        expect(isAllowedReactionEmoji('thumbs up')).toBe(false);
        // A subtle one: similar-looking thumb without skin tone modifiers
        // that aren't in the allow-list is rejected.
        expect(isAllowedReactionEmoji('👍🏻')).toBe(false);
    });
});
