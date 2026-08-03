import { describe, it, expect } from 'vitest';
import { parseMuteDurationMinutes, isGlobalChatServiceError } from './global-chat.js';

describe('parseMuteDurationMinutes', () => {
    // Boundary parser for moderator mute action input. Differs from
    // services/global-chat.ts:clampMuteDurationMinutes which caps at 30 days —
    // this one is just the route-layer validation gate.

    it('passes through valid positive integers', () => {
        expect(parseMuteDurationMinutes(1)).toBe(1);
        expect(parseMuteDurationMinutes(60)).toBe(60);
        expect(parseMuteDurationMinutes(1440)).toBe(1440); // 1 day in minutes
    });

    it('truncates fractional values', () => {
        expect(parseMuteDurationMinutes(1.7)).toBe(1);
        expect(parseMuteDurationMinutes(59.999)).toBe(59);
    });

    it('returns null for zero and negative numbers', () => {
        expect(parseMuteDurationMinutes(0)).toBe(null);
        expect(parseMuteDurationMinutes(-1)).toBe(null);
        // 0.5 truncates to 0 which is then rejected by the > 0 guard.
        expect(parseMuteDurationMinutes(0.5)).toBe(null);
    });

    it('returns null for non-finite numbers', () => {
        expect(parseMuteDurationMinutes(NaN)).toBe(null);
        expect(parseMuteDurationMinutes(Infinity)).toBe(null);
        expect(parseMuteDurationMinutes(-Infinity)).toBe(null);
    });

    it('returns null for non-number inputs (no string coercion)', () => {
        // Strings like "10" must NOT be silently coerced — body schema validates
        // this is a JSON number before it reaches us.
        expect(parseMuteDurationMinutes('10')).toBe(null);
        expect(parseMuteDurationMinutes(null)).toBe(null);
        expect(parseMuteDurationMinutes(undefined)).toBe(null);
        expect(parseMuteDurationMinutes({})).toBe(null);
        expect(parseMuteDurationMinutes([])).toBe(null);
        expect(parseMuteDurationMinutes(true)).toBe(null);
    });
});

describe('isGlobalChatServiceError', () => {
    // Type guard used by every catch-block in the global-chat routes (10+ call sites)
    // to decide whether to forward the service's statusCode+code or return generic 500.

    it('returns true for objects with both statusCode (number) and code (string)', () => {
        const err = Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'forbidden' });
        expect(isGlobalChatServiceError(err)).toBe(true);
    });

    it('returns true for plain objects with the required shape (not just Error instances)', () => {
        // The function does duck-typing, not instanceof Error checks.
        const fakeErr = { statusCode: 404, code: 'not_found', message: 'missing' };
        expect(isGlobalChatServiceError(fakeErr)).toBe(true);
    });

    it('returns false for plain Error without statusCode/code', () => {
        expect(isGlobalChatServiceError(new Error('boom'))).toBe(false);
    });

    it('returns false when statusCode is not a number', () => {
        const err = Object.assign(new Error('boom'), { statusCode: '500', code: 'x' });
        expect(isGlobalChatServiceError(err)).toBe(false);
    });

    it('returns false when code is not a string', () => {
        const err = Object.assign(new Error('boom'), { statusCode: 500, code: 1 });
        expect(isGlobalChatServiceError(err)).toBe(false);
    });

    it('returns false when one field is missing', () => {
        expect(isGlobalChatServiceError(Object.assign(new Error(), { statusCode: 500 }))).toBe(false);
        expect(isGlobalChatServiceError(Object.assign(new Error(), { code: 'x' }))).toBe(false);
    });

    it('returns false for primitives, null, undefined', () => {
        expect(isGlobalChatServiceError(null)).toBe(false);
        expect(isGlobalChatServiceError(undefined)).toBe(false);
        expect(isGlobalChatServiceError('string error')).toBe(false);
        expect(isGlobalChatServiceError(500)).toBe(false);
    });
});
