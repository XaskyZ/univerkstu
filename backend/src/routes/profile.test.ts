import { describe, it, expect } from 'vitest';
import { hasRichProfileCache } from './profile.js';

describe('hasRichProfileCache', () => {
    // Decides whether the cached profile blob is "complete enough" to return as-is
    // OR whether we need a fresh fetch from KSTU. All 5 sub-objects must be present
    // AND non-null:
    //   - profile.questionnaire (truthy check, not just hasOwnProperty)
    //   - transcript
    //   - recbook
    //   - practice
    //   - advisor
    //
    // Each is an independent fetch, so a regression that flips ANY check could send
    // hundreds of redundant requests to KSTU on every cache hit.

    const fullCache = () => ({
        profile: { questionnaire: { summary: {} } },
        transcript: { summary: {} },
        recbook: { summary: {} },
        practice: [],
        advisor: { name: 'A' },
    });

    it('returns true when all 5 fields are set', () => {
        expect(hasRichProfileCache(fullCache())).toBe(true);
    });

    it('returns false when profile.questionnaire is missing', () => {
        const cached = fullCache();
        // @ts-expect-error - intentionally setting to null
        cached.profile.questionnaire = null;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when profile is missing entirely', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.profile;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when transcript is null', () => {
        const cached = fullCache();
        // @ts-expect-error
        cached.transcript = null;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when transcript is undefined', () => {
        const cached = fullCache();
        // @ts-expect-error
        cached.transcript = undefined;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when transcript key is missing entirely (hasOwnProperty fails)', () => {
        // The function uses Object.prototype.hasOwnProperty.call — locks in the
        // contract that a key simply not appearing is also a "miss" (not just null).
        const cached = fullCache();
        // @ts-expect-error
        delete cached.transcript;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when recbook is missing', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.recbook;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when practice is missing', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.practice;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when advisor is missing', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.advisor;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('empty array IS considered present (truthy after null/undefined checks)', () => {
        // A student who hasn't done any practice yet would have practice=[] — that's
        // still "complete data", not "missing data". Lock this in so a future
        // refactor doesn't accidentally treat empty-array as missing.
        const cached = fullCache();
        cached.practice = [];
        expect(hasRichProfileCache(cached)).toBe(true);
    });

    it('returns false for null/undefined/non-object input', () => {
        expect(hasRichProfileCache(null)).toBe(false);
        expect(hasRichProfileCache(undefined)).toBe(false);
        expect(hasRichProfileCache({})).toBe(false);
    });
});
