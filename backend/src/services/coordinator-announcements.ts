/**
 * Coordinator announcements: listing, creating, revoking, view-tracking.
 *
 * Extracted from `group-space.ts` to keep that file from growing unbounded.
 * Imports access-control + persistence helpers from `group-space.js`; that
 * module re-exports them publicly for this purpose. No circular dep:
 * `group-space.ts` does not import from this file.
 */
import { randomUUID } from 'crypto';
import type {
    CoordinatorAnnouncement,
    CoordinatorAnnouncementPriority,
    CoordinatorAnnouncementTargetMode,
    CoordinatorAnnouncementView,
} from '../types/group.js';
import {
    assertCanReadGroup,
    getEffectiveAccess,
    mapPgCoordinatorAnnouncement,
    normalizeCoordinatorAnnouncementTargetGroups,
    normalizeGroupKey,
    requireGroupSpacePostgres,
} from './group-space.js';
import {
    shimMirrorCreateCoordinatorAnnouncement,
    shimMirrorSoftDeleteCoordinatorAnnouncement,
} from './coordinator-announcement-shim.js';

export async function listCoordinatorAnnouncementsForAdmin(actorUserId: string): Promise<CoordinatorAnnouncementView[]> {
    const access = await getEffectiveAccess(actorUserId, null);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    return requireGroupSpacePostgres('listCoordinatorAnnouncementsForAdmin', async (client) => {
        const result = await client.query<{
            id: string;
            author_user_id: string;
            title: string;
            body: string;
            priority: CoordinatorAnnouncementPriority;
            target_mode: CoordinatorAnnouncementTargetMode;
            target_groups_json: string[] | null;
            expires_at: Date | null;
            revoked_at: Date | null;
            created_at: Date;
            updated_at: Date;
            view_count: number | null;
        }>(
            `
                select
                    a.id,
                    a.author_user_id,
                    a.title,
                    a.body,
                    a.priority,
                    a.target_mode,
                    a.target_groups_json,
                    a.expires_at,
                    a.revoked_at,
                    a.created_at,
                    a.updated_at,
                    count(v.user_id)::int as view_count
                from app_coordinator_announcements a
                left join app_coordinator_announcement_views v on v.announcement_id = a.id
                group by a.id
                order by a.created_at desc
            `,
        );
        return result.rows.map(mapPgCoordinatorAnnouncement);
    });
}

export async function listCoordinatorAnnouncementsForGroup(
    actorUserId: string,
    groupKey: string,
): Promise<CoordinatorAnnouncementView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listCoordinatorAnnouncementsForGroup', async (client) => {
        const result = await client.query<{
            id: string;
            author_user_id: string;
            title: string;
            body: string;
            priority: CoordinatorAnnouncementPriority;
            target_mode: CoordinatorAnnouncementTargetMode;
            target_groups_json: string[] | null;
            expires_at: Date | null;
            revoked_at: Date | null;
            created_at: Date;
            updated_at: Date;
            view_count: number | null;
            viewed_at: Date | null;
        }>(
            `
                select
                    a.id,
                    a.author_user_id,
                    a.title,
                    a.body,
                    a.priority,
                    a.target_mode,
                    a.target_groups_json,
                    a.expires_at,
                    a.revoked_at,
                    a.created_at,
                    a.updated_at,
                    count(v.user_id)::int as view_count,
                    max(case when v.user_id = $2 then v.viewed_at end) as viewed_at
                from app_coordinator_announcements a
                left join app_coordinator_announcement_views v on v.announcement_id = a.id
                where a.revoked_at is null
                  and (a.expires_at is null or a.expires_at > now())
                  and (
                    a.target_mode = 'all_starostas'
                    or a.target_groups_json @> to_jsonb(array[$1]::text[])
                  )
                group by a.id
                order by
                    case a.priority when 'critical' then 0 when 'warning' then 1 else 2 end,
                    a.created_at desc
            `,
            [normalizedGroupKey, actorUserId],
        );
        return result.rows.map(mapPgCoordinatorAnnouncement);
    });
}

