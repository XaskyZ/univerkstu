import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';

export type ReferralClaimSource = 'link' | 'manual';
export type ReferralAutoApplyStatus =
    | 'missing'
    | 'applied'
    | 'invalid'
    | 'self'
    | 'already_claimed'
    | 'claim_window_expired'
    | 'error';
export type ReferralRewardType = 'invite_success' | 'welcome_bonus';

export interface ReferralInviterView {
    userId: string;
    displayName: string;
    code: string;
    referredAt: string;
    source: ReferralClaimSource;
}

export interface ReferralRewardEventView {
    id: string;
    type: ReferralRewardType;
    points: number;
    createdAt: string;
    counterpartUserId: string | null;
    counterpartDisplayName: string | null;
}

export interface ReferralRecentUserView {
    userId: string;
    displayName: string;
    referredAt: string;
}

export interface ReferralLeaderboardEntry {
    rank: number;
    userId: string;
    displayName: string;
    referralCount: number;
    totalPoints: number;
    isCurrentUser: boolean;
}

export interface ReferralOverview {
    code: string;
    inviteRewardPoints: number;
    welcomeRewardPoints: number;
    totalPoints: number;
    referralCount: number;
    myRank: number | null;
    totalRankedUsers: number;
    claimWindowEndsAt: string;
    canClaimManualCode: boolean;
    referredBy: ReferralInviterView | null;
    rewards: ReferralRewardEventView[];
    recentReferrals: ReferralRecentUserView[];
    leaderboard: ReferralLeaderboardEntry[];
    updatedAt: string;
}

interface ReferralProfileRow {
    user_id: string;
    code: string;
    created_at: Date;
    updated_at: Date;
    referred_by_user_id: string | null;
    referred_by_code: string | null;
    referred_at: Date | null;
    referred_source: ReferralClaimSource | null;
}

