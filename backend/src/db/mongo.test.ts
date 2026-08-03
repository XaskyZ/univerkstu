import { describe, it, expect } from 'vitest';
import { MongoServerError } from 'mongodb';
import { isAtlasQuotaExceededError } from './mongo.js';

describe('isAtlasQuotaExceededError', () => {
    // Detects the specific Atlas "you exceeded your free-tier 512 MB space" error
    // so connectDB can downgrade gracefully (skip index sync, keep serving traffic
    // from existing data) instead of crashing the boot. Every catch block that
    // tolerates Atlas going down uses this — wrong detection = crash on every
    // start when the cluster is full.

    // Helper to fabricate a MongoServerError without an open connection.
    const makeMongoErr = (code: number | undefined, message: string): MongoServerError => {
        // MongoServerError constructor takes a plain object with at least { message }.
        // It surfaces `code` via the spreadable `Object.assign` on the error instance.
        const err = new MongoServerError({ message } as unknown as never);
        if (code !== undefined) {
            (err as unknown as { code: number }).code = code;
        }
        return err;
    };

    it('returns true when code=8000 AND message contains "space quota"', () => {
        // Both signals must be present — code 8000 alone or "space quota" message alone
        // are NOT sufficient (because code 8000 is a generic AtlasError and the
        // specific "space quota" phrase is what disambiguates).
        const err = makeMongoErr(8000, 'you have exceeded your space quota');
        expect(isAtlasQuotaExceededError(err)).toBe(true);
    });

    it('case-insensitive on the "space quota" substring', () => {
        // The function lowercases the message before checking, so any case works.
        const err = makeMongoErr(8000, 'Atlas: SPACE QUOTA exceeded for free tier');
        expect(isAtlasQuotaExceededError(err)).toBe(true);
    });

    it('returns false when code is not 8000 even if message says "space quota"', () => {
        // Documents the AND-condition: both signals required.
        const err = makeMongoErr(13, 'some space quota issue');
        expect(isAtlasQuotaExceededError(err)).toBe(false);
    });

    it('returns false when code is 8000 but message lacks "space quota"', () => {
        // Code 8000 is generic AtlasError — used for many things. Only the message
        // disambiguates this specific quota condition.
        const err = makeMongoErr(8000, 'some other Atlas error');
        expect(isAtlasQuotaExceededError(err)).toBe(false);
    });

    it('returns false for non-MongoServerError instances', () => {
        // instanceof check is the gate — plain Error doesn't qualify.
        expect(isAtlasQuotaExceededError(new Error('space quota exceeded'))).toBe(false);
    });

    it('returns false for plain objects (even with code+message)', () => {
        // Defense against duck-typing: a fake error object with the right shape
        // should NOT be classified as a real MongoServerError.
        expect(isAtlasQuotaExceededError({ code: 8000, message: 'space quota' })).toBe(false);
    });

    it('returns false for null/undefined/non-object inputs', () => {
        expect(isAtlasQuotaExceededError(null)).toBe(false);
        expect(isAtlasQuotaExceededError(undefined)).toBe(false);
        expect(isAtlasQuotaExceededError('space quota')).toBe(false);
        expect(isAtlasQuotaExceededError(8000)).toBe(false);
    });

    it('returns false when message is non-string (defensive)', () => {
        const err = makeMongoErr(8000, 'placeholder');
        (err as unknown as { message: unknown }).message = 42;
        expect(isAtlasQuotaExceededError(err)).toBe(false);
    });
});
