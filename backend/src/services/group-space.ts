import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { getCachedData } from '../db/mongo.js';
import { userExists } from './users.js';
import {
    shimMirrorCreateGroupPost,
    shimMirrorUpdateGroupPost,
    shimMirrorSoftDeleteGroupPost,
    shimMirrorRestoreGroupPost,
    shimMirrorPermanentDeleteGroupPost,
} from './group-posts-shim.js';
import {
    shimMirrorCreateGroupTask,
    shimMirrorUpdateGroupTask,
    shimMirrorSoftDeleteGroupTask,
    shimMirrorRestoreGroupTask,
} from './group-tasks-shim.js';
import {
    shimMirrorCreateGroupExtraLesson,
    shimMirrorUpdateGroupExtraLesson,
    shimMirrorSoftDeleteGroupExtraLesson,
    shimMirrorRestoreGroupExtraLesson,
} from './group-extra-lessons-shim.js';
import type {
    CoordinatorAnnouncementPriority,
    CoordinatorAnnouncementTargetMode,
    CoordinatorAnnouncementView,
    CuratorStudentDetail,
    CuratorStudentSummary,
    GroupContentRevisionView,
    GroupContentType,
    EffectiveGroupAccess,
    EffectiveGroupPermissions,
    GroupCatalogItem,
    GroupExtraLessonView,
    GroupJoinRequestStatus,
    GroupJoinRequestView,
    GroupMembershipDisputeIssue,
    GroupMembershipDisputeStatus,
    GroupMembershipDisputeView,
    GroupMemberView,
    GroupMembership,
    GroupPostView,
    GroupTaskPriority,
    GroupTaskView,
    GroupUserSearchView,
    GroupRoleAssignment,
    GroupRoleAssignmentView,
    GroupRoleId,
    GroupScopeType,
    GroupSpace,
    GroupSpaceSummary,
    GroupSpaceMe,
} from '../types/group.js';

const GLOBAL_SCOPE_ID = 'global';

export function normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function toDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type AdminSnapshotLite = {
    fullName?: string | null;
    profileSummary?: {
        fullName?: string | null;
        specialty?: string | null;
        faculty?: string | null;
        course?: number | null;
        formOfEducation?: string | null;
        detectedGroupName?: string | null;
    } | null;
    attestationSummary?: {
        currentGPA?: number | null;
        currentYear?: string | null;
        creditsEarned?: number | null;
        gradesCount?: number | null;
        topSubjects?: Array<{
            subject?: string | null;
            total?: number | null;
            letterGrade?: string | null;
            gpa?: number | null;
        }> | null;
    } | null;
    iupSummary?: {
        semesters?: number | null;
        subjects?: number | null;
    } | null;
    platonus?: {
        connected?: boolean | null;
        active?: boolean | null;
        gpa?: number | null;
        login?: string | null;
        detectedGroupName?: string | null;
    } | null;
    umkd?: {
        cached?: boolean | null;
        cachedAt?: string | null;
        coursesCount?: number | null;
        filesCount?: number | null;
    } | null;
    analytics?: {
        online?: boolean | null;
        lastSeenAt?: string | null;
        totalSessions?: number | null;
    } | null;
    adminSnapshotMeta?: {
        dataFreshness?: {
            profile?: 'fresh' | 'stale' | 'missing';
            platonus?: 'fresh' | 'stale' | 'missing';
            umkd?: 'fresh' | 'stale' | 'missing';
            analytics?: 'fresh' | 'stale' | 'missing';
        } | null;
    } | null;
};

export async function requireGroupSpacePostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Group Space] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

function mapPgGroupSpace(row: {
    group_key: string;
    title: string;
    slug: string;
    created_at: Date;
    updated_at: Date;
}): GroupSpace {
    return {
        groupKey: row.group_key,
        title: row.title,
        slug: row.slug,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}

function mapPgMembership(row: {
    user_id: string;
    group_key: string;
    source: GroupMembership['source'];
    active: boolean;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    reason: string | null;
    removed_at: Date | null;
    removed_by: string | null;
    removal_reason: string | null;
}): GroupMembership {
    return {
        userId: row.user_id,
        groupKey: row.group_key,
        source: row.source,
        active: row.active,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        createdBy: row.created_by,
        reason: row.reason,
        removedAt: row.removed_at ? new Date(row.removed_at) : null,
        removedBy: row.removed_by,
        removalReason: row.removal_reason,
    };
}

function mapPgRoleAssignment(row: {
    user_id: string;
    role_id: GroupRoleId;
    scope_type: GroupScopeType;
    scope_id: string;
    active: boolean;
    assigned_by: string;
    created_at: Date;
    updated_at: Date;
    reason: string | null;
}): GroupRoleAssignment {
    return {
        userId: row.user_id,
        roleId: row.role_id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        active: row.active,
        assignedBy: row.assigned_by,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        reason: row.reason,
    };
}

function slugifyGroupName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'group';
}

export function normalizeSearchValue(value: string | null | undefined): string {
    return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeCoordinatorAnnouncementTargetGroups(groups: string[]): string[] {
    return Array.from(
        new Set(
            groups
                .map((group) => group.trim())
                .filter(Boolean)
                .map((group) => normalizeGroupKey(group))
        )
    );
}

export function buildUserSearchRegex(rawQuery: string): RegExp | null {
    const trimmed = rawQuery.trim();
    if (!trimmed) return null;
    // Always escape — пользовательский ввод не должен иметь regex-семантики.
    // Прошлая версия пыталась `new RegExp(trimmed)` без эскейпа, что давало ReDoS
    // на валидных но злонамеренных паттернах вроде `(a+)+b`.
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return new RegExp(escaped, 'i');
    } catch {
        return null;
    }
}

function getSmartUserSearchScore(user: { userId: string; fullName?: string | null }, rawQuery: string): number {
    const query = normalizeSearchValue(rawQuery);
    if (!query) return 0;

    const fullName = normalizeSearchValue(user.fullName);
    const login = normalizeSearchValue(user.userId);
    const composite = [fullName, login].filter(Boolean).join(' ');

    let score = 0;
    if (login === query) score += 1200;
    if (fullName === query) score += 1100;
    if (login.startsWith(query)) score += 800;
    if (fullName.startsWith(query)) score += 760;
    if (login.includes(query)) score += 520;
    if (fullName.includes(query)) score += 500;

    for (const token of query.split(/\s+/).filter(Boolean)) {
        if (fullName.includes(token)) score += 90;
        if (login.includes(token)) score += 85;
    }

    const regex = buildUserSearchRegex(rawQuery);
    if (regex) {
        if (regex.test(login)) score += 700;
        if (regex.test(fullName)) score += 680;
        if (regex.test(composite)) score += 220;
    }

    return score;
}

export function normalizeGroupKey(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

// Phase 1c — extra-lesson shim helper. Legacy stores `date` (timestamptz) and
// `start_time` / `end_time` as separate "HH:MM" strings; the universal store
// uses a single ISO `startsAt` / `endsAt`. Combine them by taking the calendar
// date in UTC plus the wall-clock time.
function combineLessonDateTime(date: Date, hhmm: string): string {
    const datePart = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const safeTime = /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : hhmm;
    return `${datePart}T${safeTime}.000Z`;
}

async function getLatestDetectedGroupName(userId: string): Promise<string | null> {
    return requireGroupSpacePostgres('getLatestDetectedGroupName', async (client) => {
        const result = await client.query<{ group_name: string | null }>(
            `
                select data_json #>> '{meta,groupName}' as group_name
                from app_platonus_grades_cache
                where user_id = $1
                  and nullif(data_json #>> '{meta,groupName}', '') is not null
                order by cached_at desc
                limit 1
            `,
            [userId]
        );
        const raw = result.rows[0]?.group_name?.trim();
        return raw && raw.length > 0 ? raw : null;
    });
}

async function getDetectedGroupKey(userId: string): Promise<string | null> {
    const groupName = await getLatestDetectedGroupName(userId);
    return groupName ? normalizeGroupKey(groupName) : null;
}

export async function ensureGroupSpace(groupName: string): Promise<GroupSpace> {
    const groupKey = normalizeGroupKey(groupName);
    return requireGroupSpacePostgres('ensureGroupSpace', async (client) => {
        const existing = await client.query<{
            group_key: string;
            title: string;
            slug: string;
            created_at: Date;
            updated_at: Date;
        }>(
            `select group_key, title, slug, created_at, updated_at from app_group_spaces where group_key = $1 limit 1`,
            [groupKey]
        );
        if (existing.rows[0]) return mapPgGroupSpace(existing.rows[0]);

        const now = new Date();
        const slug = slugifyGroupName(groupName);
        const upserted = await client.query<{
            group_key: string;
            title: string;
            slug: string;
            created_at: Date;
            updated_at: Date;
        }>(
            `
                insert into app_group_spaces (id, group_key, title, slug, created_at, updated_at)
                values ($1, $2, $3, $4, $5, $6)
                on conflict (group_key)
                do update set
                    title = excluded.title,
                    slug = excluded.slug,
                    updated_at = excluded.updated_at
                returning group_key, title, slug, created_at, updated_at
            `,
            [groupKey, groupKey, groupName.trim(), slug, now, now]
        );
        return mapPgGroupSpace(upserted.rows[0]);
    });
}

export async function updateGroupSpace(params: {
    actorUserId: string;
    groupKey: string;
    title: string;
}): Promise<GroupSpace> {
    const normalizedGroupKey = normalizeGroupKey(params.groupKey);
    const title = params.title.trim();
    if (!title) {
        throw new Error('Group title is required');
    }

    const access = await getEffectiveAccess(params.actorUserId, null);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    return requireGroupSpacePostgres('updateGroupSpace', async (client) => {
        const result = await client.query<{
            group_key: string;
            title: string;
            slug: string;
            created_at: Date;
            updated_at: Date;
        }>(
            `
                update app_group_spaces
                set title = $2, slug = $3, updated_at = $4
                where group_key = $1
                returning group_key, title, slug, created_at, updated_at
            `,
            [normalizedGroupKey, title, slugifyGroupName(title), new Date()]
        );
        if (!result.rows[0]) {
            throw new Error('Group space not found');
        }
        return mapPgGroupSpace(result.rows[0]);
    });
}

export async function ensureAutomaticMembership(userId: string, groupKey: string): Promise<GroupMembership> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    return requireGroupSpacePostgres('ensureAutomaticMembership', async (client) => {
        const existing = await client.query<{
            user_id: string;
            group_key: string;
            source: GroupMembership['source'];
            active: boolean;
            created_at: Date;
            updated_at: Date;
            created_by: string;
            reason: string | null;
            removed_at: Date | null;
            removed_by: string | null;
            removal_reason: string | null;
        }>(
            `
                select user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                from app_group_memberships
                where user_id = $1 and group_key = $2 and active = true
                limit 1
            `,
            [userId, normalizedGroupKey]
        );
        if (existing.rows[0]?.source === 'platonus_auto') {
            return mapPgMembership(existing.rows[0]);
        }

        const now = new Date();
        const createdAt = existing.rows[0]?.created_at || now;
        const upserted = await client.query<{
            user_id: string;
            group_key: string;
            source: GroupMembership['source'];
            active: boolean;
            created_at: Date;
            updated_at: Date;
            created_by: string;
            reason: string | null;
            removed_at: Date | null;
            removed_by: string | null;
            removal_reason: string | null;
        }>(
            `
                insert into app_group_memberships (
                    id, user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                )
                values ($1, $2, $3, 'platonus_auto', true, $4, $5, 'system:platonus_auto', 'Detected from Platonus group', null, null, null)
                on conflict (id)
                do update set
                    source = excluded.source,
                    active = excluded.active,
                    updated_at = excluded.updated_at,
                    created_by = excluded.created_by,
                    reason = excluded.reason,
                    removed_at = null,
                    removed_by = null,
                    removal_reason = null
                returning user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
            `,
            [`${userId}:${normalizedGroupKey}`, userId, normalizedGroupKey, createdAt, now]
        );
        return mapPgMembership(upserted.rows[0]);
    });
}