interface ReferralRewardRow {
    id: string;
    user_id: string;
    reward_type: ReferralRewardType;
    referral_user_id: string | null;
    points: number;
    created_at: Date;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_REWARD_POINTS = 100;
const WELCOME_REWARD_POINTS = 25;

async function requireReferralPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<T>(handler);
    if (result === null) {
        throw new Error(`[Referrals] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result;
}

export function normalizeReferralCode(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export function buildReferralCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let output = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) {
        output += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
    }
    return output;
}

export function maskDisplayName(value: string | null | undefined, fallbackUserId: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return `Студент ${fallbackUserId.slice(0, 4)}`;
    }

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return `Студент ${fallbackUserId.slice(0, 4)}`;
    }

    const firstName = parts[1] || parts[0];
    const lastInitial = parts[0] && parts.length > 1 ? `${parts[0][0]}.` : '';
    return `${firstName}${lastInitial ? ` ${lastInitial}` : ''}`;
}

export function explicitDisplayName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 40);
    return normalized || null;
}

function resolveDisplayName(
    userId: string,
    settingsJson: unknown,
    snapshotJson: unknown
): string {
    const settings = settingsJson && typeof settingsJson === 'object'
        ? settingsJson as Record<string, unknown>
        : {};
    const snapshot = snapshotJson && typeof snapshotJson === 'object'
        ? snapshotJson as Record<string, unknown>
        : {};
    const profileSummary = snapshot.profileSummary && typeof snapshot.profileSummary === 'object'
        ? snapshot.profileSummary as Record<string, unknown>
        : {};

    const leaderboardName = explicitDisplayName(settings.leaderboardDisplayName);
    if (leaderboardName) {
        return leaderboardName;
    }

    const fullName = typeof snapshot.fullName === 'string'
        ? snapshot.fullName
        : typeof profileSummary.fullName === 'string'
            ? profileSummary.fullName
            : null;

    return maskDisplayName(fullName, userId);
}

export function canStillClaimReferral(createdAt: Date, referredByUserId: string | null | undefined): boolean {
    if (referredByUserId) return false;
    return Date.now() <= createdAt.getTime() + CLAIM_WINDOW_MS;
}

async function loadReferralProfile(client: PoolClient, userId: string): Promise<ReferralProfileRow | null> {
    const result = await client.query<ReferralProfileRow>(
        `
            select user_id, code, created_at, updated_at, referred_by_user_id, referred_by_code, referred_at, referred_source
            from app_user_referrals
            where user_id = $1
            limit 1
        `,
        [userId]
    );
    return result.rows[0] || null;
}

async function ensureReferralProfile(client: PoolClient, userId: string): Promise<ReferralProfileRow> {
    const existing = await loadReferralProfile(client, userId);
    if (existing) {
        return existing;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const now = new Date();
        const code = buildReferralCode();
        try {
            const result = await client.query<ReferralProfileRow>(
                `
                    insert into app_user_referrals (
                        user_id,
                        code,
                        created_at,
                        updated_at,
                        referred_by_user_id,
                        referred_by_code,
                        referred_at,
                        referred_source
                    )
                    values ($1, $2, $3, $3, null, null, null, null)
                    on conflict (user_id)
                    do update set updated_at = app_user_referrals.updated_at
                    returning user_id, code, created_at, updated_at, referred_by_user_id, referred_by_code, referred_at, referred_source
                `,
                [userId, code, now]
            );
            return result.rows[0];
        } catch (error) {
            const message = error instanceof Error ? error.message.toLowerCase() : 'unknown error';
            if (!message.includes('duplicate key') && !message.includes('unique')) {
                throw error;
            }
        }
    }

    throw new Error('failed_to_generate_referral_code');
}

async function awardReferralRewards(client: PoolClient, inviterUserId: string, invitedUserId: string): Promise<void> {
    const now = new Date();

    await client.query(
        `
            insert into app_referral_reward_events (
                id,
                user_id,
                reward_type,
                referral_user_id,
                points,
                created_at,
                metadata_json
            )
            values ($1, $2, 'invite_success', $3, $4, $5, $6::jsonb)
            on conflict (user_id, reward_type, referral_user_id) do nothing
        `,
        [
            randomUUID(),
            inviterUserId,
            invitedUserId,
            INVITE_REWARD_POINTS,
            now,
            JSON.stringify({ source: 'referral', invitedUserId }),
        ]
    );

    await client.query(
        `
            insert into app_referral_reward_events (
                id,
                user_id,
                reward_type,
                referral_user_id,
                points,
                created_at,
                metadata_json
            )
            values ($1, $2, 'welcome_bonus', $3, $4, $5, $6::jsonb)
            on conflict (user_id, reward_type, referral_user_id) do nothing
        `,
        [
            randomUUID(),
            invitedUserId,
            inviterUserId,
            WELCOME_REWARD_POINTS,
            now,
            JSON.stringify({ source: 'referral', inviterUserId }),
        ]
    );
}

async function claimReferralInternal(
    client: PoolClient,
    userId: string,
    rawCode: unknown,
    source: ReferralClaimSource
): Promise<'applied' | 'invalid' | 'self' | 'already_claimed' | 'claim_window_expired'> {
    const code = normalizeReferralCode(rawCode);
    if (!code) {
        return 'invalid';
    }

    const currentProfile = await ensureReferralProfile(client, userId);
    const currentUserResult = await client.query<{ created_at: Date }>(
        `select created_at from app_users where user_id = $1 limit 1`,
        [userId]
    );
    const currentUserCreatedAt = currentUserResult.rows[0]?.created_at;
    if (!currentUserCreatedAt) {
        throw new Error('user_not_found');
    }

    if (currentProfile.referred_by_user_id) {
        return 'already_claimed';
    }

    if (!canStillClaimReferral(currentUserCreatedAt, currentProfile.referred_by_user_id)) {
        return 'claim_window_expired';
    }

    const inviterResult = await client.query<ReferralProfileRow>(
        `
            select user_id, code, created_at, updated_at, referred_by_user_id, referred_by_code, referred_at, referred_source
            from app_user_referrals
            where code = $1
            limit 1
        `,
        [code]
    );
    const inviterProfile = inviterResult.rows[0];

    if (!inviterProfile) {
        return 'invalid';
    }
    if (inviterProfile.user_id === userId) {
        return 'self';
    }

    await client.query(
        `
            update app_user_referrals
            set referred_by_user_id = $2,
                referred_by_code = $3,
                referred_at = $4,
                referred_source = $5,
                updated_at = $4
            where user_id = $1
              and referred_by_user_id is null
        `,
        [userId, inviterProfile.user_id, inviterProfile.code, new Date(), source]
    );

    // The UPDATE above is the atomic claim: `where referred_by_user_id is null`
    // means exactly one concurrent caller can win it. The loser's UPDATE touches
    // zero rows, but re-reading the row afterwards returns the WINNER's inviter.
    // So the guard has to compare identity, not truthiness — a truthiness check
    // would let the loser fall through and award rewards against its own (and
    // different) `inviterProfile`, which `awardReferralRewards` cannot dedupe
    // because its conflict target includes `referral_user_id`.
    const refreshed = await loadReferralProfile(client, userId);
    if (refreshed?.referred_by_user_id !== inviterProfile.user_id) {
        return 'already_claimed';
    }

    await awardReferralRewards(client, inviterProfile.user_id, userId);
    return 'applied';
}

export async function ensureReferralProfileForUser(userId: string): Promise<{ code: string }> {
    return requireReferralPostgres('ensureReferralProfileForUser', async (client) => {
        const profile = await ensureReferralProfile(client, userId);
        return { code: profile.code };
    });
}

export async function tryApplyReferralOnLogin(
    userId: string,
    rawCode: unknown
): Promise<{ status: ReferralAutoApplyStatus }> {
    const code = normalizeReferralCode(rawCode);
    if (!code) {
        return { status: 'missing' };
    }

    try {
        const result = await requireReferralPostgres('tryApplyReferralOnLogin', async (client) => {
            await client.query('begin');
            try {
                await ensureReferralProfile(client, userId);
                const status = await claimReferralInternal(client, userId, code, 'link');
                await client.query('commit');
                return status;
            } catch (error) {
                await client.query('rollback');
                throw error;
            }
        });

        return { status: result };
    } catch (error) {
        console.warn('[Referrals] Failed to auto-apply referral on login:', error);
        return { status: 'error' };
    }
}

export async function claimReferralCode(
    userId: string,
    rawCode: unknown
): Promise<'applied' | 'invalid' | 'self' | 'already_claimed' | 'claim_window_expired'> {
    return requireReferralPostgres('claimReferralCode', async (client) => {
        await client.query('begin');
        try {
            await ensureReferralProfile(client, userId);
            const status = await claimReferralInternal(client, userId, rawCode, 'manual');
            await client.query('commit');
            return status;
        } catch (error) {
            await client.query('rollback');
            throw error;
        }
    });
}

export async function getReferralOverview(userId: string): Promise<ReferralOverview> {
    return requireReferralPostgres('getReferralOverview', async (client) => {
        const profile = await ensureReferralProfile(client, userId);

        const userResult = await client.query<{ created_at: Date }>(
            `select created_at from app_users where user_id = $1 limit 1`,
            [userId]
        );
        const createdAt = userResult.rows[0]?.created_at ?? new Date();
        const claimWindowEndsAt = new Date(createdAt.getTime() + CLAIM_WINDOW_MS);

        const [
            rewardsResult,
            recentReferralsResult,
            referralCountResult,
            referredByResult,
            leaderboardResult,
            rankedTotalResult,
        ] = await Promise.all([
            client.query<ReferralRewardRow & { counterpart_settings_json: unknown; counterpart_snapshot_json: unknown }>(
                `
                    select
                        e.id,
                        e.user_id,
                        e.reward_type,
                        e.referral_user_id,
                        e.points,
                        e.created_at,
                        counterpart_user.settings_json as counterpart_settings_json,
                        counterpart_snapshot.snapshot_json as counterpart_snapshot_json
                    from app_referral_reward_events e
                    left join app_users counterpart_user on counterpart_user.user_id = e.referral_user_id
                    left join app_admin_user_snapshots counterpart_snapshot on counterpart_snapshot.user_id = e.referral_user_id
                    where e.user_id = $1
                    order by e.created_at desc
                    limit 12
                `,
                [userId]
            ),
            client.query<{
                user_id: string;
                referred_at: Date;
                settings_json: unknown;
                snapshot_json: unknown;
            }>(
                `
                    select
                        r.user_id,
                        r.referred_at,
                        u.settings_json,
                        s.snapshot_json
                    from app_user_referrals r
                    left join app_users u on u.user_id = r.user_id
                    left join app_admin_user_snapshots s on s.user_id = r.user_id
                    where r.referred_by_user_id = $1
                    order by r.referred_at desc nulls last, r.updated_at desc
                    limit 10
                `,
                [userId]
            ),
            client.query<{ referral_count: number }>(
                `
                    select count(*)::int as referral_count
                    from app_user_referrals
                    where referred_by_user_id = $1
                `,
                [userId]
            ),
            client.query<{
                inviter_user_id: string;
                inviter_code: string;
                referred_at: Date;
                referred_source: ReferralClaimSource;
                settings_json: unknown;
                snapshot_json: unknown;
            }>(
                `
                    select
                        inviter.user_id as inviter_user_id,
                        inviter.code as inviter_code,
                        current_profile.referred_at,
                        current_profile.referred_source,
                        inviter_user.settings_json,
                        inviter_snapshot.snapshot_json
                    from app_user_referrals current_profile
                    join app_user_referrals inviter on inviter.user_id = current_profile.referred_by_user_id
                    left join app_users inviter_user on inviter_user.user_id = inviter.user_id
                    left join app_admin_user_snapshots inviter_snapshot on inviter_snapshot.user_id = inviter.user_id
                    where current_profile.user_id = $1
                    limit 1
                `,
                [userId]
            ),
            client.query<{
                rank: number;
                user_id: string;
                referral_count: number;
                total_points: number;
                settings_json: unknown;
                snapshot_json: unknown;
            }>(
                `
                    with referral_counts as (
                        select referred_by_user_id as user_id, count(*)::int as referral_count
                        from app_user_referrals
                        where referred_by_user_id is not null
                        group by referred_by_user_id
                    ),
                    reward_totals as (
                        select user_id, coalesce(sum(points), 0)::int as total_points
                        from app_referral_reward_events
                        group by user_id
                    ),
                    ranked as (
                        select
                            profile.user_id,
                            coalesce(referral_counts.referral_count, 0) as referral_count,
                            coalesce(reward_totals.total_points, 0) as total_points,
                            users.settings_json,
                            snapshots.snapshot_json,
                            row_number() over (
                                order by
                                    coalesce(referral_counts.referral_count, 0) desc,
                                    coalesce(reward_totals.total_points, 0) desc,
                                    users.created_at asc,
                                    profile.user_id asc
                            )::int as rank
                        from app_user_referrals profile
                        join app_users users on users.user_id = profile.user_id
                        left join referral_counts on referral_counts.user_id = profile.user_id
                        left join reward_totals on reward_totals.user_id = profile.user_id
                        left join app_admin_user_snapshots snapshots on snapshots.user_id = profile.user_id
                        where coalesce(referral_counts.referral_count, 0) > 0
                           or coalesce(reward_totals.total_points, 0) > 0
                    )
                    select rank, user_id, referral_count, total_points, settings_json, snapshot_json
                    from ranked
                    where rank <= 15 or user_id = $1
                    order by rank asc
                `,
                [userId]
            ),
            client.query<{ total_ranked_users: number }>(
                `
                    with referral_counts as (
                        select referred_by_user_id as user_id, count(*)::int as referral_count
                        from app_user_referrals
                        where referred_by_user_id is not null
                        group by referred_by_user_id
                    ),
                    reward_totals as (
                        select user_id, coalesce(sum(points), 0)::int as total_points
                        from app_referral_reward_events
                        group by user_id
                    )
                    select count(*)::int as total_ranked_users
                    from app_user_referrals profile
                    left join referral_counts on referral_counts.user_id = profile.user_id
                    left join reward_totals on reward_totals.user_id = profile.user_id
                    where coalesce(referral_counts.referral_count, 0) > 0
                       or coalesce(reward_totals.total_points, 0) > 0
                `
            ),
        ]);

        const rewards = rewardsResult.rows.map((row) => ({
            id: row.id,
            type: row.reward_type,
            points: Number(row.points || 0),
            createdAt: row.created_at.toISOString(),
            counterpartUserId: row.referral_user_id,
            counterpartDisplayName: row.referral_user_id
                ? resolveDisplayName(row.referral_user_id, row.counterpart_settings_json, row.counterpart_snapshot_json)
                : null,
        }));

        const totalPoints = rewards.reduce((sum, row) => sum + row.points, 0);
        const recentReferrals = recentReferralsResult.rows.map((row) => ({
            userId: row.user_id,
            displayName: resolveDisplayName(row.user_id, row.settings_json, row.snapshot_json),
            referredAt: (row.referred_at || new Date()).toISOString(),
        }));

        const referredByRow = referredByResult.rows[0];
        const referredBy = referredByRow
            ? {
                userId: referredByRow.inviter_user_id,
                displayName: resolveDisplayName(
                    referredByRow.inviter_user_id,
                    referredByRow.settings_json,
                    referredByRow.snapshot_json
                ),
                code: referredByRow.inviter_code,
                referredAt: (referredByRow.referred_at || new Date()).toISOString(),
                source: referredByRow.referred_source || 'link',
            }
            : null;

        const leaderboardMap = new Map<number, ReferralLeaderboardEntry>();
        for (const row of leaderboardResult.rows) {
            leaderboardMap.set(row.rank, {
                rank: row.rank,
                userId: row.user_id,
                displayName: resolveDisplayName(row.user_id, row.settings_json, row.snapshot_json),
                referralCount: Number(row.referral_count || 0),
                totalPoints: Number(row.total_points || 0),
                isCurrentUser: row.user_id === userId,
            });
        }

        const leaderboard = Array.from(leaderboardMap.values()).sort((left, right) => left.rank - right.rank);
        const currentUserEntry = leaderboard.find((entry) => entry.isCurrentUser) || null;

        return {
            code: profile.code,
            inviteRewardPoints: INVITE_REWARD_POINTS,
            welcomeRewardPoints: WELCOME_REWARD_POINTS,
            totalPoints,
            referralCount: Number(referralCountResult.rows[0]?.referral_count || 0),
            myRank: currentUserEntry?.rank ?? null,
            totalRankedUsers: Number(rankedTotalResult.rows[0]?.total_ranked_users || 0),
            claimWindowEndsAt: claimWindowEndsAt.toISOString(),
            canClaimManualCode: canStillClaimReferral(createdAt, profile.referred_by_user_id),
            referredBy,
            rewards,
            recentReferrals,
            leaderboard,
            updatedAt: new Date().toISOString(),
        };
    });
}
