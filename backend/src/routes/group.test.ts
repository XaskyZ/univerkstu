import { describe, it, expect } from 'vitest';
import { toClientError, buildUnavailableGroupSpace } from './group.js';

describe('toClientError', () => {
    // Maps service-layer errors to HTTP responses for every group/* endpoint.
    // A regression here silently flips a 403 Forbidden into a 400 Bad Request
    // (or vice versa), which changes how the frontend handles the error state.

    it('returns 403 when the error message contains "Forbidden"', () => {
        const result = toClientError(new Error('Forbidden: not a member of this group'), 'fallback');
        expect(result).toEqual({ statusCode: 403, message: 'Forbidden: not a member of this group' });
    });

    it('returns 400 for non-Forbidden Error messages', () => {
        const result = toClientError(new Error('Invalid input'), 'fallback');
        expect(result).toEqual({ statusCode: 400, message: 'Invalid input' });
    });

    it('uses the fallback message when the error is not an Error instance', () => {
        const result = toClientError('plain string', 'Unknown group error');
        expect(result).toEqual({ statusCode: 400, message: 'Unknown group error' });
    });

    it('uses the fallback when given null/undefined', () => {
        expect(toClientError(null, 'fallback')).toEqual({ statusCode: 400, message: 'fallback' });
        expect(toClientError(undefined, 'fallback')).toEqual({ statusCode: 400, message: 'fallback' });
    });

    it('matches "Forbidden" anywhere in the message (substring, not prefix)', () => {
        // The check is `.includes('Forbidden')`, so a message like "Action Forbidden by role"
        // still routes to 403. This documents that behavior — if the substring match was ever
        // tightened to a prefix check, removal-of-this-test would catch it.
        const result = toClientError(new Error('Action: Forbidden by role assignment'), 'fallback');
        expect(result.statusCode).toBe(403);
    });

    it('is case-sensitive on "Forbidden" (lowercase "forbidden" is NOT a 403)', () => {
        // .includes is case-sensitive — service-layer errors must use uppercase "Forbidden".
        // Documents the contract for service-layer error messages.
        const result = toClientError(new Error('forbidden access'), 'fallback');
        expect(result.statusCode).toBe(400);
    });
});

describe('buildUnavailableGroupSpace', () => {
    // This is the default empty-shell GroupSpace returned when no group context applies.
    // The frontend renders the no-group state based on `available: false`; if any permission
    // accidentally defaulted to `true` here, a non-member could see manage-buttons.

    it('returns available=false', () => {
        expect(buildUnavailableGroupSpace('no group').available).toBe(false);
    });

    it('clears all manage-X permissions to false (load-bearing security default)', () => {
        const result = buildUnavailableGroupSpace('no group');
        expect(result.access.permissions).toEqual({
            canManageContent: false,
            canManageMembers: false,
            canManageHelpers: false,
            canAssignStarosta: false,
            canViewAudit: false,
        });
    });

    it('returns empty roles array', () => {
        expect(buildUnavailableGroupSpace('no group').access.roles).toEqual([]);
    });

    it('returns inactive membership with null source', () => {
        expect(buildUnavailableGroupSpace('no group').membership).toEqual({
            active: false,
            source: null,
        });
    });

    it('forwards the note string verbatim', () => {
        expect(buildUnavailableGroupSpace('User has no detected group').note).toBe('User has no detected group');
        expect(buildUnavailableGroupSpace('').note).toBe('');
    });

    it('returns null group reference', () => {
        expect(buildUnavailableGroupSpace('x').group).toBe(null);
    });
});