export async function createCoordinatorAnnouncement(params: {
    actorUserId: string;
    title: string;
    body: string;
    priority: CoordinatorAnnouncementPriority;
    targetMode: CoordinatorAnnouncementTargetMode;
    targetGroups?: string[];
    expiresAt?: Date | null;
}): Promise<CoordinatorAnnouncement> {
    const access = await getEffectiveAccess(params.actorUserId, null);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    const title = params.title.trim();
    const body = params.body.trim();
    if (!title || !body) {
        throw new Error('Title and body are required');
    }

    const targetGroups = params.targetMode === 'groups'
        ? normalizeCoordinatorAnnouncementTargetGroups(params.targetGroups || [])
        : [];
    if (params.targetMode === 'groups' && targetGroups.length === 0) {
        throw new Error('At least one target group is required');
    }

    const created = await requireGroupSpacePostgres('createCoordinatorAnnouncement', async (client) => {
        const now = new Date();
        const id = randomUUID();
        const result = await client.query<{
            id: string;
            author_user_id: string;
            title: string;
            body: string;
            priority: CoordinatorAnnouncementPriority;
            target_mode: CoordinatorAnnouncementTargetMode;
            target_groups_json: string[] | null;
            expires_at: Date | null;
            revoked_at: Date | null;
            created_at: Date;
            updated_at: Date;
        }>(
            `
                insert into app_coordinator_announcements (
                    id,
                    author_user_id,
                    title,
                    body,
                    priority,
                    target_mode,
                    target_groups_json,
                    expires_at,
                    revoked_at,
                    created_at,
                    updated_at
                )
                values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, null, $9, $10)
                returning
                    id,
                    author_user_id,
                    title,
                    body,
                    priority,
                    target_mode,
                    target_groups_json,
                    expires_at,
                    revoked_at,
                    created_at,
                    updated_at
            `,
            [
                id,
                params.actorUserId,
                title,
                body,
                params.priority,
                params.targetMode,
                JSON.stringify(targetGroups),
                params.expiresAt ?? null,
                now,
                now,
            ],
        );
        const row = result.rows[0];
        return {
            id: row.id,
            authorUserId: row.author_user_id,
            title: row.title,
            body: row.body,
            priority: row.priority,
            targetMode: row.target_mode,
            targetGroups: Array.isArray(row.target_groups_json) ? row.target_groups_json : [],
            expiresAt: row.expires_at ? new Date(row.expires_at) : null,
            revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    });

    // Phase 1c dual-write: mirror into app_social_entity (kind='announcement').
    // Non-fatal — legacy write above already succeeded. The new store keeps a
    // global scope (`announcement:global`); per-group fan-out is encoded in
    // payload.targetGroups (absent when target_mode === 'all_starostas').
    await shimMirrorCreateCoordinatorAnnouncement({
        legacyId: created.id,
        authorUserId: created.authorUserId,
        title: created.title,
        body: created.body,
        priority: created.priority,
        targetGroups: created.targetMode === 'groups' ? created.targetGroups : null,
        expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
    });

    return created;
}

export async function revokeCoordinatorAnnouncement(params: {
    actorUserId: string;
    announcementId: string;
}): Promise<boolean> {
    const access = await getEffectiveAccess(params.actorUserId, null);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    const { revoked, authorUserId } = await requireGroupSpacePostgres(
        'revokeCoordinatorAnnouncement',
        async (client) => {
            // Capture the author so the dual-write mirror can pass it to the
            // social-store's owner-only soft-delete. Legacy revoke is open to
            // any coordinator/curator, but the mirror entity is owned by the
            // original author.
            const result = await client.query<{ author_user_id: string }>(
                `
                    update app_coordinator_announcements
                    set revoked_at = now(), updated_at = now()
                    where id = $1 and revoked_at is null
                    returning author_user_id
                `,
                [params.announcementId],
            );
            const row = result.rows[0];
            return {
                revoked: Boolean(result.rowCount && result.rowCount > 0),
                authorUserId: row?.author_user_id ?? null,
            };
        },
    );

    // Phase 1c dual-write: mirror legacy revoke as a soft-delete on the social
    // entity. Actor must equal the entity author (owner-only check inside the
    // social service); use the stored author. Skipped when the update was a
    // no-op (already revoked) or when the row had no recorded author.
    if (revoked && authorUserId) {
        await shimMirrorSoftDeleteCoordinatorAnnouncement({
            legacyId: params.announcementId,
            actorUserId: authorUserId,
        });
    }

    return revoked;
}

export async function markCoordinatorAnnouncementViewed(params: {
    actorUserId: string;
    announcementId: string;
    groupKey: string;
}): Promise<void> {
    const normalizedGroupKey = normalizeGroupKey(params.groupKey);
    await assertCanReadGroup(params.actorUserId, normalizedGroupKey);

    await requireGroupSpacePostgres('markCoordinatorAnnouncementViewed', async (client) => {
        const visible = await client.query<{ id: string }>(
            `
                select id
                from app_coordinator_announcements
                where id = $1
                  and revoked_at is null
                  and (expires_at is null or expires_at > now())
                  and (
                    target_mode = 'all_starostas'
                    or target_groups_json @> to_jsonb(array[$2]::text[])
                  )
                limit 1
            `,
            [params.announcementId, normalizedGroupKey],
        );
        if (!visible.rows[0]) {
            return;
        }

        await client.query(
            `
                insert into app_coordinator_announcement_views (announcement_id, user_id, viewed_at)
                values ($1, $2, now())
                on conflict (announcement_id, user_id) do nothing
            `,
            [params.announcementId, params.actorUserId],
        );
    });
}