async function ensureManualMembership(params: {
    userId: string;
    groupKey: string;
    createdBy: string;
    reason?: string | null;
}): Promise<GroupMembership> {
    const normalizedGroupKey = normalizeGroupKey(params.groupKey);
    return requireGroupSpacePostgres('ensureManualMembership', async (client) => {
        const existing = await client.query<{
            user_id: string;
            group_key: string;
            source: GroupMembership['source'];
            active: boolean;
            created_at: Date;
            updated_at: Date;
            created_by: string;
            reason: string | null;
            removed_at: Date | null;
            removed_by: string | null;
            removal_reason: string | null;
        }>(
            `
                insert into app_group_memberships (
                    id, user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                )
                values ($1, $2, $3, 'manual', true, $4, $5, $6, $7, null, null, null)
                on conflict (id)
                do update set
                    source = excluded.source,
                    active = true,
                    updated_at = excluded.updated_at,
                    created_by = excluded.created_by,
                    reason = excluded.reason,
                    removed_at = null,
                    removed_by = null,
                    removal_reason = null
                returning user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
            `,
            [`${params.userId}:${normalizedGroupKey}`, params.userId, normalizedGroupKey, new Date(), new Date(), params.createdBy, params.reason ?? null]
        );
        return mapPgMembership(existing.rows[0]);
    });
}

async function ensureJoinRequestMembership(params: {
    userId: string;
    groupKey: string;
    createdBy: string;
    reason?: string | null;
}): Promise<GroupMembership> {
    const normalizedGroupKey = normalizeGroupKey(params.groupKey);
    return requireGroupSpacePostgres('ensureJoinRequestMembership', async (client) => {
        const existing = await client.query<{
            user_id: string;
            group_key: string;
            source: GroupMembership['source'];
            active: boolean;
            created_at: Date;
            updated_at: Date;
            created_by: string;
            reason: string | null;
            removed_at: Date | null;
            removed_by: string | null;
            removal_reason: string | null;
        }>(
            `
                insert into app_group_memberships (
                    id, user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                )
                values ($1, $2, $3, 'join_request', true, $4, $5, $6, $7, null, null, null)
                on conflict (id)
                do update set
                    source = excluded.source,
                    active = true,
                    updated_at = excluded.updated_at,
                    created_by = excluded.created_by,
                    reason = excluded.reason,
                    removed_at = null,
                    removed_by = null,
                    removal_reason = null
                returning user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
            `,
            [`${params.userId}:${normalizedGroupKey}`, params.userId, normalizedGroupKey, new Date(), new Date(), params.createdBy, params.reason ?? null]
        );
        return mapPgMembership(existing.rows[0]);
    });
}

export function buildPermissions(roles: GroupRoleId[]): EffectiveGroupPermissions {
    const hasCoordinator = roles.includes('coordinator');
    const hasCurator = roles.includes('curator');
    const hasStarosta = roles.includes('starosta');
    const hasHelper = roles.includes('helper');

    return {
        canManageContent: hasCoordinator || hasCurator || hasStarosta || hasHelper,
        canManageMembers: hasCoordinator || hasCurator || hasStarosta || hasHelper,
        canManageHelpers: hasCoordinator || hasCurator || hasStarosta,
        canAssignStarosta: hasCoordinator || hasCurator,
        canViewAudit: hasCoordinator || hasCurator || hasStarosta,
    };
}

export async function getEffectiveAccess(userId: string, groupKey: string | null): Promise<EffectiveGroupAccess> {
    return requireGroupSpacePostgres('getEffectiveAccess', async (client) => {
        const params: unknown[] = [userId, groupKey || '__none__'];
        const result = await client.query<{ role_id: GroupRoleId }>(
            `
                select role_id
                from app_group_role_assignments
                where user_id = $1
                  and active = true
                  and (
                    (scope_type = 'global' and scope_id = 'global')
                    or
                    (scope_type = 'group' and scope_id = $2)
                  )
            `,
            params
        );
        const roles = Array.from(new Set(result.rows.map((item) => item.role_id))) as GroupRoleId[];
        return {
            roles,
            permissions: buildPermissions(roles),
        };
    });
}

async function hasActiveMembership(userId: string, groupKey: string): Promise<boolean> {
    return requireGroupSpacePostgres('hasActiveMembership', async (client) => {
        const result = await client.query(
            `select 1 from app_group_memberships where user_id = $1 and group_key = $2 and active = true limit 1`,
            [userId, normalizeGroupKey(groupKey)]
        );
        return result.rowCount > 0;
    });
}

export async function assertCanReadGroup(userId: string, groupKey: string): Promise<void> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    const [hasMembership, access] = await Promise.all([
        hasActiveMembership(userId, normalizedGroupKey),
        getEffectiveAccess(userId, normalizedGroupKey),
    ]);

    if (!hasMembership && access.roles.length === 0) {
        throw new Error('Forbidden');
    }
}

export async function assertCanManageContent(userId: string, groupKey: string): Promise<void> {
    const access = await getEffectiveAccess(userId, normalizeGroupKey(groupKey));
    if (!access.permissions.canManageContent) {
        throw new Error('Forbidden');
    }
}

async function assertCanManageMembers(userId: string, groupKey: string): Promise<void> {
    const access = await getEffectiveAccess(userId, normalizeGroupKey(groupKey));
    if (!access.permissions.canManageMembers) {
        throw new Error('Forbidden');
    }
}

async function createContentRevision(params: {
    groupKey: string;
    contentType: GroupContentType;
    entityId: string;
    editedBy: string;
    snapshot: Record<string, unknown>;
}): Promise<void> {
    await requireGroupSpacePostgres('createContentRevision', async (client) => {
        await client.query(
            `
                insert into app_group_content_revisions (
                    id, group_key, content_type, entity_id, edited_by, edited_at, snapshot_json
                )
                values ($1, $2, $3, $4, $5, $6, $7::jsonb)
            `,
            [
                randomUUID(),
                normalizeGroupKey(params.groupKey),
                params.contentType,
                params.entityId,
                params.editedBy,
                new Date(),
                JSON.stringify(params.snapshot),
            ]
        );
        return true;
    });
}

function getRevisionString(snapshot: Record<string, unknown>, key: string, allowEmpty = false): string | null {
    const value = snapshot[key];
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    if (!allowEmpty && !normalized) {
        return null;
    }
    return normalized;
}

