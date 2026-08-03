import { describe, it, expect } from 'vitest';
import { isMessagingServiceError } from './messaging.js';

describe('isMessagingServiceError', () => {
    // Type guard used by every messaging route catch-block to decide whether
    // to forward the service's structured (statusCode + code + message) error
    // or return a generic 500. Identical shape to the global-chat version
    // (fire 160) — separate copies on purpose so divergence is caught explicitly
    // and the contract is locked in for both surfaces independently.

    it('returns true for typed service-error shape', () => {
        const err = Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'forbidden' });
        expect(isMessagingServiceError(err)).toBe(true);
    });

    it('returns true for duck-typed plain object (not just Error instances)', () => {
        const fakeErr = { statusCode: 429, code: 'rate_limited', message: 'too many' };
        expect(isMessagingServiceError(fakeErr)).toBe(true);
    });

    it('returns false for plain Error without statusCode/code', () => {
        expect(isMessagingServiceError(new Error('boom'))).toBe(false);
    });

    it('returns false when statusCode is not a number', () => {
        const err = Object.assign(new Error(), { statusCode: '500', code: 'x' });
        expect(isMessagingServiceError(err)).toBe(false);
    });

    it('returns false when code is not a string', () => {
        const err = Object.assign(new Error(), { statusCode: 500, code: 1 });
        expect(isMessagingServiceError(err)).toBe(false);
    });

    it('returns false when statusCode is missing', () => {
        expect(isMessagingServiceError(Object.assign(new Error(), { code: 'x' }))).toBe(false);
    });

    it('returns false when code is missing', () => {
        expect(isMessagingServiceError(Object.assign(new Error(), { statusCode: 500 }))).toBe(false);
    });

    it('returns false for primitives + null + undefined', () => {
        expect(isMessagingServiceError(null)).toBe(false);
        expect(isMessagingServiceError(undefined)).toBe(false);
        expect(isMessagingServiceError('error string')).toBe(false);
        expect(isMessagingServiceError(500)).toBe(false);
        expect(isMessagingServiceError(true)).toBe(false);
    });
});
