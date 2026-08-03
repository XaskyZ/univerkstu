/**
 * Unified write-path wrappers for the coordinator-announcement POC.
 *
 * Each function decides — based on the `useSocialBeta` flag the caller passes
 * in — whether to write through the **legacy** admin coordinator-announcement
 * API (`/api/v3/admin/coordinator-announcements/*`, Phase 1c shim mirrors the
 * change into `app_social_entity` server-side) or **directly** through the
 * universal social store (`/api/v3/social/*`). This validates that the
 * universal store can serve the write path end-to-end while the legacy
 * table is still source of truth for everything else.
 *
 * Boundaries:
 *  - Wrappers are pure: the flag is an argument, not a global lookup. Lets
 *    callers (and tests) flip it without re-rendering React state.
 *  - APIs are injected via the second-to-last `deps` argument so tests can
 *    pass fakes instead of monkey-patching ESM bindings (the repo
 *    convention — see `social-feed-actions.ts`).
 *  - Returned envelope is `ApiResponse<unknown>` — handlers downstream only
 *    branch on `success` + `error`; reusing the legacy shape avoids changing
 *    `CoordinatorPage` error / refresh logic.
 *
 * **ID mapping rule** when `useSocialBeta` is on:
 *  - `announcementId` is the **`app_social_entity.id`** (uuid). The read
 *    path (`useAnnouncementsSocial`) surfaces the universal entity directly,
 *    so any id flowing back into the revoke / restore / pin handlers is the
 *    social id, not the legacy `app_coordinator_announcements.id`.
 *  - Conversely, when `useSocialBeta` is off, `announcementId` is the legacy
 *    id — matches the existing admin-API contract.
 *
 * **Priority enum bridging**: the `AnnouncementInput.priority` is in the
 * social-store union (`'low' | 'medium' | 'high' | 'critical'`). The legacy
 * admin endpoint accepts the legacy enum (`'info' | 'warning' | 'critical'`).
 * `priorityToLegacy` performs the reverse of `coercePriority` in
 * `backend/src/services/coordinator-announcement-shim.ts` so a caller can
 * write through either path without knowing which enum is on the wire.
 *
 * **No update endpoint**: the legacy admin route layer exposes no
 * "update announcement" operation (see header docs of the backend shim — the
 * update helper is deliberately omitted there too). We mirror that here:
 * there is no `updateAnnouncementUnified`. Edits would mean revoke + recreate
 * in legacy mode.
 *
 * **Restore + pin in legacy mode**: the legacy admin route layer has no
 * un-revoke and no pin endpoints. `restoreAnnouncementUnified` and
 * `pinAnnouncementUnified` therefore return a non-fatal `ApiResponse`
 * failure with `errorCode` set when the flag is off. This matches the
 * `pinPostUnified` precedent: surfacing the limitation as an error keeps
 * callers honest instead of silently no-opping.
 */
import {
    createAdminCoordinatorAnnouncement as createAdminCoordinatorAnnouncementLegacy,
    revokeAdminCoordinatorAnnouncement as revokeAdminCoordinatorAnnouncementLegacy,
} from '@/lib/api/admin';
import type { ApiResponse } from '@/lib/api/core';
import {
    createSocialEntity as createSocialEntityDefault,
    deleteSocialEntity as deleteSocialEntityDefault,
    pinSocialEntity as pinSocialEntityDefault,
    restoreSocialEntity as restoreSocialEntityDefault,
} from '@/lib/api/social';
import type {
    CoordinatorAnnouncementPriority,
    CoordinatorAnnouncementTargetMode,
} from '@/lib/api';
import type { SocialAnnouncementPriority } from './social-entity-to-announcement';

// === Shared types ===========================================================

/**
 * Input shape for the unified create wrapper. Priority is the social-store
 * union — callers driving the legacy enum should coerce upstream.
 */
export interface AnnouncementInput {
    title: string;
    body: string;
    priority: SocialAnnouncementPriority;
    /**
     * When omitted (or empty), the announcement is treated as a broadcast to
     * all-starostas. When present, the legacy route layer infers
     * `targetMode='groups'` from the array and writes the target rows; the
     * social path writes the array verbatim into `payload.targetGroups`.
     */
    targetGroups?: string[];
    /** Optional ISO timestamp lifted into `payload.expiresAt`. */
    expiresAt?: string;
}

/**
 * Surface every API binding the wrappers need so tests can inject fakes
 * piecemeal without satisfying the entire shape every time.
 */
export interface SocialAnnouncementActionDeps {
    // social (universal store)
    createSocialEntity?: typeof createSocialEntityDefault;
    deleteSocialEntity?: typeof deleteSocialEntityDefault;
    restoreSocialEntity?: typeof restoreSocialEntityDefault;
    pinSocialEntity?: typeof pinSocialEntityDefault;
    // legacy (admin coordinator-announcement API)
    createAdminCoordinatorAnnouncement?: typeof createAdminCoordinatorAnnouncementLegacy;
    revokeAdminCoordinatorAnnouncement?: typeof revokeAdminCoordinatorAnnouncementLegacy;
}

// === Priority bridging ======================================================