function getRevisionNullableString(snapshot: Record<string, unknown>, key: string): string | null {
    const value = snapshot[key];
    if (value == null || typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
}

function getRevisionDate(snapshot: Record<string, unknown>, key: string): Date | null {
    const value = snapshot[key];
    if (value == null) {
        return null;
    }

    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid revision value for ${key}`);
    }

    return parsed;
}

async function upsertRoleAssignment(params: {
    userId: string;
    roleId: GroupRoleId;
    scopeType: GroupScopeType;
    scopeId: string;
    assignedBy: string;
    reason?: string | null;
}): Promise<GroupRoleAssignment> {
    const now = new Date();
    return requireGroupSpacePostgres('upsertRoleAssignment', async (client) => {
        const result = await client.query<{
            user_id: string;
            role_id: GroupRoleId;
            scope_type: GroupScopeType;
            scope_id: string;
            active: boolean;
            assigned_by: string;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
        }>(
            `
                insert into app_group_role_assignments (
                    id, user_id, role_id, scope_type, scope_id, active, assigned_by, created_at, updated_at, reason
                )
                values ($1, $2, $3, $4, $5, true, $6, $7, $8, $9)
                on conflict (id)
                do update set
                    active = true,
                    assigned_by = excluded.assigned_by,
                    updated_at = excluded.updated_at,
                    reason = excluded.reason
                returning user_id, role_id, scope_type, scope_id, active, assigned_by, created_at, updated_at, reason
            `,
            [`${params.userId}:${params.roleId}:${params.scopeType}:${params.scopeId}`, params.userId, params.roleId, params.scopeType, params.scopeId, params.assignedBy, now, now, params.reason ?? null]
        );
        return mapPgRoleAssignment(result.rows[0]);
    });
}

async function deactivateRoleAssignment(params: {
    userId: string;
    roleId: GroupRoleId;
    scopeType: GroupScopeType;
    scopeId: string;
    assignedBy: string;
    reason?: string | null;
}): Promise<boolean> {
    return requireGroupSpacePostgres('deactivateRoleAssignment', async (client) => {
        const result = await client.query(
            `
                update app_group_role_assignments
                set active = false, assigned_by = $5, updated_at = $6, reason = $7
                where user_id = $1 and role_id = $2 and scope_type = $3 and scope_id = $4 and active = true
            `,
            [params.userId, params.roleId, params.scopeType, params.scopeId, params.assignedBy, new Date(), params.reason ?? null]
        );
        return result.rowCount > 0;
    });
}

async function deactivateGroupScopedRolesForUser(params: {
    userId: string;
    groupKey: string;
    assignedBy: string;
    reason?: string | null;
}): Promise<void> {
    await requireGroupSpacePostgres('deactivateGroupScopedRolesForUser', async (client) => {
        await client.query(
            `
                update app_group_role_assignments
                set active = false, assigned_by = $3, updated_at = $4, reason = $5
                where user_id = $1 and scope_type = 'group' and scope_id = $2 and active = true
            `,
            [params.userId, normalizeGroupKey(params.groupKey), params.assignedBy, new Date(), params.reason ?? null]
        );
        return true;
    });
}

async function assertTargetUserExists(userId: string): Promise<void> {
    if (!(await userExists(userId))) {
        throw new Error('Target user does not exist');
    }
}

function assertNoSelfAssign(actorUserId: string, targetUserId: string): void {
    if (actorUserId === targetUserId) {
        throw new Error('Self-assignment is not allowed');
    }
}

interface PrimaryGroupContext {
    group: GroupSpace | null;
    membership: GroupMembership | null;
    detectedGroupKey: string | null;
}

async function tryFindByDetectedName(userId: string): Promise<PrimaryGroupContext | null> {
    const detectedGroupName = await getLatestDetectedGroupName(userId);
    if (!detectedGroupName) return null;

    const group = await ensureGroupSpace(detectedGroupName);
    const membership = await ensureAutomaticMembership(userId, group.groupKey);
    return {
        group,
        membership,
        detectedGroupKey: group.groupKey,
    };
}

async function tryFindByActiveMembership(userId: string): Promise<PrimaryGroupContext | null> {
    const membership = await requireGroupSpacePostgres('findPrimaryGroupContext.membership', async (client) => {
        const result = await client.query<{
            user_id: string;
            group_key: string;
            source: GroupMembership['source'];
            active: boolean;
            created_at: Date;
            updated_at: Date;
            created_by: string;
            reason: string | null;
            removed_at: Date | null;
            removed_by: string | null;
            removal_reason: string | null;
        }>(
            `
                select user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                from app_group_memberships
                where user_id = $1 and active = true
                order by created_at desc
                limit 1
            `,
            [userId]
        );
        return result.rows[0] ? mapPgMembership(result.rows[0]) : null;
    });

    if (!membership) return null;
    return {
        group: await ensureGroupSpace(membership.groupKey),
        membership,
        detectedGroupKey: null,
    };
}

async function tryFindByGroupRole(userId: string): Promise<PrimaryGroupContext | null> {
    const role = await requireGroupSpacePostgres('findPrimaryGroupContext.role', async (client) => {
        const result = await client.query<{
            user_id: string;
            role_id: GroupRoleId;
            scope_type: GroupScopeType;
            scope_id: string;
            active: boolean;
            assigned_by: string;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
        }>(
            `
                select user_id, role_id, scope_type, scope_id, active, assigned_by, created_at, updated_at, reason
                from app_group_role_assignments
                where user_id = $1 and active = true and scope_type = 'group'
                order by created_at desc
                limit 1
            `,
            [userId]
        );
        return result.rows[0] ? mapPgRoleAssignment(result.rows[0]) : null;
    });

    if (!role) return null;

    const group = await ensureGroupSpace(role.scopeId);
    const recoveredMembership = await ensureManualMembership({
        userId,
        groupKey: group.groupKey,
        createdBy: 'system:group_role_recovery',
        reason: 'Recovered membership from group role assignment',
    });
    return {
        group,
        membership: recoveredMembership,
        detectedGroupKey: null,
    };
}

async function findPrimaryGroupContext(userId: string): Promise<PrimaryGroupContext> {
    // Каскад: detected-name → active membership → group-scoped role assignment.
    // Каждый помощник возвращает null, если своя ветка не сработала.
    const byDetectedName = await tryFindByDetectedName(userId);
    if (byDetectedName) return byDetectedName;

    const byMembership = await tryFindByActiveMembership(userId);
    if (byMembership) return byMembership;

    const byRole = await tryFindByGroupRole(userId);
    if (byRole) return byRole;

    return { group: null, membership: null, detectedGroupKey: null };
}

function mapPgPost(row: {
    id: string;
    group_key: string;
    title: string;
    body: string;
    author_user_id: string;
    pinned: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    deleted_by: string | null;
}): GroupPostView {
    return {
        id: row.id,
        groupKey: row.group_key,
        title: row.title,
        body: row.body,
        authorUserId: row.author_user_id,
        pinned: row.pinned,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
        deletedBy: row.deleted_by,
    };
}


function mapPgTask(row: {
    id: string;
    group_key: string;
    title: string;
    subject: string | null;
    description: string | null;
    deadline: Date | null;
    priority: GroupTaskPriority;
    author_user_id: string;
    completed: boolean;
    completed_at: Date | null;
    completed_by: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    deleted_by: string | null;
}): GroupTaskView {
    return {
        id: row.id,
        groupKey: row.group_key,
        title: row.title,
        subject: row.subject,
        description: row.description,
        deadline: row.deadline ? new Date(row.deadline) : null,
        priority: row.priority,
        authorUserId: row.author_user_id,
        completed: row.completed,
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        completedBy: row.completed_by,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
        deletedBy: row.deleted_by,
    };
}

function mapPgExtraLesson(row: {
    id: string;
    group_key: string;
    title: string;
    date: Date;
    start_time: string;
    end_time: string;
    room: string | null;
    teacher: string | null;
    note: string | null;
    author_user_id: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    deleted_by: string | null;
}): GroupExtraLessonView {
    return {
        id: row.id,
        groupKey: row.group_key,
        title: row.title,
        date: new Date(row.date),
        startTime: row.start_time,
        endTime: row.end_time,
        room: row.room,
        teacher: row.teacher,
        note: row.note,
        authorUserId: row.author_user_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
        deletedBy: row.deleted_by,
    };
}

function mapPgContentRevision(row: {
    id: string;
    group_key: string;
    content_type: GroupContentType;
    entity_id: string;
    edited_by: string;
    edited_at: Date;
    snapshot_json: Record<string, unknown>;
}): GroupContentRevisionView {
    return {
        id: row.id,
        groupKey: row.group_key,
        contentType: row.content_type,
        entityId: row.entity_id,
        editedBy: row.edited_by,
        editedAt: new Date(row.edited_at),
        snapshot: row.snapshot_json,
    };
}

export function mapPgCoordinatorAnnouncement(row: {
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
    view_count?: number | null;
    viewed_at?: Date | null;
}): CoordinatorAnnouncementView {
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
        viewCount: Number(row.view_count || 0),
        viewedAt: row.viewed_at ? new Date(row.viewed_at) : null,
    };
}

function mapPgJoinRequest(row: {
    id: string;
    user_id: string;
    group_key: string;
    status: GroupJoinRequestStatus;
    created_at: Date;
    updated_at: Date;
    reason: string | null;
    detected_group_key: string | null;
    reviewed_at: Date | null;
    reviewed_by: string | null;
    review_note: string | null;
}): GroupJoinRequestView {
    return {
        id: row.id,
        userId: row.user_id,
        groupKey: row.group_key,
        status: row.status,
        reason: row.reason,
        detectedGroupKey: row.detected_group_key,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
        reviewedBy: row.reviewed_by,
        reviewNote: row.review_note,
    };
}

function mapPgMembershipDispute(row: {
    id: string;
    user_id: string;
    group_key: string;
    issue_type: GroupMembershipDisputeIssue;
    status: GroupMembershipDisputeStatus;
    reason: string;
    detected_group_key: string | null;
    active_group_key: string | null;
    created_at: Date;
    updated_at: Date;
    reviewed_at: Date | null;
    reviewed_by: string | null;
    review_note: string | null;
}): GroupMembershipDisputeView {
    return {
        id: row.id,
        userId: row.user_id,
        groupKey: row.group_key,
        issueType: row.issue_type,
        status: row.status,
        reason: row.reason,
        detectedGroupKey: row.detected_group_key,
        activeGroupKey: row.active_group_key,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
        reviewedBy: row.reviewed_by,
        reviewNote: row.review_note,
    };
}

export async function findGroupPostViewById(postId: string): Promise<GroupPostView | null> {
    return requireGroupSpacePostgres('findGroupPostViewById', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            body: string;
            author_user_id: string;
            pinned: boolean;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `select id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by from app_group_posts where id = $1 limit 1`,
            [postId]
        );
        return result.rows[0] ? mapPgPost(result.rows[0]) : null;
    });
}

async function findGroupTaskViewById(taskId: string): Promise<GroupTaskView | null> {
    return requireGroupSpacePostgres('findGroupTaskViewById', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `select id, group_key, title, subject, description, deadline, priority, author_user_id, completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by from app_group_tasks where id = $1 limit 1`,
            [taskId]
        );
        return result.rows[0] ? mapPgTask(result.rows[0]) : null;
    });
}

async function findGroupExtraLessonViewById(lessonId: string): Promise<GroupExtraLessonView | null> {
    return requireGroupSpacePostgres('findGroupExtraLessonViewById', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            date: Date;
            start_time: string;
            end_time: string;
            room: string | null;
            teacher: string | null;
            note: string | null;
            author_user_id: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `select id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by from app_group_extra_lessons where id = $1 limit 1`,
            [lessonId]
        );
        return result.rows[0] ? mapPgExtraLesson(result.rows[0]) : null;
    });
}

async function findContentRevisionViewById(revisionId: string): Promise<GroupContentRevisionView | null> {
    return requireGroupSpacePostgres('findContentRevisionViewById', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            content_type: GroupContentType;
            entity_id: string;
            edited_by: string;
            edited_at: Date;
            snapshot_json: Record<string, unknown>;
        }>(
            `select id, group_key, content_type, entity_id, edited_by, edited_at, snapshot_json from app_group_content_revisions where id = $1 limit 1`,
            [revisionId]
        );
        return result.rows[0] ? mapPgContentRevision(result.rows[0]) : null;
    });
}

async function findJoinRequestViewById(requestId: string): Promise<GroupJoinRequestView | null> {
    return requireGroupSpacePostgres('findJoinRequestViewById', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            status: GroupJoinRequestStatus;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
            detected_group_key: string | null;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `select id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note from app_group_join_requests where id = $1 limit 1`,
            [requestId]
        );
        return result.rows[0] ? mapPgJoinRequest(result.rows[0]) : null;
    });
}

async function findMembershipDisputeViewById(disputeId: string): Promise<GroupMembershipDisputeView | null> {
    return requireGroupSpacePostgres('findMembershipDisputeViewById', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            issue_type: GroupMembershipDisputeIssue;
            status: GroupMembershipDisputeStatus;
            reason: string;
            detected_group_key: string | null;
            active_group_key: string | null;
            created_at: Date;
            updated_at: Date;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `select id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key, created_at, updated_at, reviewed_at, reviewed_by, review_note from app_group_membership_disputes where id = $1 limit 1`,
            [disputeId]
        );
        return result.rows[0] ? mapPgMembershipDispute(result.rows[0]) : null;
    });
}

export async function getGroupCatalog(): Promise<GroupCatalogItem[]> {
    return requireGroupSpacePostgres('getGroupCatalog', async (client) => {
        const result = await client.query<{ group_key: string; title: string; slug: string }>(
            `select group_key, title, slug from app_group_spaces order by title asc`
        );
        return result.rows.map((space) => ({
            groupKey: space.group_key,
            title: space.title,
            slug: space.slug,
        }));
    });
}

export async function listGroupSpaces(): Promise<GroupSpaceSummary[]> {
    return requireGroupSpacePostgres('listGroupSpaces', async (client) => {
        const [spacesResult, membershipsResult, rolesResult] = await Promise.all([
            client.query<{ group_key: string; title: string; slug: string }>(
                `select group_key, title, slug from app_group_spaces order by title asc`
            ),
            client.query<{ group_key: string; count: string }>(
                `select group_key, count(distinct user_id)::text as count from app_group_memberships where active = true group by group_key`
            ),
            client.query<{ user_id: string; role_id: GroupRoleId; scope_id: string }>(
                `
                    select user_id, role_id, scope_id
                    from app_group_role_assignments
                    where active = true and scope_type = 'group' and role_id in ('starosta', 'helper')
                `
            ),
        ]);

        const membershipCountMap = new Map(membershipsResult.rows.map((item) => [item.group_key, Number(item.count)]));
        const roleMap = new Map<string, { starostas: string[]; helpers: string[] }>();

        for (const doc of rolesResult.rows) {
            const entry = roleMap.get(doc.scope_id) || { starostas: [], helpers: [] };
            if (doc.role_id === 'starosta') entry.starostas.push(doc.user_id);
            if (doc.role_id === 'helper') entry.helpers.push(doc.user_id);
            roleMap.set(doc.scope_id, entry);
        }

        return spacesResult.rows.map((space) => ({
            groupKey: space.group_key,
            title: space.title,
            slug: space.slug,
            memberCount: membershipCountMap.get(space.group_key) || 0,
            starostas: roleMap.get(space.group_key)?.starostas || [],
            helpers: roleMap.get(space.group_key)?.helpers || [],
        }));
    });
}

export async function listRoleAssignments(params: {
    groupKey?: string;
    roleId?: GroupRoleId;
} = {}): Promise<GroupRoleAssignmentView[]> {
    return requireGroupSpacePostgres('listRoleAssignments', async (client) => {
        const filters: string[] = ['active = true'];
        const values: unknown[] = [];

        if (params.groupKey) {
            values.push(normalizeGroupKey(params.groupKey));
            filters.push(`scope_type = 'group'`, `scope_id = $${values.length}`);
        }

        if (params.roleId) {
            values.push(params.roleId);
            filters.push(`role_id = $${values.length}`);
        }

        const result = await client.query<{
            user_id: string;
            role_id: GroupRoleId;
            scope_type: GroupScopeType;
            scope_id: string;
            active: boolean;
            assigned_by: string;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
        }>(
            `
                select user_id, role_id, scope_type, scope_id, active, assigned_by, created_at, updated_at, reason
                from app_group_role_assignments
                where ${filters.join(' and ')}
                order by created_at desc
            `,
            values
        );

        return result.rows.map((item) => ({
            userId: item.user_id,
            roleId: item.role_id,
            scopeType: item.scope_type,
            scopeId: item.scope_id,
            active: item.active,
            assignedBy: item.assigned_by,
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            reason: item.reason ?? null,
        }));
    });
}

export async function searchGroupUsers(actorUserId: string, query: string): Promise<GroupUserSearchView[]> {
    const access = await getEffectiveAccess(actorUserId, null);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    const trimmed = query.trim();
    if (!trimmed) return [];

    return requireGroupSpacePostgres('searchGroupUsers', async (client) => {
        const like = `%${trimmed}%`;
        const usersResult = await client.query<{
            user_id: string;
            full_name: string | null;
        }>(
            `
                select
                    u.user_id,
                    coalesce(s.snapshot_json->>'fullName', s.snapshot_json#>>'{profileSummary,fullName}') as full_name
                from app_users u
                left join app_admin_user_snapshots s on s.user_id = u.user_id
                where u.user_id ilike $1
                   or coalesce(s.snapshot_json->>'fullName', s.snapshot_json#>>'{profileSummary,fullName}', '') ilike $1
                order by u.last_login desc
                limit 40
            `,
            [like]
        );

        const scored = usersResult.rows
            .map((user, index) => ({
                index,
                score: getSmartUserSearchScore({ userId: user.user_id, fullName: user.full_name }, trimmed),
                user,
            }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score !== left.score ? right.score - left.score : left.index - right.index)
            .slice(0, 12);

        const userIds = scored.map((item) => item.user.user_id);
        const roleAssignments = userIds.length === 0 ? { rows: [] as Array<{ user_id: string; role_id: GroupRoleId; scope_id: string }> } : await client.query<{
            user_id: string;
            role_id: GroupRoleId;
            scope_id: string;
        }>(
            `
                select user_id, role_id, scope_id
                from app_group_role_assignments
                where active = true
                  and user_id = any($1::text[])
                  and role_id in ('coordinator', 'curator', 'starosta', 'helper')
                order by case role_id when 'coordinator' then 0 when 'curator' then 1 when 'starosta' then 2 else 3 end, created_at asc
            `,
            [userIds]
        );
        const roleMap = new Map<string, { roleId: GroupRoleId; scopeId: string }>();
        for (const row of roleAssignments.rows) {
            if (!roleMap.has(row.user_id)) {
                roleMap.set(row.user_id, { roleId: row.role_id, scopeId: row.scope_id });
            }
        }

        return scored.map((item) => ({
            userId: item.user.user_id,
            fullName: item.user.full_name,
            existingRole: roleMap.get(item.user.user_id) || null,
        }));
    });
}

export type GroupUserPhoneLookup = {
    phone: string | null;
    source: 'profile_cache' | 'admin_snapshot' | null;
    missingReason: 'profile_not_cached' | 'phone_not_provided' | null;
};

export async function getGroupUserPhone(actorUserId: string, userId: string): Promise<GroupUserPhoneLookup> {
    const access = await getEffectiveAccess(actorUserId, null);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    const cached = await getCachedData<any>(`profile_${userId}`);
    const cachedPhone = normalizeOptionalText(
        cached?.profile?.questionnaire?.summary?.mobilePhone
        || cached?.profile?.questionnaire?.mobilePhone
    );
    if (cachedPhone) {
        return {
            phone: cachedPhone,
            source: 'profile_cache',
            missingReason: null,
        };
    }

    const snapshotPhone = await requireGroupSpacePostgres('getGroupUserPhone', async (client) => {
        const result = await client.query<{ phone: string | null }>(
            `
                select nullif(snapshot_json #>> '{profileSummary,mobilePhone}', '') as phone
                from app_admin_user_snapshots
                where user_id = $1
                limit 1
            `,
            [userId]
        );
        return normalizeOptionalText(result.rows[0]?.phone);
    });

    if (snapshotPhone) {
        return {
            phone: snapshotPhone,
            source: 'admin_snapshot',
            missingReason: null,
        };
    }

    return {
        phone: null,
        source: null,
        missingReason: cached ? 'phone_not_provided' : 'profile_not_cached',
    };
}


export async function assignRoleAsAdmin(params: {
    userId: string;
    roleId: GroupRoleId;
    groupKey?: string;
    assignedBy?: string;
    reason?: string | null;
}): Promise<GroupRoleAssignment> {
    await assertTargetUserExists(params.userId);

    if (params.roleId === 'coordinator' || params.roleId === 'curator') {
        return upsertRoleAssignment({
            userId: params.userId,
            roleId: params.roleId,
            scopeType: 'global',
            scopeId: GLOBAL_SCOPE_ID,
            assignedBy: params.assignedBy || 'system:admin',
            reason: params.reason ?? null,
        });
    }

    if (!params.groupKey) {
        throw new Error('groupKey is required for group-scoped roles');
    }

    const group = await ensureGroupSpace(params.groupKey);
    await ensureManualMembership({
        userId: params.userId,
        groupKey: group.groupKey,
        createdBy: params.assignedBy || 'system:admin',
        reason: params.reason ?? `Role ${params.roleId} assigned`,
    });
    return upsertRoleAssignment({
        userId: params.userId,
        roleId: params.roleId,
        scopeType: 'group',
        scopeId: group.groupKey,
        assignedBy: params.assignedBy || 'system:admin',
        reason: params.reason ?? null,
    });
}

export async function revokeRoleAsAdmin(params: {
    userId: string;
    roleId: GroupRoleId;
    groupKey?: string;
    assignedBy?: string;
    reason?: string | null;
}): Promise<boolean> {
    if (params.roleId === 'coordinator' || params.roleId === 'curator') {
        return deactivateRoleAssignment({
            userId: params.userId,
            roleId: params.roleId,
            scopeType: 'global',
            scopeId: GLOBAL_SCOPE_ID,
            assignedBy: params.assignedBy || 'system:admin',
            reason: params.reason ?? null,
        });
    }

    if (!params.groupKey) {
        throw new Error('groupKey is required for group-scoped roles');
    }

    return deactivateRoleAssignment({
        userId: params.userId,
        roleId: params.roleId,
        scopeType: 'group',
        scopeId: normalizeGroupKey(params.groupKey),
        assignedBy: params.assignedBy || 'system:admin',
        reason: params.reason ?? null,
    });
}

export async function assignRoleAsUser(params: {
    actorUserId: string;
    targetUserId: string;
    roleId: Extract<GroupRoleId, 'starosta' | 'helper'>;
    groupKey: string;
    reason?: string | null;
}): Promise<GroupRoleAssignment> {
    assertNoSelfAssign(params.actorUserId, params.targetUserId);
    await assertTargetUserExists(params.targetUserId);

    const groupKey = normalizeGroupKey(params.groupKey);
    const actorAccess = await getEffectiveAccess(params.actorUserId, groupKey);

    if (params.roleId === 'starosta' && !actorAccess.permissions.canAssignStarosta) {
        throw new Error('Forbidden to assign starosta');
    }

    if (params.roleId === 'helper' && !actorAccess.permissions.canManageHelpers) {
        throw new Error('Forbidden to assign helper');
    }

    const group = await ensureGroupSpace(groupKey);
    await ensureManualMembership({
        userId: params.targetUserId,
        groupKey: group.groupKey,
        createdBy: params.actorUserId,
        reason: params.reason ?? `Role ${params.roleId} assigned`,
    });
    return upsertRoleAssignment({
        userId: params.targetUserId,
        roleId: params.roleId,
        scopeType: 'group',
        scopeId: group.groupKey,
        assignedBy: params.actorUserId,
        reason: params.reason ?? null,
    });
}

export async function revokeRoleAsUser(params: {
    actorUserId: string;
    targetUserId: string;
    roleId: Extract<GroupRoleId, 'starosta' | 'helper'>;
    groupKey: string;
    reason?: string | null;
}): Promise<boolean> {
    assertNoSelfAssign(params.actorUserId, params.targetUserId);

    const groupKey = normalizeGroupKey(params.groupKey);
    const actorAccess = await getEffectiveAccess(params.actorUserId, groupKey);

    if (params.roleId === 'starosta' && !actorAccess.permissions.canAssignStarosta) {
        throw new Error('Forbidden to revoke starosta');
    }

    if (params.roleId === 'helper' && !actorAccess.permissions.canManageHelpers) {
        throw new Error('Forbidden to revoke helper');
    }

    return deactivateRoleAssignment({
        userId: params.targetUserId,
        roleId: params.roleId,
        scopeType: 'group',
        scopeId: groupKey,
        assignedBy: params.actorUserId,
        reason: params.reason ?? null,
    });
}

export async function listGroupMembers(actorUserId: string, groupKey: string): Promise<GroupMemberView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupMembers', async (client) => {
        const [membershipResult, rolesResult] = await Promise.all([
            client.query<{
                user_id: string;
                source: GroupMembership['source'];
                created_at: Date;
            }>(
                `
                    select user_id, source, created_at
                    from app_group_memberships
                    where group_key = $1 and active = true
                    order by created_at asc
                `,
                [normalizedGroupKey]
            ),
            client.query<{ user_id: string; role_id: GroupRoleId }>(
                `
                    select user_id, role_id
                    from app_group_role_assignments
                    where active = true
                      and (
                        (scope_type = 'group' and scope_id = $1)
                        or
                        (scope_type = 'global' and scope_id = 'global' and role_id in ('coordinator', 'curator'))
                      )
                `,
                [normalizedGroupKey]
            ),
        ]);

        const roleMap = new Map<string, GroupRoleId[]>();
        for (const roleDoc of rolesResult.rows) {
            const current = roleMap.get(roleDoc.user_id) || [];
            if (!current.includes(roleDoc.role_id)) current.push(roleDoc.role_id);
            roleMap.set(roleDoc.user_id, current);
        }

        const membershipMap = new Map<string, {
            userId: string;
            source: GroupMembership['source'];
            joinedAt: Date;
            canBeRemovedManually: boolean;
        }>();

        for (const membership of membershipResult.rows) {
            const existing = membershipMap.get(membership.user_id);
            if (!existing) {
                membershipMap.set(membership.user_id, {
                    userId: membership.user_id,
                    source: membership.source,
                    joinedAt: new Date(membership.created_at),
                    canBeRemovedManually: membership.source !== 'platonus_auto',
                });
                continue;
            }

            const preferCurrentSource =
                existing.source !== 'platonus_auto' && membership.source === 'platonus_auto';
            const joinedAt = existing.joinedAt <= membership.created_at ? existing.joinedAt : new Date(membership.created_at);
            membershipMap.set(membership.user_id, {
                userId: membership.user_id,
                source: preferCurrentSource ? membership.source : existing.source,
                joinedAt,
                canBeRemovedManually: existing.canBeRemovedManually && membership.source !== 'platonus_auto',
            });
        }

        const userIds = Array.from(membershipMap.keys());
        const namesResult = userIds.length === 0 ? { rows: [] as Array<{ user_id: string; full_name: string | null }> } : await client.query<{
            user_id: string;
            full_name: string | null;
        }>(
            `
                select user_id, coalesce(snapshot_json->>'fullName', snapshot_json#>>'{profileSummary,fullName}') as full_name
                from app_admin_user_snapshots
                where user_id = any($1::text[])
            `,
            [userIds]
        );
        const nameMap = new Map(namesResult.rows.map((row) => [row.user_id, row.full_name]));

        return Array.from(membershipMap.values()).map((membership) => ({
            userId: membership.userId,
            fullName: typeof nameMap.get(membership.userId) === 'string' ? String(nameMap.get(membership.userId)) : null,
            source: membership.source,
            joinedAt: membership.joinedAt,
            roles: roleMap.get(membership.userId) || [],
            canBeRemovedManually: membership.canBeRemovedManually,
        }));
    });
}

function mapCuratorStudentSummary(
    member: GroupMemberView,
    groupKey: string,
    snapshot?: AdminSnapshotLite | null
): CuratorStudentSummary {
    return {
        userId: member.userId,
        fullName: member.fullName ?? snapshot?.fullName ?? snapshot?.profileSummary?.fullName ?? null,
        groupKey,
        source: member.source,
        joinedAt: member.joinedAt,
        roles: member.roles,
        canBeRemovedManually: member.canBeRemovedManually,
        profileSummary: {
            specialty: normalizeOptionalText(snapshot?.profileSummary?.specialty),
            faculty: normalizeOptionalText(snapshot?.profileSummary?.faculty),
            course: typeof snapshot?.profileSummary?.course === 'number' ? snapshot.profileSummary.course : null,
            formOfEducation: normalizeOptionalText(snapshot?.profileSummary?.formOfEducation),
            detectedGroupName: normalizeOptionalText(snapshot?.profileSummary?.detectedGroupName),
        },
        attestationSummary: {
            currentGPA: typeof snapshot?.attestationSummary?.currentGPA === 'number' ? snapshot.attestationSummary.currentGPA : null,
            currentYear: normalizeOptionalText(snapshot?.attestationSummary?.currentYear),
            creditsEarned: typeof snapshot?.attestationSummary?.creditsEarned === 'number' ? snapshot.attestationSummary.creditsEarned : null,
            gradesCount: typeof snapshot?.attestationSummary?.gradesCount === 'number' ? snapshot.attestationSummary.gradesCount : 0,
        },
        analytics: {
            online: Boolean(snapshot?.analytics?.online),
            lastSeenAt: toDateOrNull(snapshot?.analytics?.lastSeenAt),
            totalSessions: typeof snapshot?.analytics?.totalSessions === 'number' ? snapshot.analytics.totalSessions : null,
        },
        freshness: {
            profile: snapshot?.adminSnapshotMeta?.dataFreshness?.profile ?? 'missing',
            platonus: snapshot?.adminSnapshotMeta?.dataFreshness?.platonus ?? 'missing',
            umkd: snapshot?.adminSnapshotMeta?.dataFreshness?.umkd ?? 'missing',
            analytics: snapshot?.adminSnapshotMeta?.dataFreshness?.analytics ?? 'missing',
        },
    };
}

async function loadAdminSnapshotsLite(userIds: string[]): Promise<Map<string, AdminSnapshotLite>> {
    if (userIds.length === 0) return new Map();

    return requireGroupSpacePostgres('loadAdminSnapshotsLite', async (client) => {
        const result = await client.query<{
            user_id: string;
            snapshot_json: AdminSnapshotLite;
        }>(
            `
                select user_id, snapshot_json
                from app_admin_user_snapshots
                where user_id = any($1::text[])
            `,
            [userIds]
        );

        return new Map(result.rows.map((row) => [row.user_id, row.snapshot_json]));
    });
}

export async function listCuratorStudents(actorUserId: string, groupKey: string): Promise<CuratorStudentSummary[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    const access = await getEffectiveAccess(actorUserId, normalizedGroupKey);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    const members = await listGroupMembers(actorUserId, normalizedGroupKey);
    const snapshotMap = await loadAdminSnapshotsLite(members.map((member) => member.userId));

    return [...members]
        .sort((left, right) => {
            const leftPriority = left.roles.includes('starosta') ? 0 : left.roles.includes('helper') ? 1 : 2;
            const rightPriority = right.roles.includes('starosta') ? 0 : right.roles.includes('helper') ? 1 : 2;
            if (leftPriority !== rightPriority) return leftPriority - rightPriority;
            const leftName = (left.fullName || left.userId).toLowerCase();
            const rightName = (right.fullName || right.userId).toLowerCase();
            return leftName.localeCompare(rightName, 'ru');
        })
        .map((member) => mapCuratorStudentSummary(member, normalizedGroupKey, snapshotMap.get(member.userId)));
}

export async function getCuratorStudentDetail(
    actorUserId: string,
    groupKey: string,
    userId: string
): Promise<CuratorStudentDetail | null> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    const access = await getEffectiveAccess(actorUserId, normalizedGroupKey);
    if (!access.roles.includes('coordinator') && !access.roles.includes('curator')) {
        throw new Error('Forbidden');
    }

    const summaries = await listCuratorStudents(actorUserId, normalizedGroupKey);
    const summary = summaries.find((item) => item.userId === userId) || null;
    if (!summary) return null;

    const phoneLookup = await getGroupUserPhone(actorUserId, userId);

    // Slim payload: only fields rendered by the curator student modal plus
    // identifiers required by assign/revoke role mutations. Heavy blocks
    // (iupSummary, umkd, platonus, topSubjects) were dropped — they were
    // hydrated from the admin snapshot but never consumed by the UI.
    return {
        ...summary,
        phone: {
            value: phoneLookup.phone,
            source: phoneLookup.source,
            missingReason: phoneLookup.missingReason,
        },
    };
}

export async function removeGroupMember(params: {
    actorUserId: string;
    targetUserId: string;
    groupKey: string;
    reason: string;
}): Promise<boolean> {
    const normalizedGroupKey = normalizeGroupKey(params.groupKey);
    const removalReason = params.reason.trim();

    if (!removalReason) {
        throw new Error('Removal reason is required');
    }

    await assertCanManageMembers(params.actorUserId, normalizedGroupKey);

    const membership = await requireGroupSpacePostgres('removeGroupMember.loadMembership', async (client) => {
            const result = await client.query<{
                user_id: string;
                group_key: string;
                source: GroupMembership['source'];
                active: boolean;
                created_at: Date;
                updated_at: Date;
                created_by: string;
                reason: string | null;
                removed_at: Date | null;
                removed_by: string | null;
                removal_reason: string | null;
            }>(
                `
                    select user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                    from app_group_memberships
                    where user_id = $1 and group_key = $2 and active = true
                    limit 1
                `,
                [params.targetUserId, normalizedGroupKey]
            );
            return result.rows[0] ? mapPgMembership(result.rows[0]) : null;
    });

    if (!membership) {
        throw new Error('Active membership not found');
    }

    if (membership.source === 'platonus_auto') {
        throw new Error('Official Platonus membership cannot be removed manually');
    }

    if (params.actorUserId === params.targetUserId) {
        throw new Error('Self-removal is not allowed here');
    }

    const now = new Date();
    const modifiedCount = await requireGroupSpacePostgres('removeGroupMember.deactivateMembership', async (client) => {
            const updated = await client.query(
                `
                    update app_group_memberships
                    set active = false, updated_at = $4, removed_at = $4, removed_by = $5, removal_reason = $6
                    where user_id = $1 and group_key = $2 and active = true
                `,
                [params.targetUserId, normalizedGroupKey, true, now, params.actorUserId, removalReason]
            );
            return updated.rowCount;
    });

    await deactivateGroupScopedRolesForUser({
        userId: params.targetUserId,
        groupKey: normalizedGroupKey,
        assignedBy: params.actorUserId,
        reason: `Membership removed: ${removalReason}`,
    });

    return modifiedCount > 0;
}

export async function createJoinRequest(params: {
    userId: string;
    groupKey: string;
    reason?: string | null;
}): Promise<GroupJoinRequestView> {
    const group = await ensureGroupSpace(params.groupKey);
    const detectedGroupKey = await getDetectedGroupKey(params.userId);

    if (detectedGroupKey && detectedGroupKey !== group.groupKey) {
        throw new Error('Official group is already detected. Join request for another group is not allowed');
    }

    const existingMembership = await requireGroupSpacePostgres('createJoinRequest.membershipCheck', async (client) => {
            const result = await client.query(`select 1 from app_group_memberships where user_id = $1 and group_key = $2 and active = true limit 1`, [params.userId, group.groupKey]);
            return result.rowCount > 0;
        return result.rowCount > 0 ? {} : null;
    });
    if (existingMembership) {
        throw new Error('You are already a member of this group');
    }

    const pendingRequest = await requireGroupSpacePostgres('createJoinRequest.pendingCheck', async (client) => {
            const result = await client.query(`select 1 from app_group_join_requests where user_id = $1 and group_key = $2 and status = 'pending' limit 1`, [params.userId, group.groupKey]);
            return result.rowCount > 0;
        return result.rowCount > 0 ? {} : null;
    });
    if (pendingRequest) {
        throw new Error('Join request already exists');
    }

    const now = new Date();

    return requireGroupSpacePostgres('createJoinRequest', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            status: GroupJoinRequestStatus;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
            detected_group_key: string | null;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                insert into app_group_join_requests (
                    id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note
                )
                values ($1, $2, $3, 'pending', $4, $5, $6, $7, null, null, null)
                returning id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note
            `,
            [randomUUID(), params.userId, group.groupKey, now, now, params.reason ?? null, detectedGroupKey]
        );
        return mapPgJoinRequest(result.rows[0]);
    });
}

export async function listOwnJoinRequests(userId: string): Promise<GroupJoinRequestView[]> {
    return requireGroupSpacePostgres('listOwnJoinRequests', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            status: GroupJoinRequestStatus;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
            detected_group_key: string | null;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                select id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note
                from app_group_join_requests
                where user_id = $1
                order by created_at desc
                limit 20
            `,
            [userId]
        );
        return result.rows.map(mapPgJoinRequest);
    });
}

export async function listGroupJoinRequests(actorUserId: string, groupKey: string, status: GroupJoinRequestStatus = 'pending'): Promise<GroupJoinRequestView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageMembers(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupJoinRequests', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            status: GroupJoinRequestStatus;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
            detected_group_key: string | null;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                select id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note
                from app_group_join_requests
                where group_key = $1 and status = $2
                order by created_at desc
            `,
            [normalizedGroupKey, status]
        );
        return result.rows.map(mapPgJoinRequest);
    });
}

