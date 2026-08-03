/**
 * Phase 1c — backward-compatibility shim for coordinator announcements.
 *
 * Mirrors every legacy write into `app_coordinator_announcements` (via
 * services/coordinator-announcements.ts) into the universal `app_social_entity`
 * store under `kind='announcement'`. Legacy is still source-of-truth for reads;
 * the universal store is being populated in parallel so Phase 1d's read-flip
 * has no gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded. This is deliberate so
 * a bug in the universal layer cannot break production announcement writes.
 *
 * Legacy → payload mapping (kind='announcement'):
 *   - legacy `title`              → payload.title
 *   - legacy `body`               → payload.body
 *   - legacy `priority`           → payload.priority (coerced: info→low,
 *                                   warning→high, critical→critical, any
 *                                   unknown value → 'medium')
 *   - legacy `target_groups_json` → payload.targetGroups (only when present;
 *                                   target_mode='all_starostas' yields an
 *                                   undefined targetGroups in the payload —
 *                                   readers treat the absence as broadcast)
 *   - legacy `expires_at`         → payload.expiresAt (ISO string when set)
 *
 * Scope decision: announcements are global (not per-group) on the new store,
 * so we use scopeType='announcement' with the literal scopeId 'announcement:global'.
 * Per-group fan-out is encoded inside the payload via targetGroups — this keeps
 * the universal `(scope_type, scope_id)` index small while preserving the
 * targeting model. See docs/SOCIAL_STORE.md.
 *
 * Operations covered: create, soft-delete (legacy revoke), restore (Phase 1c
 * has no legacy un-revoke route, but the helper is kept for the Phase 1d
 * migration script), permanent-delete (no legacy hard-delete route either;
 * helper is kept symmetric with the other shims). The update helper is
 * deliberately omitted because announcements have no edit endpoint.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import type { SocialPayloadByKind } from '../types/social.js';
import {
    buildScopeId,
    createEntity,
    restoreEntity,
    softDeleteEntity,
} from './social.js';

type LegacyAnnouncementPriority = 'info' | 'warning' | 'critical' | string;
type SocialAnnouncementPriority = SocialPayloadByKind['announcement']['priority'];

const ANNOUNCEMENT_SCOPE_RAW = 'global';

async function fetchSocialEntityIdForLegacyAnnouncement(announcementId: string): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_entity_id: string | null }>(
            `select social_entity_id from app_coordinator_announcements where id = $1 limit 1`,
            [announcementId]
        );
        return rows.rows[0]?.social_entity_id ?? null;
    });
    return result ?? null;
}

async function persistSocialEntityIdOnLegacyAnnouncement(
    announcementId: string,
    socialEntityId: string,
): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_coordinator_announcements set social_entity_id = $2 where id = $1`,
            [announcementId, socialEntityId]
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for coordinator_announcements`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

/**
 * Map legacy priority strings to the universal-payload union.
 * The legacy column accepts 'info' | 'warning' | 'critical' (type
 * `CoordinatorAnnouncementPriority` in backend/src/types/group.ts). The new
 * social payload uses 'low' | 'medium' | 'high' | 'critical'. We normalise so
 * the data round-trips cleanly when readers eventually flip to the new store.
 * Any unknown legacy value falls back to 'medium' so the constraint at the
 * universal layer cannot reject the mirror write.
 */
export function coercePriority(legacy: LegacyAnnouncementPriority): SocialAnnouncementPriority {
    switch (legacy) {
        case 'info':
            return 'low';
        case 'warning':
            return 'high';
        case 'critical':
            return 'critical';
        case 'low':
        case 'medium':
        case 'high':
            return legacy;
        default:
            return 'medium';
    }
}

interface AnnouncementShimPayload {
    title: string;
    body: string;
    priority: SocialAnnouncementPriority;
    targetGroups?: string[];
    expiresAt?: string;
}

function buildPayload(args: {
    title: string;
    body: string;
    priority: LegacyAnnouncementPriority;
    targetGroups?: string[] | null;
    expiresAt?: string | null;
}): AnnouncementShimPayload {
    const payload: AnnouncementShimPayload = {
        title: args.title,
        body: args.body,
        priority: coercePriority(args.priority),
    };
    if (args.targetGroups && args.targetGroups.length > 0) {
        payload.targetGroups = args.targetGroups;
    }
    if (args.expiresAt) {
        payload.expiresAt = args.expiresAt;
    }
    return payload;
}

export async function shimMirrorCreateCoordinatorAnnouncement(args: {
    legacyId: string;
    authorUserId: string;
    title: string;
    body: string;
    priority: LegacyAnnouncementPriority;
    targetGroups?: string[] | null;
    expiresAt?: string | null;
}): Promise<void> {
    try {
        const entity = await createEntity({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: buildScopeId('announcement', ANNOUNCEMENT_SCOPE_RAW),
            authorUserId: args.authorUserId,
            payload: buildPayload(args),
        });
        await persistSocialEntityIdOnLegacyAnnouncement(args.legacyId, entity.id);
    } catch (error) {
        // Non-fatal: legacy write already succeeded; mirror is best-effort.
        logShimFailure('create', args.legacyId, error);
    }
}

/**
 * Soft-delete the mirror entity. Legacy revoke (sets `revoked_at`) maps here.
 */
export async function shimMirrorSoftDeleteCoordinatorAnnouncement(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyAnnouncement(args.legacyId);
        if (!socialId) return; // nothing to mirror
        await softDeleteEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('soft-delete', args.legacyId, error);
    }
}

/**
 * Restore the mirror entity. The legacy route layer does not currently expose
 * an un-revoke operation, but the helper is kept so the Phase 1d copy-write
 * migration can replay revisions cleanly if needed.
 */
export async function shimMirrorRestoreCoordinatorAnnouncement(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyAnnouncement(args.legacyId);
        if (!socialId) return;
        await restoreEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('restore', args.legacyId, error);
    }
}

// Permanent delete: we intentionally do NOT hard-delete the mirror entity.
// Leaving it soft-deleted preserves the audit trail in app_social_revision.
// The legacy coordinator-announcement route layer doesn't expose a
// permanent-delete operation either, but the helper is kept symmetric with the
// other shims for when that lands.
export async function shimMirrorPermanentDeleteCoordinatorAnnouncement(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyAnnouncement(args.legacyId);
        if (!socialId) return;
        await softDeleteEntity(socialId, args.actorUserId, 'permanent-delete');
    } catch (error) {
        logShimFailure('permanent-delete', args.legacyId, error);
    }
}
