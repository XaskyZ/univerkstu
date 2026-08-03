import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import {
    createAnnouncementUnified,
    pinAnnouncementUnified,
    priorityToLegacy,
    restoreAnnouncementUnified,
    revokeAnnouncementUnified,
    type SocialAnnouncementActionDeps,
} from './social-announcement-actions';

// Unit tests for the unified write-path wrappers. Each test injects fakes via
// the `deps` argument (the repo convention — see
// `social-feed-actions.test.ts`). No `vi.mock` ESM intercepts; the wrappers
// expose every API binding as an explicit dep so fakes are first-class.

function ok<T>(data?: T): ApiResponse<T> {
    return { success: true, data: data as T };
}

describe('priorityToLegacy', () => {
    it("maps 'low' → 'info' (the shim's reverse direction)", () => {
        expect(priorityToLegacy('low')).toBe('info');
    });

    it("collapses 'medium' and 'high' to 'warning' (lossy bridge)", () => {
        // The legacy enum has three levels; the social union has four. We
        // collapse the middle two so any social priority can flow through
        // the legacy endpoint. The round-trip is documented as lossy in
        // `social-announcement-actions.ts`.
        expect(priorityToLegacy('medium')).toBe('warning');
        expect(priorityToLegacy('high')).toBe('warning');
    });

    it("passes 'critical' through unchanged (shared enum member)", () => {
        expect(priorityToLegacy('critical')).toBe('critical');
    });
});

describe('createAnnouncementUnified', () => {
    it('beta path: creates an announcement-kind entity in announcement:global scope', async () => {
        // Locks the shape passed into the universal store. A regression that
        // accidentally dropped `scopeType`/`scopeId` would silently land
        // announcements in an unrelated scope and they would never appear
        // in the global announcement feed.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-ann-1' }));
        const deps: SocialAnnouncementActionDeps = { createSocialEntity };
        const result = await createAnnouncementUnified(
            { title: 'Maintenance', body: 'Down at 22:00', priority: 'high' },
            true,
            deps,
        );
        expect(result.success).toBe(true);
        expect(createSocialEntity).toHaveBeenCalledTimes(1);
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:global',
            payload: { title: 'Maintenance', body: 'Down at 22:00', priority: 'high' },
        });
    });

    it('beta path: includes targetGroups + expiresAt in payload when provided', async () => {
        // The shim writes both fields into the social payload when present;
        // the create wrapper must mirror that so the round-trip read sees
        // the same shape.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-ann-2' }));
        await createAnnouncementUnified(
            {
                title: 'T',
                body: 'B',
                priority: 'critical',
                targetGroups: ['ITS-21', 'CSE-22'],
                expiresAt: '2026-03-01T00:00:00Z',
            },
            true,
            { createSocialEntity },
        );
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:global',
            payload: {
                title: 'T',
                body: 'B',
                priority: 'critical',
                targetGroups: ['ITS-21', 'CSE-22'],
                expiresAt: '2026-03-01T00:00:00Z',
            },
        });
    });

    it('beta path: omits targetGroups from payload when array is empty (broadcast)', async () => {
        // Empty array means broadcast — we must not write the field at all so
        // the read adapter can preserve the broadcast signal.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-ann-3' }));
        await createAnnouncementUnified(
            { title: 'T', body: 'B', priority: 'low', targetGroups: [] },
            true,
            { createSocialEntity },
        );
        const [args] = createSocialEntity.mock.calls[0] as [{ payload: Record<string, unknown> }];
        expect(args.payload.targetGroups).toBeUndefined();
    });

    it('legacy path: posts (title, body, priority, targetMode=all_starostas, ...) when targetGroups omitted', async () => {
        // Verifies the legacy wire shape: when no targetGroups are given the
        // wrapper infers `targetMode='all_starostas'` and sends an empty
        // targetGroups array (matches the existing CoordinatorPage submit).
        const createAdminCoordinatorAnnouncement = vi.fn().mockResolvedValue(ok({ id: 'legacy-ann-1' }));
        await createAnnouncementUnified(
            { title: 'L', body: 'BL', priority: 'medium' },
            false,
            { createAdminCoordinatorAnnouncement },
        );
        expect(createAdminCoordinatorAnnouncement).toHaveBeenCalledTimes(1);
        expect(createAdminCoordinatorAnnouncement).toHaveBeenCalledWith({
            title: 'L',
            body: 'BL',
            priority: 'warning', // medium → warning via priorityToLegacy
            targetMode: 'all_starostas',
            targetGroups: [],
            expiresAt: null,
        });
    });

    it('legacy path: infers targetMode=groups when targetGroups is non-empty', async () => {
        // The legacy admin endpoint requires the explicit targetMode flag —
        // we derive it from the array presence so callers don't have to
        // duplicate the rule.
        const createAdminCoordinatorAnnouncement = vi.fn().mockResolvedValue(ok({ id: 'legacy-ann-2' }));
        await createAnnouncementUnified(
            {
                title: 'L',
                body: 'BL',
                priority: 'critical',
                targetGroups: ['ITS-21'],
                expiresAt: '2026-04-01T00:00:00Z',
            },
            false,
            { createAdminCoordinatorAnnouncement },
        );
        expect(createAdminCoordinatorAnnouncement).toHaveBeenCalledWith({
            title: 'L',
            body: 'BL',
            priority: 'critical',
            targetMode: 'groups',
            targetGroups: ['ITS-21'],
            expiresAt: '2026-04-01T00:00:00Z',
        });
    });
});