export async function createMembershipDispute(params: {
    userId: string;
    groupKey: string;
    issueType: GroupMembershipDisputeIssue;
    reason: string;
}): Promise<GroupMembershipDisputeView> {
    const group = await ensureGroupSpace(params.groupKey);
    const reason = params.reason.trim();

    if (!reason) {
        throw new Error('Dispute reason is required');
    }

    if (!['join_blocked', 'removal_appeal', 'official_group_mismatch'].includes(params.issueType)) {
        throw new Error('Invalid dispute type');
    }

    const pending = await requireGroupSpacePostgres('createMembershipDispute.pendingCheck', async (client) => {
            const result = await client.query(
                `select 1 from app_group_membership_disputes where user_id = $1 and group_key = $2 and issue_type = $3 and status = 'pending' limit 1`,
                [params.userId, group.groupKey, params.issueType]
            );
            return result.rowCount > 0 ? {} : null;
    });
    if (pending) {
        throw new Error('Pending dispute already exists');
    }

    const context = await findPrimaryGroupContext(params.userId);
    const detectedGroupKey = await getDetectedGroupKey(params.userId);
    const now = new Date();

    return requireGroupSpacePostgres('createMembershipDispute', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            issue_type: GroupMembershipDisputeIssue;
            status: GroupMembershipDisputeStatus;
            reason: string;
            detected_group_key: string | null;
            active_group_key: string | null;
            created_at: Date;
            updated_at: Date;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                insert into app_group_membership_disputes (
                    id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key, created_at, updated_at, reviewed_at, reviewed_by, review_note
                )
                values ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, null, null, null)
                returning id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key, created_at, updated_at, reviewed_at, reviewed_by, review_note
            `,
            [randomUUID(), params.userId, group.groupKey, params.issueType, reason, detectedGroupKey, context.group?.groupKey || null, now, now]
        );
        return mapPgMembershipDispute(result.rows[0]);
    });
}

export async function listOwnMembershipDisputes(userId: string): Promise<GroupMembershipDisputeView[]> {
    return requireGroupSpacePostgres('listOwnMembershipDisputes', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            issue_type: GroupMembershipDisputeIssue;
            status: GroupMembershipDisputeStatus;
            reason: string;
            detected_group_key: string | null;
            active_group_key: string | null;
            created_at: Date;
            updated_at: Date;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                select id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key, created_at, updated_at, reviewed_at, reviewed_by, review_note
                from app_group_membership_disputes
                where user_id = $1
                order by created_at desc
                limit 20
            `,
            [userId]
        );
        return result.rows.map(mapPgMembershipDispute);
    });
}

