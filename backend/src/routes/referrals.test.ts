import { describe, it, expect } from 'vitest';
import { mapClaimError } from './referrals.js';

describe('mapClaimError', () => {
    // Maps the referral-claim service result to (HTTP status, Russian user message).
    // Called only in the error path — 'applied' (success) shouldn't reach this
    // function, but if it does, the default branch produces a 500 (which is
    // technically wrong for "applied" but never observable since the route checks
    // for success before mapping).

    it('"invalid" → 400 with not-found message', () => {
        const result = mapClaimError('invalid');
        expect(result).toEqual({
            statusCode: 400,
            error: 'Реферальный код не найден',
        });
    });

    it('"self" → 400 with self-referral message', () => {
        const result = mapClaimError('self');
        expect(result.statusCode).toBe(400);
        expect(result.error).toContain('собственный');
    });

    it('"already_claimed" → 409 (Conflict — not 400)', () => {
        // 409 is intentional: distinguishes "you already have a referral inviter"
        // from validation errors. Frontend handles 409 differently (informational toast)
        // vs 400 (form error).
        const result = mapClaimError('already_claimed');
        expect(result.statusCode).toBe(409);
        expect(result.error).toContain('уже закреплён');
    });

    it('"claim_window_expired" → 409 with window-expiry message', () => {
        // 7-day window from account creation (see services/referrals.ts:canStillClaimReferral).
        // After expiry, manual code entry is blocked. 409 (not 400) so the frontend
        // can show a specific message about the window having closed.
        const result = mapClaimError('claim_window_expired');
        expect(result.statusCode).toBe(409);
        expect(result.error).toContain('ограниченного времени');
    });

    it('unknown status (including "applied") → 500 fallback', () => {
        // 'applied' shouldn't reach this function in practice — the route only calls
        // mapClaimError when the result is NOT 'applied'. But document the fallback
        // behavior so a future refactor that accidentally maps 'applied' is caught.
        const result = mapClaimError('applied');
        expect(result.statusCode).toBe(500);
        expect(result.error).toBe('Не удалось обработать реферальный код');
    });

    it('locks in the 4-named-status contract', () => {
        // Regression guard: if a new status is added to claimReferralCode without
        // updating mapClaimError, the new status falls through to 500.
        const statuses = ['invalid', 'self', 'already_claimed', 'claim_window_expired'] as const;
        for (const status of statuses) {
            const result = mapClaimError(status);
            // Each named status produces a non-500 mapping (real user message).
            expect(result.statusCode).toBeLessThan(500);
        }
    });

    it('every error message is non-empty Russian text (no leakage of internal status to users)', () => {
        // Regression guard against accidentally exposing snake_case status codes
        // like "already_claimed" in user-facing text.
        const statuses = ['invalid', 'self', 'already_claimed', 'claim_window_expired'] as const;
        for (const status of statuses) {
            const result = mapClaimError(status);
            expect(result.error).not.toBe(status);
            expect(result.error.length).toBeGreaterThan(10); // sanity
        }
    });
});