describe('revokeAnnouncementUnified', () => {
    it('beta path: calls deleteSocialEntity with the entity id', async () => {
        // Revoke is mapped to soft-delete on the universal entity (the shim
        // already chose this mapping; we mirror it for the direct write path).
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await revokeAnnouncementUnified('social-ann-9', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('social-ann-9');
    });

    it('legacy path: calls revokeAdminCoordinatorAnnouncement with the legacy id', async () => {
        const revokeAdminCoordinatorAnnouncement = vi.fn().mockResolvedValue(ok({ revoked: true }));
        await revokeAnnouncementUnified('legacy-ann-9', false, { revokeAdminCoordinatorAnnouncement });
        expect(revokeAdminCoordinatorAnnouncement).toHaveBeenCalledWith('legacy-ann-9');
    });
});

describe('restoreAnnouncementUnified', () => {
    it('beta path: calls restoreSocialEntity with the entity id', async () => {
        // Restore exists only in the universal store; verify we exercise the
        // dedicated endpoint instead of papering over it.
        const restoreSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await restoreAnnouncementUnified('social-ann-10', true, { restoreSocialEntity });
        expect(restoreSocialEntity).toHaveBeenCalledWith('social-ann-10');
    });

    it('legacy path: returns ANNOUNCEMENT_RESTORE_LEGACY_UNSUPPORTED non-success', async () => {
        // Legacy admin route layer has no un-revoke operation — confirm we
        // expose the limitation as an error rather than a silent no-op.
        const result = await restoreAnnouncementUnified('legacy-ann-10', false);
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('ANNOUNCEMENT_RESTORE_LEGACY_UNSUPPORTED');
        expect(typeof result.error).toBe('string');
    });
});

describe('pinAnnouncementUnified', () => {
    it('beta path: calls pinSocialEntity with (id, pinned=true)', async () => {
        const pinSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await pinAnnouncementUnified('social-ann-11', true, true, { pinSocialEntity });
        expect(pinSocialEntity).toHaveBeenCalledWith('social-ann-11', true);
    });

    it('beta path: forwards pinned=false for unpin', async () => {
        // Same endpoint handles unpin via the flag — make sure we don't
        // accidentally hard-code `true`.
        const pinSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await pinAnnouncementUnified('social-ann-12', false, true, { pinSocialEntity });
        expect(pinSocialEntity).toHaveBeenCalledWith('social-ann-12', false);
    });

    it('legacy path: returns ANNOUNCEMENT_PIN_LEGACY_UNSUPPORTED non-success', async () => {
        // Legacy admin route has no pin semantics for announcements — confirm
        // the wrapper exposes the limitation as a structured error so the UI
        // can hide the pin button (rather than firing a silent no-op).
        const result = await pinAnnouncementUnified('legacy-ann-11', true, false);
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('ANNOUNCEMENT_PIN_LEGACY_UNSUPPORTED');
        expect(typeof result.error).toBe('string');
    });
});