export async function listGroupMembershipDisputes(
    actorUserId: string,
    groupKey: string,
    status: GroupMembershipDisputeStatus = 'pending'
): Promise<GroupMembershipDisputeView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageMembers(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupMembershipDisputes', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            issue_type: GroupMembershipDisputeIssue;
            status: GroupMembershipDisputeStatus;
            reason: string;
            detected_group_key: string | null;
            active_group_key: string | null;
            created_at: Date;
            updated_at: Date;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                select id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key, created_at, updated_at, reviewed_at, reviewed_by, review_note
                from app_group_membership_disputes
                where group_key = $1 and status = $2
                order by created_at desc
            `,
            [normalizedGroupKey, status]
        );
        return result.rows.map(mapPgMembershipDispute);
    });
}

async function reactivateMembershipFromDispute(params: {
    targetUserId: string;
    groupKey: string;
    reason: string;
}): Promise<GroupMembership | null> {
    return requireGroupSpacePostgres('reactivateMembershipFromDispute', async (client) => {
        const existing = await client.query<{
            user_id: string;
            group_key: string;
            source: GroupMembership['source'];
            active: boolean;
            created_at: Date;
            updated_at: Date;
            created_by: string;
            reason: string | null;
            removed_at: Date | null;
            removed_by: string | null;
            removal_reason: string | null;
        }>(
            `
                update app_group_memberships
                set active = true, updated_at = $3, removed_at = null, removed_by = null, removal_reason = null, reason = $4
                where id = (
                    select id
                    from app_group_memberships
                    where user_id = $1 and group_key = $2 and active = false and source in ('manual', 'join_request')
                    order by updated_at desc, created_at desc
                    limit 1
                )
                returning user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
            `,
            [params.targetUserId, params.groupKey, new Date(), params.reason]
        );
        return existing.rows[0] ? mapPgMembership(existing.rows[0]) : null;
    });
}

export async function reviewMembershipDispute(params: {
    actorUserId: string;
    disputeId: string;
    decision: Exclude<GroupMembershipDisputeStatus, 'pending'>;
    note?: string | null;
}): Promise<GroupMembershipDisputeView> {
    if (!['approved', 'rejected', 'needs_admin'].includes(params.decision)) {
        throw new Error('Invalid dispute decision');
    }

    const dispute = await findMembershipDisputeViewById(params.disputeId);
    if (!dispute || dispute.status !== 'pending') {
        throw new Error('Dispute not found');
    }

    await assertCanManageMembers(params.actorUserId, dispute.groupKey);

    if (params.decision === 'approved') {
        const detectedGroupKey = await getDetectedGroupKey(dispute.userId);

        if (dispute.issueType === 'official_group_mismatch') {
            throw new Error('Official group mismatch should be escalated to admin');
        }

        if (detectedGroupKey && detectedGroupKey !== dispute.groupKey) {
            throw new Error('User already has another official group');
        }

        if (dispute.issueType === 'removal_appeal') {
            const restoredMembership = await reactivateMembershipFromDispute({
                targetUserId: dispute.userId,
                groupKey: dispute.groupKey,
                reason: params.note?.trim() || 'Membership restored after dispute review',
            });

            if (!restoredMembership) {
                await ensureJoinRequestMembership({
                    userId: dispute.userId,
                    groupKey: dispute.groupKey,
                    createdBy: params.actorUserId,
                    reason: params.note?.trim() || 'Membership recreated after dispute review',
                });
            }
        } else {
            await ensureJoinRequestMembership({
                userId: dispute.userId,
                groupKey: dispute.groupKey,
                createdBy: params.actorUserId,
                reason: params.note?.trim() || 'Approved membership dispute',
            });
        }
    }

    const now = new Date();
    const reviewNote = params.note?.trim() || null;
    const pgUpdated = await requireGroupSpacePostgres('reviewMembershipDispute', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            issue_type: GroupMembershipDisputeIssue;
            status: GroupMembershipDisputeStatus;
            reason: string;
            detected_group_key: string | null;
            active_group_key: string | null;
            created_at: Date;
            updated_at: Date;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                update app_group_membership_disputes
                set status = $2, updated_at = $3, reviewed_at = $3, reviewed_by = $4, review_note = $5
                where id = $1
                returning id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key, created_at, updated_at, reviewed_at, reviewed_by, review_note
            `,
            [params.disputeId, params.decision, now, params.actorUserId, reviewNote]
        );
        return result.rows[0] ? mapPgMembershipDispute(result.rows[0]) : null;
    });
    if (!pgUpdated) {
        throw new Error('Dispute not found');
    }
    return pgUpdated;
}

