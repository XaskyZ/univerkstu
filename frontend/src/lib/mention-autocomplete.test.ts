/**
 * Pure-helper unit tests for the @mention autocomplete plumbing. The React
 * hook (`useMentionAutocomplete`, `useMentionableTextarea`) is deliberately
 * NOT tested here — per repo conventions, hooks are exercised through their
 * consumers and the route/service tests, not unit tests against the DOM.
 */
import { describe, expect, it } from 'vitest';
import {
    detectMentionTrigger,
    replaceMentionToken,
} from './mention-autocomplete';

describe('detectMentionTrigger', () => {
    it('returns inactive for empty text', () => {
        expect(detectMentionTrigger('', 0)).toEqual({ active: false, query: '', tokenStart: -1 });
    });

    it('returns inactive for an out-of-range caret', () => {
        expect(detectMentionTrigger('hello', -1).active).toBe(false);
        expect(detectMentionTrigger('hello', Number.NaN).active).toBe(false);
    });

    it('activates immediately after a bare @ at start', () => {
        const result = detectMentionTrigger('@', 1);
        expect(result.active).toBe(true);
        expect(result.query).toBe('');
        expect(result.tokenStart).toBe(0);
    });

    it('captures the typed query up to the caret', () => {
        const result = detectMentionTrigger('hello @ali', 'hello @ali'.length);
        expect(result.active).toBe(true);
        expect(result.query).toBe('ali');
        expect(result.tokenStart).toBe(6);
    });

    it('treats whitespace before @ as a valid boundary', () => {
        expect(detectMentionTrigger('  @b', 4)).toEqual({
            active: true,
            query: 'b',
            tokenStart: 2,
        });
    });

    it('treats punctuation before @ as a valid boundary', () => {
        const text = 'hi(@bob';
        const result = detectMentionTrigger(text, text.length);
        expect(result.active).toBe(true);
        expect(result.tokenStart).toBe(3);
    });

    it('does NOT trigger on email-like local parts', () => {
        const text = 'send to user@gmail';
        expect(detectMentionTrigger(text, text.length)).toEqual({
            active: false,
            query: '',
            tokenStart: -1,
        });
    });

    it('terminates the token at whitespace', () => {
        const text = '@bob hello';
        // caret at the very end — there is a space inside the token-back-walk
        expect(detectMentionTrigger(text, text.length).active).toBe(false);
    });

    it('terminates the token at a period or punctuation', () => {
        const text = '@bob.';
        expect(detectMentionTrigger(text, text.length).active).toBe(false);
    });

    it('handles underscores and digits inside the handle', () => {
        const text = '@u_42';
        expect(detectMentionTrigger(text, text.length)).toEqual({
            active: true,
            query: 'u_42',
            tokenStart: 0,
        });
    });

    it('clamps caret beyond text length', () => {
        const text = '@bob';
        expect(detectMentionTrigger(text, 999)).toEqual({
            active: true,
            query: 'bob',
            tokenStart: 0,
        });
    });

    it('finds the nearest @ when there are multiple in the string', () => {
        const text = '@alpha and @be';
        const result = detectMentionTrigger(text, text.length);
        expect(result.active).toBe(true);
        expect(result.query).toBe('be');
        expect(result.tokenStart).toBe(11);
    });

    it('returns inactive when caret is well past the @ word (after a space)', () => {
        const text = '@alpha and';
        expect(detectMentionTrigger(text, text.length).active).toBe(false);
    });

    it('returns inactive when input is not a string', () => {
        // @ts-expect-error — runtime guard
        expect(detectMentionTrigger(null, 0).active).toBe(false);
    });
});

describe('replaceMentionToken', () => {
    it('replaces the @query with @handle plus trailing space', () => {
        const text = 'hello @al';
        const trigger = detectMentionTrigger(text, text.length);
        const { next, nextCaret } = replaceMentionToken(text, trigger, text.length, 'alice');
        expect(next).toBe('hello @alice ');
        expect(nextCaret).toBe('hello @alice '.length);
    });

    it('keeps trailing text intact after the token', () => {
        const text = '@al hello';
        // simulate the caret AT the end of `@al` (right before space).
        const trigger = detectMentionTrigger(text, 3);
        const { next, nextCaret } = replaceMentionToken(text, trigger, 3, 'alice');
        expect(next).toBe('@alice  hello');
        expect(nextCaret).toBe('@alice '.length);
    });

    it('returns the original text when no trigger is active', () => {
        const inactive = { active: false, query: '', tokenStart: -1 } as const;
        const out = replaceMentionToken('hello', inactive, 5, 'alice');
        expect(out).toEqual({ next: 'hello', nextCaret: 5 });
    });

    it('returns the original text when the handle is blank', () => {
        const text = '@al';
        const trigger = detectMentionTrigger(text, 3);
        const out = replaceMentionToken(text, trigger, 3, '   ');
        expect(out).toEqual({ next: text, nextCaret: 3 });
    });

    it('trims the inserted handle', () => {
        const text = '@';
        const trigger = detectMentionTrigger(text, 1);
        const { next } = replaceMentionToken(text, trigger, 1, '  alice  ');
        expect(next).toBe('@alice ');
    });

    it('clamps the caret to text length before slicing', () => {
        const text = '@al';
        const trigger = detectMentionTrigger(text, 3);
        const { next, nextCaret } = replaceMentionToken(text, trigger, 9999, 'alice');
        expect(next).toBe('@alice ');
        expect(nextCaret).toBe('@alice '.length);
    });

    it('clamps a negative caret to zero', () => {
        const text = '@al';
        const trigger = detectMentionTrigger(text, 3);
        const { next } = replaceMentionToken(text, trigger, -5, 'alice');
        // negative caret -> after = text.slice(0)
        expect(next.startsWith('@alice ')).toBe(true);
    });
});