/**
 * Reverse of the shim's `coercePriority` (backend). The social union has four
 * levels, the legacy union has three — we collapse `'low'` → `'info'`,
 * `'medium'|'high'` → `'warning'`, and `'critical'` straight through. The
 * round trip is lossy (`low` and `medium` both round-trip as `warning` if a
 * caller writes `medium` through legacy and then reads the social mirror via
 * the shim's forward map), but that's the price of keeping both enums alive
 * during cutover. Phase 1e drops the legacy enum entirely.
 */
export function priorityToLegacy(priority: SocialAnnouncementPriority): CoordinatorAnnouncementPriority {
    switch (priority) {
        case 'low':
            return 'info';
        case 'medium':
        case 'high':
            return 'warning';
        case 'critical':
            return 'critical';
        default:
            // Exhaustive — TS narrows the union, but a hand-built priority can
            // still leak through here. Default to the safest middle ground.
            return 'warning';
    }
}

// === Helpers ================================================================

/**
 * Build the social-entity payload from an `AnnouncementInput`. Drops
 * `undefined` fields so the backend AJV validator does not reject the body
 * for explicit-undefined keys (it accepts missing keys but not
 * `key: undefined` once stringified).
 */
function buildAnnouncementPayload(input: AnnouncementInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        title: input.title,
        body: input.body,
        priority: input.priority,
    };
    if (Array.isArray(input.targetGroups) && input.targetGroups.length > 0) {
        payload.targetGroups = input.targetGroups;
    }
    if (typeof input.expiresAt === 'string' && input.expiresAt) {
        payload.expiresAt = input.expiresAt;
    }
    return payload;
}

// === Create =================================================================

/**
 * `createAnnouncementUnified` — beta path POSTs an `announcement`-kind entity
 * into the social store under `announcement:global`; legacy path calls the
 * existing admin endpoint, deriving `targetMode` from the presence of
 * `targetGroups` (matching the legacy contract).
 */
export async function createAnnouncementUnified(
    input: AnnouncementInput,
    useSocialBeta: boolean,
    deps: SocialAnnouncementActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const createSocial = deps.createSocialEntity ?? createSocialEntityDefault;
        return createSocial({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:global',
            payload: buildAnnouncementPayload(input),
        });
    }
    const createLegacy = deps.createAdminCoordinatorAnnouncement ?? createAdminCoordinatorAnnouncementLegacy;
    const hasTargetGroups = Array.isArray(input.targetGroups) && input.targetGroups.length > 0;
    const targetMode: CoordinatorAnnouncementTargetMode = hasTargetGroups ? 'groups' : 'all_starostas';
    return createLegacy({
        title: input.title,
        body: input.body,
        priority: priorityToLegacy(input.priority),
        targetMode,
        targetGroups: hasTargetGroups ? input.targetGroups : [],
        expiresAt: input.expiresAt ?? null,
    });
}

// === Revoke (soft-delete) ===================================================

/**
 * `revokeAnnouncementUnified` — soft-delete in both modes. The legacy admin
 * route writes `revoked_at`; the social route writes `deleted_at` (the same
 * tombstone, just renamed across the two layers — the adapter aliases them).
 */
export async function revokeAnnouncementUnified(
    announcementId: string,
    useSocialBeta: boolean,
    deps: SocialAnnouncementActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(announcementId);
    }
    const revokeLegacy = deps.revokeAdminCoordinatorAnnouncement ?? revokeAdminCoordinatorAnnouncementLegacy;
    return revokeLegacy(announcementId);
}

// === Restore ================================================================

/**
 * `restoreAnnouncementUnified` — beta path POSTs to the universal restore
 * endpoint. The legacy admin route layer has no un-revoke operation, so when
 * the beta flag is off we return a non-fatal `ApiResponse` failure with an
 * explanatory error and the `ANNOUNCEMENT_RESTORE_LEGACY_UNSUPPORTED` code.
 * Callers can branch on the code if they want to hide the restore button
 * entirely in legacy mode.
 */
export async function restoreAnnouncementUnified(
    announcementId: string,
    useSocialBeta: boolean,
    deps: SocialAnnouncementActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const restoreSocial = deps.restoreSocialEntity ?? restoreSocialEntityDefault;
        return restoreSocial(announcementId);
    }
    return {
        success: false,
        error: 'Restoring revoked announcements is only available on the social-beta path; the legacy admin API has no un-revoke endpoint.',
        errorCode: 'ANNOUNCEMENT_RESTORE_LEGACY_UNSUPPORTED',
    };
}

// === Pin / unpin ============================================================

/**
 * `pinAnnouncementUnified` — beta path hits the dedicated `/pin` endpoint;
 * legacy has no pin semantics for announcements, so we return a non-fatal
 * `ApiResponse` failure with `ANNOUNCEMENT_PIN_LEGACY_UNSUPPORTED`. Matches
 * the `pinPostUnified` precedent — surfacing the limitation as an error
 * keeps callers honest if they wire a pin toggle while the flag is off.
 */
export async function pinAnnouncementUnified(
    announcementId: string,
    pinned: boolean,
    useSocialBeta: boolean,
    deps: SocialAnnouncementActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const pinSocial = deps.pinSocialEntity ?? pinSocialEntityDefault;
        return pinSocial(announcementId, pinned);
    }
    return {
        success: false,
        error: 'Pinning announcements is only available on the social-beta path; the legacy admin API has no pin endpoint.',
        errorCode: 'ANNOUNCEMENT_PIN_LEGACY_UNSUPPORTED',
    };
}