export async function reviewJoinRequest(params: {
    actorUserId: string;
    requestId: string;
    decision: Extract<GroupJoinRequestStatus, 'approved' | 'rejected'>;
    note?: string | null;
}): Promise<GroupJoinRequestView> {
    const requestDoc = await findJoinRequestViewById(params.requestId);
    if (!requestDoc || requestDoc.status !== 'pending') {
        throw new Error('Join request not found');
    }

    await assertCanManageMembers(params.actorUserId, requestDoc.groupKey);

    if (params.decision === 'approved') {
        const detectedGroupKey = await getDetectedGroupKey(requestDoc.userId);
        if (detectedGroupKey && detectedGroupKey !== requestDoc.groupKey) {
            throw new Error('User already has another official group');
        }

        await ensureJoinRequestMembership({
            userId: requestDoc.userId,
            groupKey: requestDoc.groupKey,
            createdBy: params.actorUserId,
            reason: params.note ?? 'Approved join request',
        });
    }

    const now = new Date();
    const reviewNote = params.note ?? null;
    const pgUpdated = await requireGroupSpacePostgres('reviewJoinRequest', async (client) => {
        const result = await client.query<{
            id: string;
            user_id: string;
            group_key: string;
            status: GroupJoinRequestStatus;
            created_at: Date;
            updated_at: Date;
            reason: string | null;
            detected_group_key: string | null;
            reviewed_at: Date | null;
            reviewed_by: string | null;
            review_note: string | null;
        }>(
            `
                update app_group_join_requests
                set status = $2, updated_at = $3, reviewed_at = $3, reviewed_by = $4, review_note = $5
                where id = $1
                returning id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note
            `,
            [params.requestId, params.decision, now, params.actorUserId, reviewNote]
        );
        return result.rows[0] ? mapPgJoinRequest(result.rows[0]) : null;
    });
    if (!pgUpdated) {
        throw new Error('Join request not found');
    }
    return pgUpdated;
}

export async function listGroupPosts(actorUserId: string, groupKey: string): Promise<GroupPostView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupPosts', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            body: string;
            author_user_id: string;
            pinned: boolean;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                select id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
                from app_group_posts
                where group_key = $1 and deleted_at is null
                order by pinned desc, created_at desc
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapPgPost);
    });
}

export async function listDeletedGroupPosts(actorUserId: string, groupKey: string): Promise<GroupPostView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listDeletedGroupPosts', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            body: string;
            author_user_id: string;
            pinned: boolean;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                select id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
                from app_group_posts
                where group_key = $1 and deleted_at is not null
                order by deleted_at desc, updated_at desc
                limit 50
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapPgPost);
    });
}

export async function createGroupPost(params: {
    actorUserId: string;
    groupKey: string;
    title: string;
    body: string;
    pinned?: boolean;
}): Promise<GroupPostView> {
    const group = await ensureGroupSpace(params.groupKey);
    await assertCanManageContent(params.actorUserId, group.groupKey);

    const now = new Date();
    const cleanTitle = params.title.trim();
    const cleanBody = params.body.trim();
    const created = await requireGroupSpacePostgres('createGroupPost', async (client) => {
        const id = randomUUID();
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            body: string;
            author_user_id: string;
            pinned: boolean;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                insert into app_group_posts (
                    id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
                )
                values ($1, $2, $3, $4, $5, $6, $7, $8, null, null)
                returning id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
            `,
            [id, group.groupKey, cleanTitle, cleanBody, params.actorUserId, Boolean(params.pinned), now, now]
        );
        return mapPgPost(result.rows[0]);
    });

    // Phase 1c dual-write: mirror into app_social_entity. Non-fatal on failure.
    await shimMirrorCreateGroupPost({
        legacyId: created.id,
        groupKey: group.groupKey,
        authorUserId: params.actorUserId,
        title: cleanTitle,
        body: cleanBody,
    });

    return created;
}

export async function updateGroupPost(params: {
    actorUserId: string;
    postId: string;
    title: string;
    body: string;
    pinned: boolean;
}): Promise<GroupPostView> {
    const existing = await findGroupPostViewById(params.postId);
    if (!existing || existing.deletedAt) {
        throw new Error('Post not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'post',
        entityId: params.postId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            body: existing.body,
            pinned: existing.pinned,
            authorUserId: existing.authorUserId,
        },
    });

    const cleanTitle = params.title.trim();
    const cleanBody = params.body.trim();
    const pgUpdated = await requireGroupSpacePostgres('updateGroupPost', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            body: string;
            author_user_id: string;
            pinned: boolean;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_posts
                set title = $2, body = $3, pinned = $4, updated_at = $5
                where id = $1
                returning id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.postId, cleanTitle, cleanBody, params.pinned, new Date()]
        );
        return result.rows[0] ? mapPgPost(result.rows[0]) : null;
    });
    if (!pgUpdated) {
        throw new Error('Post not found');
    }

    // Phase 1c dual-write: mirror payload edit into app_social_entity.
    // The social store's owner-only check uses the entity's authorUserId, which
    // is what we recorded when the mirror was first created; pass that here
    // (not the legacy "manage content" actor, which may be a curator/admin).
    await shimMirrorUpdateGroupPost({
        legacyId: pgUpdated.id,
        groupKey: pgUpdated.groupKey,
        authorUserId: pgUpdated.authorUserId,
        title: cleanTitle,
        body: cleanBody,
    });

    return pgUpdated;
}

export async function deleteGroupPost(params: {
    actorUserId: string;
    postId: string;
}): Promise<boolean> {
    const existing = await findGroupPostViewById(params.postId);
    if (!existing || existing.deletedAt) {
        throw new Error('Post not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'post',
        entityId: params.postId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            body: existing.body,
            pinned: existing.pinned,
            authorUserId: existing.authorUserId,
            deletedAt: existing.deletedAt ?? null,
            deletedBy: existing.deletedBy ?? null,
        },
    });

    const ok = await requireGroupSpacePostgres('deleteGroupPost', async (client) => {
        const result = await client.query(
            `update app_group_posts set deleted_at = $2, deleted_by = $3, updated_at = $2 where id = $1`,
            [params.postId, new Date(), params.actorUserId]
        );
        return result.rowCount > 0;
    });

    if (ok) {
        // Phase 1c dual-write: mirror soft-delete. authorUserId is what's stored
        // on the entity, which is the only actor allowed by the social-service
        // owner-check; pass it explicitly.
        await shimMirrorSoftDeleteGroupPost({
            legacyId: params.postId,
            actorUserId: existing.authorUserId,
        });
    }

    return ok;
}

export async function restoreDeletedGroupPost(params: {
    actorUserId: string;
    postId: string;
}): Promise<GroupPostView> {
    const existing = await findGroupPostViewById(params.postId);
    if (!existing || !existing.deletedAt) {
        throw new Error('Deleted post not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'post',
        entityId: params.postId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            body: existing.body,
            pinned: existing.pinned,
            authorUserId: existing.authorUserId,
            deletedAt: existing.deletedAt,
            deletedBy: existing.deletedBy ?? null,
        },
    });

    const pgRestored = await requireGroupSpacePostgres('restoreDeletedGroupPost', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            body: string;
            author_user_id: string;
            pinned: boolean;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_posts
                set deleted_at = null, deleted_by = null, updated_at = $2
                where id = $1
                returning id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.postId, new Date()]
        );
        return result.rows[0] ? mapPgPost(result.rows[0]) : null;
    });
    if (!pgRestored) {
        throw new Error('Deleted post not found');
    }

    // Phase 1c dual-write: mirror restore. Actor must equal the entity author
    // (owner-only check inside the social service); use the stored author.
    await shimMirrorRestoreGroupPost({
        legacyId: pgRestored.id,
        actorUserId: pgRestored.authorUserId,
    });

    return pgRestored;
}

export async function permanentlyDeleteGroupPost(params: {
    actorUserId: string;
    postId: string;
}): Promise<boolean> {
    const existing = await findGroupPostViewById(params.postId);
    if (!existing || !existing.deletedAt) {
        throw new Error('Deleted post not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    // Phase 1c dual-write: before hard-deleting the legacy row (which sets
    // social_entity_id to null via FK), mirror as a soft-delete so audit
    // history in app_social_revision is preserved.
    await shimMirrorPermanentDeleteGroupPost({
        legacyId: params.postId,
        actorUserId: existing.authorUserId,
    });

    return requireGroupSpacePostgres('permanentlyDeleteGroupPost', async (client) => {
        const result = await client.query(
            `delete from app_group_posts where id = $1 and deleted_at is not null`,
            [params.postId]
        );
        return result.rowCount > 0;
    });
}

export async function listGroupTasks(actorUserId: string, groupKey: string): Promise<GroupTaskView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupTasks', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                select id, group_key, title, subject, description, deadline, priority, author_user_id, completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
                from app_group_tasks
                where group_key = $1 and deleted_at is null
                order by completed asc, deadline asc nulls last, created_at desc
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapPgTask);
    });
}

export async function listDeletedGroupTasks(actorUserId: string, groupKey: string): Promise<GroupTaskView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listDeletedGroupTasks', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                select id, group_key, title, subject, description, deadline, priority, author_user_id, completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
                from app_group_tasks
                where group_key = $1 and deleted_at is not null
                order by deleted_at desc, updated_at desc
                limit 50
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapPgTask);
    });
}

export async function createGroupTask(params: {
    actorUserId: string;
    groupKey: string;
    title: string;
    subject?: string | null;
    description?: string | null;
    deadline?: string | null;
    priority?: GroupTaskPriority;
}): Promise<GroupTaskView> {
    const group = await ensureGroupSpace(params.groupKey);
    await assertCanManageContent(params.actorUserId, group.groupKey);

    const now = new Date();
    const normalizedDeadline = params.deadline ? new Date(params.deadline) : null;
    const normalizedPriority = params.priority || 'medium';
    if (normalizedDeadline && Number.isNaN(normalizedDeadline.getTime())) {
        throw new Error('Invalid deadline');
    }
    if (!['low', 'medium', 'high'].includes(normalizedPriority)) {
        throw new Error('Invalid priority');
    }

    const created = await requireGroupSpacePostgres('createGroupTask', async (client) => {
        const id = randomUUID();
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                insert into app_group_tasks (
                    id, group_key, title, subject, description, deadline, priority, author_user_id,
                    completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
                )
                values ($1, $2, $3, $4, $5, $6, $7, $8, false, null, null, $9, $10, null, null)
                returning id, group_key, title, subject, description, deadline, priority, author_user_id,
                          completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
            `,
            [id, group.groupKey, params.title.trim(), params.subject?.trim() || null, params.description?.trim() || null, normalizedDeadline, normalizedPriority, params.actorUserId, now, now]
        );
        return mapPgTask(result.rows[0]);
    });

    // Phase 1c dual-write: mirror into app_social_entity (kind='task').
    // Per-user completion (completedByUserIds) is intentionally not mirrored —
    // see group-tasks-shim.ts header for the rationale.
    await shimMirrorCreateGroupTask({
        legacyId: created.id,
        groupKey: group.groupKey,
        authorUserId: params.actorUserId,
        title: created.title,
        body: created.description ?? created.subject ?? '',
        dueAt: created.deadline ? created.deadline.toISOString() : null,
    });

    return created;
}

export async function updateGroupTask(params: {
    actorUserId: string;
    taskId: string;
    title: string;
    subject?: string | null;
    description?: string | null;
    deadline?: string | null;
    priority?: GroupTaskPriority;
}): Promise<GroupTaskView> {
    const existing = await findGroupTaskViewById(params.taskId);
    if (!existing || existing.deletedAt) {
        throw new Error('Task not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    const normalizedDeadline = params.deadline ? new Date(params.deadline) : null;
    const normalizedPriority = params.priority || existing.priority;
    if (normalizedDeadline && Number.isNaN(normalizedDeadline.getTime())) {
        throw new Error('Invalid deadline');
    }
    if (!['low', 'medium', 'high'].includes(normalizedPriority)) {
        throw new Error('Invalid priority');
    }

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'task',
        entityId: params.taskId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            subject: existing.subject ?? null,
            description: existing.description ?? null,
            deadline: existing.deadline ?? null,
            priority: existing.priority,
            completed: existing.completed,
            completedAt: existing.completedAt ?? null,
            completedBy: existing.completedBy ?? null,
        },
    });

    const pgUpdated = await requireGroupSpacePostgres('updateGroupTask', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_tasks
                set title = $2, subject = $3, description = $4, deadline = $5, priority = $6, updated_at = $7
                where id = $1
                returning id, group_key, title, subject, description, deadline, priority, author_user_id, completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.taskId, params.title.trim(), params.subject?.trim() || null, params.description?.trim() || null, normalizedDeadline, normalizedPriority, new Date()]
        );
        return result.rows[0] ? mapPgTask(result.rows[0]) : null;
    });
    if (!pgUpdated) {
        throw new Error('Task not found');
    }

    // Phase 1c dual-write: mirror payload edit into app_social_entity. The
    // social store's owner-only check uses the entity's authorUserId (which we
    // recorded when the mirror was first created); pass that here, not the
    // legacy "manage content" actor (which may be a curator/admin).
    await shimMirrorUpdateGroupTask({
        legacyId: pgUpdated.id,
        groupKey: pgUpdated.groupKey,
        authorUserId: pgUpdated.authorUserId,
        title: pgUpdated.title,
        body: pgUpdated.description ?? pgUpdated.subject ?? '',
        dueAt: pgUpdated.deadline ? pgUpdated.deadline.toISOString() : null,
    });

    return pgUpdated;
}

export async function toggleGroupTaskCompletion(params: {
    actorUserId: string;
    taskId: string;
    completed: boolean;
}): Promise<GroupTaskView> {
    const existing = await findGroupTaskViewById(params.taskId);
    if (!existing || existing.deletedAt) {
        throw new Error('Task not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'task',
        entityId: params.taskId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            subject: existing.subject ?? null,
            description: existing.description ?? null,
            deadline: existing.deadline ?? null,
            priority: existing.priority,
            completed: existing.completed,
            completedAt: existing.completedAt ?? null,
            completedBy: existing.completedBy ?? null,
        },
    });

    const now = new Date();
    const pgUpdated = await requireGroupSpacePostgres('toggleGroupTaskCompletion', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_tasks
                set completed = $2, completed_at = $3, completed_by = $4, updated_at = $3
                where id = $1
                returning id, group_key, title, subject, description, deadline, priority, author_user_id, completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.taskId, params.completed, now, params.completed ? params.actorUserId : null]
        );
        return result.rows[0] ? mapPgTask(result.rows[0]) : null;
    });
    if (!pgUpdated) {
        throw new Error('Task not found');
    }
    // per-user completion intentionally NOT mirrored in Phase 1c — see 1d.
    // The legacy schema stores a single `completed` boolean, which is not
    // equivalent to the universal model's per-user `completedByUserIds` set.
    return pgUpdated;
}

export async function listContentRevisions(params: {
    actorUserId: string;
    groupKey: string;
    contentType: GroupContentType;
    entityId: string;
}): Promise<GroupContentRevisionView[]> {
    const normalizedGroupKey = normalizeGroupKey(params.groupKey);
    await assertCanReadGroup(params.actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listContentRevisions', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            content_type: GroupContentType;
            entity_id: string;
            edited_by: string;
            edited_at: Date;
            snapshot_json: Record<string, unknown>;
        }>(
            `
                select id, group_key, content_type, entity_id, edited_by, edited_at, snapshot_json
                from app_group_content_revisions
                where group_key = $1 and content_type = $2 and entity_id = $3
                order by edited_at desc
                limit 20
            `,
            [normalizedGroupKey, params.contentType, params.entityId]
        );
        return result.rows.map(mapPgContentRevision);
    });
}

async function restorePostRevision(
    actorUserId: string,
    revision: GroupContentRevisionView
): Promise<void> {
    const existing = await findGroupPostViewById(revision.entityId);
    if (!existing || existing.deletedAt) {
        throw new Error('Post not found');
    }

    const title = getRevisionString(revision.snapshot, 'title');
    const body = getRevisionString(revision.snapshot, 'body');
    if (!title || !body) {
        throw new Error('Revision snapshot is incomplete');
    }

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'post',
        entityId: revision.entityId,
        editedBy: actorUserId,
        snapshot: {
            title: existing.title,
            body: existing.body,
            pinned: existing.pinned,
            authorUserId: existing.authorUserId,
        },
    });

    const restoredAuthorId = getRevisionString(revision.snapshot, 'authorUserId') || existing.authorUserId;
    const pgRestored = await requireGroupSpacePostgres('restoreContentRevision.post', async (client) => {
        const result = await client.query(
            `
                update app_group_posts
                set title = $2, body = $3, pinned = $4, author_user_id = $5, updated_at = $6
                where id = $1
            `,
            [revision.entityId, title, body, Boolean(revision.snapshot.pinned), restoredAuthorId, new Date()]
        );
        return result.rowCount > 0;
    });
    if (!pgRestored) {
        throw new Error('Post not found');
    }

    // Phase 1c dual-write: mirror the revision-restore as a payload update on
    // the social entity. Owner-check uses the entity's recorded authorUserId.
    await shimMirrorUpdateGroupPost({
        legacyId: revision.entityId,
        groupKey: existing.groupKey,
        authorUserId: restoredAuthorId,
        title,
        body,
    });
}

async function restoreTaskRevision(
    actorUserId: string,
    revision: GroupContentRevisionView
): Promise<void> {
    const existing = await findGroupTaskViewById(revision.entityId);
    if (!existing || existing.deletedAt) {
        throw new Error('Task not found');
    }

    const title = getRevisionString(revision.snapshot, 'title');
    const priorityValue = getRevisionString(revision.snapshot, 'priority') || existing.priority;
    if (!title || !['low', 'medium', 'high'].includes(priorityValue)) {
        throw new Error('Revision snapshot is incomplete');
    }
    const priority = priorityValue as GroupTaskPriority;

    const completed = Boolean(revision.snapshot.completed);
    const completedAt = completed ? getRevisionDate(revision.snapshot, 'completedAt') : null;

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'task',
        entityId: revision.entityId,
        editedBy: actorUserId,
        snapshot: {
            title: existing.title,
            subject: existing.subject ?? null,
            description: existing.description ?? null,
            deadline: existing.deadline ?? null,
            priority: existing.priority,
            completed: existing.completed,
            completedAt: existing.completedAt ?? null,
            completedBy: existing.completedBy ?? null,
        },
    });

    const pgRestored = await requireGroupSpacePostgres('restoreContentRevision.task', async (client) => {
        const result = await client.query(
            `
                update app_group_tasks
                set title = $2, subject = $3, description = $4, deadline = $5, priority = $6, completed = $7, completed_at = $8, completed_by = $9, updated_at = $10
                where id = $1
            `,
            [revision.entityId, title, getRevisionNullableString(revision.snapshot, 'subject'), getRevisionNullableString(revision.snapshot, 'description'), getRevisionDate(revision.snapshot, 'deadline'), priority, completed, completedAt, completed ? getRevisionNullableString(revision.snapshot, 'completedBy') : null, new Date()]
        );
        return result.rowCount > 0;
    });
    if (!pgRestored) {
        throw new Error('Task not found');
    }

    // Phase 1c dual-write: mirror the revision-restore as a payload update on
    // the social entity. Owner-check uses the entity's recorded authorUserId.
    const revisionDeadline = getRevisionDate(revision.snapshot, 'deadline');
    const revisionDescription = getRevisionNullableString(revision.snapshot, 'description');
    const revisionSubject = getRevisionNullableString(revision.snapshot, 'subject');
    await shimMirrorUpdateGroupTask({
        legacyId: revision.entityId,
        groupKey: existing.groupKey,
        authorUserId: existing.authorUserId,
        title,
        body: revisionDescription ?? revisionSubject ?? '',
        dueAt: revisionDeadline ? revisionDeadline.toISOString() : null,
    });
}

async function restoreExtraLessonRevision(
    actorUserId: string,
    revision: GroupContentRevisionView
): Promise<void> {
    const existing = await findGroupExtraLessonViewById(revision.entityId);
    if (!existing || existing.deletedAt) {
        throw new Error('Extra lesson not found');
    }

    const title = getRevisionString(revision.snapshot, 'title');
    const startTime = getRevisionString(revision.snapshot, 'startTime');
    const endTime = getRevisionString(revision.snapshot, 'endTime');
    const date = getRevisionDate(revision.snapshot, 'date');
    if (!title || !startTime || !endTime || !date || endTime <= startTime) {
        throw new Error('Revision snapshot is incomplete');
    }

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'extra_lesson',
        entityId: revision.entityId,
        editedBy: actorUserId,
        snapshot: {
            title: existing.title,
            date: existing.date,
            startTime: existing.startTime,
            endTime: existing.endTime,
            room: existing.room ?? null,
            teacher: existing.teacher ?? null,
            note: existing.note ?? null,
        },
    });

    const pgRestored = await requireGroupSpacePostgres('restoreContentRevision.extraLesson', async (client) => {
        const result = await client.query(
            `
                update app_group_extra_lessons
                set title = $2, date = $3, start_time = $4, end_time = $5, room = $6, teacher = $7, note = $8, updated_at = $9
                where id = $1
            `,
            [revision.entityId, title, date, startTime, endTime, getRevisionNullableString(revision.snapshot, 'room'), getRevisionNullableString(revision.snapshot, 'teacher'), getRevisionNullableString(revision.snapshot, 'note'), new Date()]
        );
        return result.rowCount > 0;
    });
    if (!pgRestored) {
        throw new Error('Extra lesson not found');
    }

    // Phase 1c dual-write: mirror the revision-restore as a payload update on
    // the social entity. Owner-check uses the entity's recorded authorUserId.
    await shimMirrorUpdateGroupExtraLesson({
        legacyId: revision.entityId,
        groupKey: existing.groupKey,
        authorUserId: existing.authorUserId,
        subject: title,
        startsAt: combineLessonDateTime(date, startTime),
        endsAt: combineLessonDateTime(date, endTime),
        teacher: getRevisionNullableString(revision.snapshot, 'teacher'),
        room: getRevisionNullableString(revision.snapshot, 'room'),
        note: getRevisionNullableString(revision.snapshot, 'note'),
    });
}

export async function restoreContentRevision(params: {
    actorUserId: string;
    revisionId: string;
}): Promise<{ groupKey: string; contentType: GroupContentType; entityId: string }> {
    const revision = await findContentRevisionViewById(params.revisionId);
    if (!revision) {
        throw new Error('Revision not found');
    }

    await assertCanManageContent(params.actorUserId, revision.groupKey);

    switch (revision.contentType) {
        case 'post':
            await restorePostRevision(params.actorUserId, revision);
            break;
        case 'task':
            await restoreTaskRevision(params.actorUserId, revision);
            break;
        case 'extra_lesson':
            await restoreExtraLessonRevision(params.actorUserId, revision);
            break;
        default:
            throw new Error('Unsupported revision content type');
    }

    return {
        groupKey: revision.groupKey,
        contentType: revision.contentType,
        entityId: revision.entityId,
    };
}

export async function deleteGroupTask(params: {
    actorUserId: string;
    taskId: string;
}): Promise<boolean> {
    const existing = await findGroupTaskViewById(params.taskId);
    if (!existing || existing.deletedAt) {
        throw new Error('Task not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'task',
        entityId: params.taskId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            subject: existing.subject ?? null,
            description: existing.description ?? null,
            deadline: existing.deadline ?? null,
            priority: existing.priority,
            completed: existing.completed,
            completedAt: existing.completedAt ?? null,
            completedBy: existing.completedBy ?? null,
            deletedAt: existing.deletedAt ?? null,
            deletedBy: existing.deletedBy ?? null,
        },
    });

    const ok = await requireGroupSpacePostgres('deleteGroupTask', async (client) => {
        const result = await client.query(
            `update app_group_tasks set deleted_at = $2, deleted_by = $3, updated_at = $2 where id = $1`,
            [params.taskId, new Date(), params.actorUserId]
        );
        return result.rowCount > 0;
    });

    if (ok) {
        // Phase 1c dual-write: mirror soft-delete. authorUserId is what's stored
        // on the entity, which is the only actor allowed by the social-service
        // owner-check; pass it explicitly.
        await shimMirrorSoftDeleteGroupTask({
            legacyId: params.taskId,
            actorUserId: existing.authorUserId,
        });
    }

    return ok;
}

export async function restoreDeletedGroupTask(params: {
    actorUserId: string;
    taskId: string;
}): Promise<GroupTaskView> {
    const existing = await findGroupTaskViewById(params.taskId);
    if (!existing || !existing.deletedAt) {
        throw new Error('Deleted task not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'task',
        entityId: params.taskId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            subject: existing.subject ?? null,
            description: existing.description ?? null,
            deadline: existing.deadline ?? null,
            priority: existing.priority,
            completed: existing.completed,
            completedAt: existing.completedAt ?? null,
            completedBy: existing.completedBy ?? null,
            deletedAt: existing.deletedAt,
            deletedBy: existing.deletedBy ?? null,
        },
    });

    const pgRestored = await requireGroupSpacePostgres('restoreDeletedGroupTask', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            subject: string | null;
            description: string | null;
            deadline: Date | null;
            priority: GroupTaskPriority;
            author_user_id: string;
            completed: boolean;
            completed_at: Date | null;
            completed_by: string | null;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_tasks
                set deleted_at = null, deleted_by = null, updated_at = $2
                where id = $1
                returning id, group_key, title, subject, description, deadline, priority, author_user_id, completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.taskId, new Date()]
        );
        return result.rows[0] ? mapPgTask(result.rows[0]) : null;
    });
    if (!pgRestored) {
        throw new Error('Deleted task not found');
    }

    // Phase 1c dual-write: mirror restore. Actor must equal the entity author
    // (owner-only check inside the social service); use the stored author.
    await shimMirrorRestoreGroupTask({
        legacyId: pgRestored.id,
        actorUserId: pgRestored.authorUserId,
    });

    return pgRestored;
}

export async function listGroupExtraLessons(actorUserId: string, groupKey: string): Promise<GroupExtraLessonView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupExtraLessons', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            date: Date;
            start_time: string;
            end_time: string;
            room: string | null;
            teacher: string | null;
            note: string | null;
            author_user_id: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                select id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by
                from app_group_extra_lessons
                where group_key = $1 and deleted_at is null
                order by date asc, start_time asc, created_at desc
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapPgExtraLesson);
    });
}

export async function listDeletedGroupExtraLessons(actorUserId: string, groupKey: string): Promise<GroupExtraLessonView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listDeletedGroupExtraLessons', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            date: Date;
            start_time: string;
            end_time: string;
            room: string | null;
            teacher: string | null;
            note: string | null;
            author_user_id: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                select id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by
                from app_group_extra_lessons
                where group_key = $1 and deleted_at is not null
                order by deleted_at desc, updated_at desc
                limit 50
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapPgExtraLesson);
    });
}

export async function createGroupExtraLesson(params: {
    actorUserId: string;
    groupKey: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    room?: string | null;
    teacher?: string | null;
    note?: string | null;
}): Promise<GroupExtraLessonView> {
    const group = await ensureGroupSpace(params.groupKey);
    await assertCanManageContent(params.actorUserId, group.groupKey);

    const lessonDate = new Date(params.date);
    if (Number.isNaN(lessonDate.getTime())) {
        throw new Error('Invalid date');
    }
    if (!params.startTime || !params.endTime || params.endTime <= params.startTime) {
        throw new Error('Invalid lesson time');
    }

    const now = new Date();
    const created = await requireGroupSpacePostgres('createGroupExtraLesson', async (client) => {
        const id = randomUUID();
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            date: Date;
            start_time: string;
            end_time: string;
            room: string | null;
            teacher: string | null;
            note: string | null;
            author_user_id: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                insert into app_group_extra_lessons (
                    id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by
                )
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, null, null)
                returning id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by
            `,
            [id, group.groupKey, params.title.trim(), lessonDate, params.startTime, params.endTime, params.room?.trim() || null, params.teacher?.trim() || null, params.note?.trim() || null, params.actorUserId, now, now]
        );
        return mapPgExtraLesson(result.rows[0]);
    });

    // Phase 1c dual-write: mirror into app_social_entity (kind='extra_lesson').
    await shimMirrorCreateGroupExtraLesson({
        legacyId: created.id,
        groupKey: group.groupKey,
        authorUserId: params.actorUserId,
        subject: created.title,
        startsAt: combineLessonDateTime(created.date, created.startTime),
        endsAt: combineLessonDateTime(created.date, created.endTime),
        teacher: created.teacher ?? null,
        room: created.room ?? null,
        note: created.note ?? null,
    });

    return created;
}

export async function updateGroupExtraLesson(params: {
    actorUserId: string;
    lessonId: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    room?: string | null;
    teacher?: string | null;
    note?: string | null;
}): Promise<GroupExtraLessonView> {
    const existing = await findGroupExtraLessonViewById(params.lessonId);
    if (!existing || existing.deletedAt) {
        throw new Error('Extra lesson not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    const lessonDate = new Date(params.date);
    if (Number.isNaN(lessonDate.getTime())) {
        throw new Error('Invalid date');
    }
    if (!params.startTime || !params.endTime || params.endTime <= params.startTime) {
        throw new Error('Invalid lesson time');
    }

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'extra_lesson',
        entityId: params.lessonId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            date: existing.date,
            startTime: existing.startTime,
            endTime: existing.endTime,
            room: existing.room ?? null,
            teacher: existing.teacher ?? null,
            note: existing.note ?? null,
        },
    });

    const pgUpdated = await requireGroupSpacePostgres('updateGroupExtraLesson', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            date: Date;
            start_time: string;
            end_time: string;
            room: string | null;
            teacher: string | null;
            note: string | null;
            author_user_id: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_extra_lessons
                set title = $2, date = $3, start_time = $4, end_time = $5, room = $6, teacher = $7, note = $8, updated_at = $9
                where id = $1
                returning id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.lessonId, params.title.trim(), lessonDate, params.startTime, params.endTime, params.room?.trim() || null, params.teacher?.trim() || null, params.note?.trim() || null, new Date()]
        );
        return result.rows[0] ? mapPgExtraLesson(result.rows[0]) : null;
    });
    if (!pgUpdated) {
        throw new Error('Extra lesson not found');
    }

    // Phase 1c dual-write: mirror payload edit into app_social_entity. The
    // social store's owner-only check uses the entity's authorUserId; pass that
    // (not the legacy "manage content" actor, which may be a curator/admin).
    await shimMirrorUpdateGroupExtraLesson({
        legacyId: pgUpdated.id,
        groupKey: pgUpdated.groupKey,
        authorUserId: pgUpdated.authorUserId,
        subject: pgUpdated.title,
        startsAt: combineLessonDateTime(pgUpdated.date, pgUpdated.startTime),
        endsAt: combineLessonDateTime(pgUpdated.date, pgUpdated.endTime),
        teacher: pgUpdated.teacher ?? null,
        room: pgUpdated.room ?? null,
        note: pgUpdated.note ?? null,
    });

    return pgUpdated;
}

export async function deleteGroupExtraLesson(params: {
    actorUserId: string;
    lessonId: string;
}): Promise<boolean> {
    const existing = await findGroupExtraLessonViewById(params.lessonId);
    if (!existing || existing.deletedAt) {
        throw new Error('Extra lesson not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'extra_lesson',
        entityId: params.lessonId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            date: existing.date,
            startTime: existing.startTime,
            endTime: existing.endTime,
            room: existing.room ?? null,
            teacher: existing.teacher ?? null,
            note: existing.note ?? null,
            deletedAt: existing.deletedAt ?? null,
            deletedBy: existing.deletedBy ?? null,
        },
    });

    const ok = await requireGroupSpacePostgres('deleteGroupExtraLesson', async (client) => {
        const result = await client.query(
            `update app_group_extra_lessons set deleted_at = $2, deleted_by = $3, updated_at = $2 where id = $1`,
            [params.lessonId, new Date(), params.actorUserId]
        );
        return result.rowCount > 0;
    });

    if (ok) {
        // Phase 1c dual-write: mirror soft-delete. authorUserId is what's stored
        // on the entity, which is the only actor allowed by the social-service
        // owner-check; pass it explicitly.
        await shimMirrorSoftDeleteGroupExtraLesson({
            legacyId: params.lessonId,
            actorUserId: existing.authorUserId,
        });
    }

    return ok;
}

export async function restoreDeletedGroupExtraLesson(params: {
    actorUserId: string;
    lessonId: string;
}): Promise<GroupExtraLessonView> {
    const existing = await findGroupExtraLessonViewById(params.lessonId);
    if (!existing || !existing.deletedAt) {
        throw new Error('Deleted extra lesson not found');
    }

    await assertCanManageContent(params.actorUserId, existing.groupKey);

    await createContentRevision({
        groupKey: existing.groupKey,
        contentType: 'extra_lesson',
        entityId: params.lessonId,
        editedBy: params.actorUserId,
        snapshot: {
            title: existing.title,
            date: existing.date,
            startTime: existing.startTime,
            endTime: existing.endTime,
            room: existing.room ?? null,
            teacher: existing.teacher ?? null,
            note: existing.note ?? null,
            deletedAt: existing.deletedAt,
            deletedBy: existing.deletedBy ?? null,
        },
    });

    const pgRestored = await requireGroupSpacePostgres('restoreDeletedGroupExtraLesson', async (client) => {
        const result = await client.query<{
            id: string;
            group_key: string;
            title: string;
            date: Date;
            start_time: string;
            end_time: string;
            room: string | null;
            teacher: string | null;
            note: string | null;
            author_user_id: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
            deleted_by: string | null;
        }>(
            `
                update app_group_extra_lessons
                set deleted_at = null, deleted_by = null, updated_at = $2
                where id = $1
                returning id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, updated_at, deleted_at, deleted_by
            `,
            [params.lessonId, new Date()]
        );
        return result.rows[0] ? mapPgExtraLesson(result.rows[0]) : null;
    });
    if (!pgRestored) {
        throw new Error('Deleted extra lesson not found');
    }

    // Phase 1c dual-write: mirror restore. Actor must equal the entity author
    // (owner-only check inside the social service); use the stored author.
    await shimMirrorRestoreGroupExtraLesson({
        legacyId: pgRestored.id,
        actorUserId: pgRestored.authorUserId,
    });

    return pgRestored;
}

export async function getGroupSpaceMe(userId: string): Promise<GroupSpaceMe> {
    const context = await findPrimaryGroupContext(userId);
    const access = await getEffectiveAccess(userId, context.group?.groupKey || null);

    if (!context.group || !context.membership) {
        return {
            available: false,
            group: null,
            membership: {
                active: false,
                source: null,
            },
            access,
            note: 'Group is not detected yet. Connect Platonus, or submit a join request if detection is unavailable.',
        };
    }

    return {
        available: true,
        group: {
            groupKey: context.group.groupKey,
            title: context.group.title,
            slug: context.group.slug,
        },
        membership: {
            active: context.membership.active,
            source: context.membership.source,
        },
        access,
        note: context.detectedGroupKey ? undefined : 'Group is resolved from active membership or assigned role.',
    };
}
