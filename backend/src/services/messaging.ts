import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { shimMirrorCreateChatMessage } from './chat-messages-shim.js';
import {
    shimMirrorCancel as shimMirrorCancelFriendship,
    shimMirrorRemove as shimMirrorRemoveFriendship,
    shimMirrorRespond as shimMirrorRespondFriendship,
    shimMirrorSendFriendRequest as shimMirrorSendFriendshipRequest,
} from './friends-shim.js';
import { getGroupSpaceMe } from './group-space.js';
import { getUser, updateUserSettings, userExists } from './users.js';
import type {
    ChatMessageView,
    ChatReplyPreview,
    ChatRoomDetail,
    ChatRoomKind,
    ChatRoomListItem,
    ChatUserSearchView,
    DirectMessagePrivacy,
    FriendRecommendationView,
    FriendOverview,
    FriendRequestStatus,
    FriendRequestView,
    FriendView,
    MessagingPreferencesView,
    BlockedChatUserView,
} from '../types/messaging.js';

const MAX_CHAT_MESSAGE_LENGTH = 2000;
const DEFAULT_CHAT_MESSAGE_LIMIT = 80;
const MAX_CHAT_MESSAGE_LIMIT = 150;
const DEFAULT_USER_SEARCH_LIMIT = 12;

class MessagingError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode = 400, code = 'MESSAGING_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

type PgFriendRow = {
    user_id: string;
    label: string | null;
    created_at: Date;
};

type PgFriendRequestRow = {
    id: string;
    requester_user_id: string;
    requester_label: string | null;
    target_user_id: string;
    target_label: string | null;
    status: FriendRequestStatus;
    created_at: Date;
    updated_at: Date;
};

type PgChatMessageRow = {
    id: string;
    room_id: string;
    room_kind: ChatRoomKind;
    author_user_id: string;
    author_label: string | null;
    body: string;
    created_at: Date;
    edited_at: Date | null;
    reply_to_message_id: string | null;
    reply_author_user_id: string | null;
    reply_author_label: string | null;
    reply_body: string | null;
};

type PgLastMessageRow = {
    body: string | null;
    created_at: Date | null;
};

type PgBlockedUserRow = {
    user_id: string;
    label: string | null;
    reason: string | null;
    created_at: Date;
};

type PgRoomReadRow = {
    last_read_at: Date | null;
};

type ResolvedRoom = {
    roomId: string;
    kind: ChatRoomKind;
    title: string;
    subtitle: string | null;
    peerUserId: string | null;
    groupKey: string | null;
    canWrite: boolean;
};

async function requireMessagingPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Messaging] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

export function normalizeMultiLineText(value: string): string {
    return value
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/g, ''))
        .join('\n')
        .trim();
}

export function clampMessageLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_CHAT_MESSAGE_LIMIT;
    return Math.max(1, Math.min(Math.trunc(limit as number), MAX_CHAT_MESSAGE_LIMIT));
}

export function normalizeDirectPair(userA: string, userB: string): [string, string] {
    const pair = [userA.trim(), userB.trim()].sort((a, b) => a.localeCompare(b));
    return [pair[0], pair[1]];
}

export function normalizeDirectMessagePrivacy(value: unknown): DirectMessagePrivacy {
    return value === 'friends_only' ? 'friends_only' : 'open';
}

export function dedupeFriendRecommendations(items: FriendRecommendationView[]): FriendRecommendationView[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = item.userId.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function getChatMessageMaxLength(): number {
    return MAX_CHAT_MESSAGE_LENGTH;
}

export function buildDirectRoomId(userA: string, userB: string): string {
    const [low, high] = normalizeDirectPair(userA, userB);
    return `direct:${low}::${high}`;
}

export function parseDirectRoomId(roomId: string): { low: string; high: string } | null {
    if (!roomId.startsWith('direct:')) return null;
    const payload = roomId.slice('direct:'.length);
    const [low, high] = payload.split('::');
    if (!low || !high) return null;
    return { low, high };
}

function mapFriendRequest(row: PgFriendRequestRow, viewerUserId: string): FriendRequestView {
    return {
        id: row.id,
        requesterUserId: row.requester_user_id,
        requesterLabel: row.requester_label?.trim() || row.requester_user_id,
        targetUserId: row.target_user_id,
        targetLabel: row.target_label?.trim() || row.target_user_id,
        status: row.status,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        direction: row.requester_user_id === viewerUserId ? 'outgoing' : 'incoming',
    };
}

function mapChatMessage(row: PgChatMessageRow, viewerUserId: string): ChatMessageView {
    let replyTo: ChatReplyPreview | null = null;
    if (row.reply_to_message_id && row.reply_author_user_id && row.reply_body) {
        replyTo = {
            id: row.reply_to_message_id,
            authorUserId: row.reply_author_user_id,
            authorLabel: row.reply_author_label?.trim() || row.reply_author_user_id,
            body: row.reply_body,
        };
    }

    return {
        id: row.id,
        roomId: row.room_id,
        roomKind: row.room_kind,
        authorUserId: row.author_user_id,
        authorLabel: row.author_label?.trim() || row.author_user_id,
        body: row.body,
        createdAt: new Date(row.created_at),
        editedAt: row.edited_at ? new Date(row.edited_at) : null,
        isOwn: row.author_user_id === viewerUserId,
        replyTo,
    };
}

async function resolveUserLabel(client: PoolClient, userId: string): Promise<string> {
    const result = await client.query<{ label: string | null }>(
        `
            select coalesce(
                nullif(u.settings_json->>'leaderboardDisplayName', ''),
                nullif(s.snapshot_json->>'fullName', ''),
                nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                $1
            ) as label
            from app_users u
            left join app_admin_user_snapshots s on s.user_id = u.user_id
            where u.user_id = $1
            limit 1
        `,
        [userId]
    );

    return result.rows[0]?.label?.trim() || userId;
}

async function areUsersFriends(client: PoolClient, userA: string, userB: string): Promise<boolean> {
    const [low, high] = normalizeDirectPair(userA, userB);
    const result = await client.query(
        `select 1 from app_friends where user_low = $1 and user_high = $2 limit 1`,
        [low, high]
    );
    return result.rowCount > 0;
}

async function getDirectMessagePrivacy(client: PoolClient, userId: string): Promise<DirectMessagePrivacy> {
    const result = await client.query<{ dm_privacy: string | null }>(
        `
            select coalesce(nullif(settings_json->>'dmPrivacy', ''), 'open') as dm_privacy
            from app_users
            where user_id = $1
            limit 1
        `,
        [userId]
    );
    return normalizeDirectMessagePrivacy(result.rows[0]?.dm_privacy);
}

async function getBlockStateBetweenUsers(
    client: PoolClient,
    viewerUserId: string,
    targetUserId: string
): Promise<{ blockedByViewer: boolean; blockedViewer: boolean }> {
    const result = await client.query<{ blocked_by_viewer: boolean; blocked_viewer: boolean }>(
        `
            select
                exists(select 1 from app_chat_blocks where user_id = $1 and target_user_id = $2) as blocked_by_viewer,
                exists(select 1 from app_chat_blocks where user_id = $2 and target_user_id = $1) as blocked_viewer
        `,
        [viewerUserId, targetUserId]
    );
    return {
        blockedByViewer: Boolean(result.rows[0]?.blocked_by_viewer),
        blockedViewer: Boolean(result.rows[0]?.blocked_viewer),
    };
}

async function roomHasMessages(client: PoolClient, roomId: string): Promise<boolean> {
    const result = await client.query(
        `
            select 1
            from app_chat_messages
            where room_id = $1
              and deleted_at is null
            limit 1
        `,
        [roomId]
    );
    return result.rowCount > 0;
}

async function resolveRoom(client: PoolClient, viewerUserId: string, roomId: string): Promise<ResolvedRoom> {
    const direct = parseDirectRoomId(roomId);
    if (direct) {
        if (viewerUserId !== direct.low && viewerUserId !== direct.high) {
            throw new MessagingError('Forbidden', 403, 'ROOM_FORBIDDEN');
        }
        const peerUserId = viewerUserId === direct.low ? direct.high : direct.low;
        const [isFriend, blockState, hasMessages, peerDmPrivacy] = await Promise.all([
            areUsersFriends(client, viewerUserId, peerUserId),
            getBlockStateBetweenUsers(client, viewerUserId, peerUserId),
            roomHasMessages(client, roomId),
            getDirectMessagePrivacy(client, peerUserId),
        ]);
        if (blockState.blockedByViewer || blockState.blockedViewer) {
            throw new MessagingError('Direct room is blocked', 403, 'DIRECT_BLOCKED');
        }
        const canInitiate = isFriend || peerDmPrivacy === 'open';
        if (!hasMessages && !canInitiate) {
            throw new MessagingError('Direct room is unavailable for strangers', 403, 'DIRECT_NOT_ALLOWED');
        }
        const label = await resolveUserLabel(client, peerUserId);
        return {
            roomId,
            kind: 'direct',
            title: label,
            subtitle: peerUserId,
            peerUserId,
            groupKey: null,
            canWrite: hasMessages || canInitiate,
        };
    }

    throw new MessagingError('Unsupported room', 404, 'ROOM_NOT_FOUND');
}

async function getRoomReadState(client: PoolClient, roomId: string, viewerUserId: string): Promise<PgRoomReadRow> {
    const result = await client.query<PgRoomReadRow>(
        `select last_read_at from app_chat_room_reads where room_id = $1 and user_id = $2 limit 1`,
        [roomId, viewerUserId]
    );
    return result.rows[0] || { last_read_at: null };
}

async function getRoomLastMessage(client: PoolClient, roomId: string): Promise<PgLastMessageRow> {
    const result = await client.query<PgLastMessageRow>(
        `
            select body, created_at
            from app_chat_messages
            where room_id = $1 and deleted_at is null
            order by created_at desc
            limit 1
        `,
        [roomId]
    );
    return result.rows[0] || { body: null, created_at: null };
}

async function getRoomUnreadCount(client: PoolClient, roomId: string, viewerUserId: string, lastReadAt: Date | null): Promise<number> {
    const result = await client.query<{ count: string }>(
        `
            select count(*)::text as count
            from app_chat_messages
            where room_id = $1
              and deleted_at is null
              and author_user_id <> $2
              and ($3::timestamptz is null or created_at > $3)
        `,
        [roomId, viewerUserId, lastReadAt]
    );
    return Number(result.rows[0]?.count || 0);
}

async function buildRoomListItem(client: PoolClient, viewerUserId: string, room: ResolvedRoom): Promise<ChatRoomListItem> {
    const [readState, lastMessage] = await Promise.all([
        getRoomReadState(client, room.roomId, viewerUserId),
        getRoomLastMessage(client, room.roomId),
    ]);
    const unreadCount = await getRoomUnreadCount(client, room.roomId, viewerUserId, readState.last_read_at);
    return {
        roomId: room.roomId,
        kind: room.kind,
        title: room.title,
        subtitle: room.subtitle,
        peerUserId: room.peerUserId,
        groupKey: room.groupKey,
        unreadCount,
        lastMessagePreview: lastMessage.body,
        lastMessageAt: lastMessage.created_at ? new Date(lastMessage.created_at) : null,
    };
}

async function upsertRoomRead(client: PoolClient, roomId: string, userId: string, lastReadMessageId: string | null): Promise<void> {
    const now = new Date();
    await client.query(
        `
            insert into app_chat_room_reads (room_id, user_id, last_read_at, last_read_message_id, updated_at)
            values ($1, $2, $3, $4, $3)
            on conflict (room_id, user_id)
            do update set
                last_read_at = excluded.last_read_at,
                last_read_message_id = excluded.last_read_message_id,
                updated_at = excluded.updated_at
        `,
        [roomId, userId, now, lastReadMessageId]
    );
}

export async function searchChatUsers(viewerUserId: string, query: string): Promise<ChatUserSearchView[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    return requireMessagingPostgres('searchChatUsers', async (client) => {
        const likeValue = `%${normalized.toLowerCase()}%`;
        const result = await client.query<{
            user_id: string;
            label: string | null;
            is_friend: boolean;
            outgoing_pending: boolean;
            incoming_pending: boolean;
            blocked_by_viewer: boolean;
            blocked_viewer: boolean;
            dm_privacy: string | null;
        }>(
            `
                select
                    u.user_id,
                    coalesce(
                        nullif(u.settings_json->>'leaderboardDisplayName', ''),
                        nullif(s.snapshot_json->>'fullName', ''),
                        nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                        u.user_id
                    ) as label,
                    exists (
                        select 1 from app_friends f
                        where f.user_low = least($1, u.user_id)
                          and f.user_high = greatest($1, u.user_id)
                    ) as is_friend,
                    exists (
                        select 1 from app_friend_requests r
                        where r.requester_user_id = $1
                          and r.target_user_id = u.user_id
                          and r.status = 'pending'
                    ) as outgoing_pending,
                    exists (
                        select 1 from app_friend_requests r
                        where r.requester_user_id = u.user_id
                          and r.target_user_id = $1
                          and r.status = 'pending'
                    ) as incoming_pending,
                    exists (
                        select 1 from app_chat_blocks b
                        where b.user_id = $1
                          and b.target_user_id = u.user_id
                    ) as blocked_by_viewer,
                    exists (
                        select 1 from app_chat_blocks b
                        where b.user_id = u.user_id
                          and b.target_user_id = $1
                    ) as blocked_viewer,
                    coalesce(nullif(u.settings_json->>'dmPrivacy', ''), 'open') as dm_privacy
                from app_users u
                left join app_admin_user_snapshots s on s.user_id = u.user_id
                where u.user_id <> $1
                  and (
                    lower(u.user_id) like $2
                    or lower(coalesce(u.settings_json->>'leaderboardDisplayName', '')) like $2
                    or lower(coalesce(s.snapshot_json->>'fullName', '')) like $2
                    or lower(coalesce(s.snapshot_json#>>'{profileSummary,fullName}', '')) like $2
                  )
                order by
                    case
                        when lower(u.user_id) = lower($3) then 0
                        when lower(coalesce(u.settings_json->>'leaderboardDisplayName', '')) = lower($3) then 1
                        when lower(u.user_id) like lower($3 || '%') then 2
                        else 3
                    end,
                    u.user_id asc
                limit $4
            `,
            [viewerUserId, likeValue, normalized, DEFAULT_USER_SEARCH_LIMIT]
        );

        return result.rows.map((row) => {
            const directState = row.is_friend
                ? 'friend'
                : (row.blocked_by_viewer || row.blocked_viewer)
                    ? 'blocked'
                    : normalizeDirectMessagePrivacy(row.dm_privacy) === 'open'
                        ? 'open'
                        : 'restricted';
            const canDirectMessage = directState === 'friend' || directState === 'open';

            return {
                userId: row.user_id,
                label: row.label?.trim() || row.user_id,
                status: row.is_friend ? 'friend' : row.incoming_pending ? 'incoming' : row.outgoing_pending ? 'outgoing' : 'none',
                roomId: canDirectMessage ? buildDirectRoomId(viewerUserId, row.user_id) : null,
                canDirectMessage,
                directState,
            };
        });
    });
}

export async function sendFriendRequest(viewerUserId: string, targetUserId: string): Promise<FriendRequestView> {
    const normalizedTarget = targetUserId.trim();
    if (!normalizedTarget) {
        throw new MessagingError('targetUserId is required', 400, 'TARGET_USER_REQUIRED');
    }
    if (normalizedTarget === viewerUserId) {
        throw new MessagingError('You cannot add yourself', 400, 'FRIEND_SELF');
    }
    if (!await userExists(normalizedTarget)) {
        throw new MessagingError('User not found', 404, 'TARGET_USER_NOT_FOUND');
    }

    return requireMessagingPostgres('sendFriendRequest', async (client) => {
        if (await areUsersFriends(client, viewerUserId, normalizedTarget)) {
            throw new MessagingError('Already friends', 409, 'ALREADY_FRIENDS');
        }

        const id = randomUUID();
        const now = new Date();
        try {
            const result = await client.query<PgFriendRequestRow>(
                `
                    insert into app_friend_requests (
                        id, requester_user_id, target_user_id, status, created_at, updated_at
                    )
                    values ($1, $2, $3, 'pending', $4, $4)
                    returning
                        id,
                        requester_user_id,
                        null::text as requester_label,
                        target_user_id,
                        null::text as target_label,
                        status,
                        created_at,
                        updated_at
                `,
                [id, viewerUserId, normalizedTarget, now]
            );
            const row = result.rows[0];
            // Phase 1c dual-write into the universal social friendship store.
            // Non-fatal: failures are swallowed inside the shim so the legacy
            // write keeps the success path even if the new store hiccups.
            await shimMirrorSendFriendshipRequest({
                legacyId: row.id,
                requesterUserId: viewerUserId,
                addresseeUserId: normalizedTarget,
            });
            return {
                ...mapFriendRequest(row, viewerUserId),
                requesterLabel: await resolveUserLabel(client, viewerUserId),
                targetLabel: await resolveUserLabel(client, normalizedTarget),
            };
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
                throw new MessagingError('A pending friend request already exists', 409, 'FRIEND_REQUEST_EXISTS');
            }
            throw error;
        }
    });
}

export async function listFriendOverview(viewerUserId: string): Promise<FriendOverview> {
    const me = await getGroupSpaceMe(viewerUserId);

    return requireMessagingPostgres('listFriendOverview', async (client) => {
        const [friendsResult, requestsResult, recommendationsResult] = await Promise.all([
            client.query<PgFriendRow>(
                `
                    select
                        case when f.user_low = $1 then f.user_high else f.user_low end as user_id,
                        coalesce(
                            nullif(u.settings_json->>'leaderboardDisplayName', ''),
                            nullif(s.snapshot_json->>'fullName', ''),
                            nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                            case when f.user_low = $1 then f.user_high else f.user_low end
                        ) as label,
                        f.created_at
                    from app_friends f
                    left join app_users u
                        on u.user_id = case when f.user_low = $1 then f.user_high else f.user_low end
                    left join app_admin_user_snapshots s
                        on s.user_id = case when f.user_low = $1 then f.user_high else f.user_low end
                    where f.user_low = $1 or f.user_high = $1
                    order by f.created_at desc
                `,
                [viewerUserId]
            ),
            client.query<PgFriendRequestRow>(
                `
                    select
                        r.id,
                        r.requester_user_id,
                        coalesce(
                            nullif(requester_user.settings_json->>'leaderboardDisplayName', ''),
                            nullif(requester_snapshot.snapshot_json->>'fullName', ''),
                            nullif(requester_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                            r.requester_user_id
                        ) as requester_label,
                        r.target_user_id,
                        coalesce(
                            nullif(target_user.settings_json->>'leaderboardDisplayName', ''),
                            nullif(target_snapshot.snapshot_json->>'fullName', ''),
                            nullif(target_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                            r.target_user_id
                        ) as target_label,
                        r.status,
                        r.created_at,
                        r.updated_at
                    from app_friend_requests r
                    left join app_users requester_user on requester_user.user_id = r.requester_user_id
                    left join app_users target_user on target_user.user_id = r.target_user_id
                    left join app_admin_user_snapshots requester_snapshot on requester_snapshot.user_id = r.requester_user_id
                    left join app_admin_user_snapshots target_snapshot on target_snapshot.user_id = r.target_user_id
                    where r.status = 'pending'
                      and (r.requester_user_id = $1 or r.target_user_id = $1)
                    order by r.created_at desc
                `,
                [viewerUserId]
            ),
            me.group?.groupKey
                ? client.query<{
                    user_id: string;
                    label: string | null;
                }>(
                    `
                        select
                            m.user_id,
                            coalesce(
                                nullif(u.settings_json->>'leaderboardDisplayName', ''),
                                nullif(s.snapshot_json->>'fullName', ''),
                                nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                                m.user_id
                            ) as label
                        from app_group_memberships m
                        left join app_users u on u.user_id = m.user_id
                        left join app_admin_user_snapshots s on s.user_id = m.user_id
                        where m.group_key = $2
                          and m.active = true
                          and m.user_id <> $1
                          and not exists (
                            select 1
                            from app_friends f
                            where f.user_low = least($1, m.user_id)
                              and f.user_high = greatest($1, m.user_id)
                          )
                          and not exists (
                            select 1
                            from app_friend_requests r
                            where r.status = 'pending'
                              and (
                                (r.requester_user_id = $1 and r.target_user_id = m.user_id)
                                or (r.requester_user_id = m.user_id and r.target_user_id = $1)
                              )
                          )
                        order by lower(
                            coalesce(
                                nullif(u.settings_json->>'leaderboardDisplayName', ''),
                                nullif(s.snapshot_json->>'fullName', ''),
                                nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                                m.user_id
                            )
                        ) asc
                        limit 8
                    `,
                    [viewerUserId, me.group.groupKey]
                )
                : Promise.resolve({ rows: [] }),
        ]);

        const friends = await Promise.all(
            friendsResult.rows.map(async (row) => {
                const room = await buildRoomListItem(client, viewerUserId, {
                    roomId: buildDirectRoomId(viewerUserId, row.user_id),
                    kind: 'direct',
                    title: row.label?.trim() || row.user_id,
                    subtitle: row.user_id,
                    peerUserId: row.user_id,
                    groupKey: null,
                    canWrite: true,
                });
                return {
                    userId: row.user_id,
                    label: row.label?.trim() || row.user_id,
                    roomId: room.roomId,
                    createdAt: new Date(row.created_at),
                    lastMessageAt: room.lastMessageAt,
                    unreadCount: room.unreadCount,
                } satisfies FriendView;
            })
        );

        const requests = requestsResult.rows.map((row) => mapFriendRequest(row, viewerUserId));
        const recommended = dedupeFriendRecommendations(recommendationsResult.rows.map((row) => ({
            userId: row.user_id,
            label: row.label?.trim() || row.user_id,
            groupKey: me.group?.groupKey || null,
            reason: 'same_group',
        })));

        friends.sort((left, right) => {
            const leftTime = left.lastMessageAt?.getTime() ?? left.createdAt.getTime();
            const rightTime = right.lastMessageAt?.getTime() ?? right.createdAt.getTime();
            return rightTime - leftTime;
        });

        return {
            friends,
            incoming: requests.filter((item) => item.direction === 'incoming'),
            outgoing: requests.filter((item) => item.direction === 'outgoing'),
            recommended,
        };
    });
}

export async function respondToFriendRequest(
    viewerUserId: string,
    requestId: string,
    decision: 'accepted' | 'rejected'
): Promise<FriendRequestView> {
    return requireMessagingPostgres('respondToFriendRequest', async (client) => {
        const existingResult = await client.query<PgFriendRequestRow>(
            `
                select
                    id,
                    requester_user_id,
                    null::text as requester_label,
                    target_user_id,
                    null::text as target_label,
                    status,
                    created_at,
                    updated_at
                from app_friend_requests
                where id = $1
                limit 1
            `,
            [requestId]
        );
        const existing = existingResult.rows[0];
        if (!existing) {
            throw new MessagingError('Friend request not found', 404, 'FRIEND_REQUEST_NOT_FOUND');
        }
        if (existing.target_user_id !== viewerUserId) {
            throw new MessagingError('Forbidden', 403, 'FRIEND_REQUEST_FORBIDDEN');
        }
        if (existing.status !== 'pending') {
            throw new MessagingError('Friend request is already processed', 409, 'FRIEND_REQUEST_ALREADY_PROCESSED');
        }

        const now = new Date();
        const updatedResult = await client.query<PgFriendRequestRow>(
            `
                update app_friend_requests
                set status = $2, updated_at = $3, acted_at = $3, acted_by = $4
                where id = $1
                returning
                    id,
                    requester_user_id,
                    null::text as requester_label,
                    target_user_id,
                    null::text as target_label,
                    status,
                    created_at,
                    updated_at
            `,
            [requestId, decision, now, viewerUserId]
        );
        const updated = updatedResult.rows[0];

        if (decision === 'accepted') {
            const [low, high] = normalizeDirectPair(updated.requester_user_id, updated.target_user_id);
            await client.query(
                `
                    insert into app_friends (user_low, user_high, created_at, created_from_request_id)
                    values ($1, $2, $3, $4)
                    on conflict (user_low, user_high) do nothing
                `,
                [low, high, now, updated.id]
            );
        }

        // Phase 1c dual-write into the universal social friendship store.
        // Non-fatal: the shim swallows internal failures so the legacy
        // response path stays clean.
        await shimMirrorRespondFriendship({
            legacyId: updated.id,
            response: decision,
            requesterUserId: updated.requester_user_id,
            addresseeUserId: updated.target_user_id,
        });

        return {
            ...mapFriendRequest(updated, viewerUserId),
            requesterLabel: await resolveUserLabel(client, updated.requester_user_id),
            targetLabel: await resolveUserLabel(client, updated.target_user_id),
        };
    });
}

export async function cancelFriendRequest(viewerUserId: string, requestId: string): Promise<FriendRequestView> {
    return requireMessagingPostgres('cancelFriendRequest', async (client) => {
        const existingResult = await client.query<PgFriendRequestRow>(
            `
                select
                    id,
                    requester_user_id,
                    null::text as requester_label,
                    target_user_id,
                    null::text as target_label,
                    status,
                    created_at,
                    updated_at
                from app_friend_requests
                where id = $1
                limit 1
            `,
            [requestId]
        );
        const existing = existingResult.rows[0];
        if (!existing) {
            throw new MessagingError('Friend request not found', 404, 'FRIEND_REQUEST_NOT_FOUND');
        }
        if (existing.requester_user_id !== viewerUserId) {
            throw new MessagingError('Forbidden', 403, 'FRIEND_REQUEST_FORBIDDEN');
        }
        if (existing.status !== 'pending') {
            throw new MessagingError('Friend request is already processed', 409, 'FRIEND_REQUEST_ALREADY_PROCESSED');
        }

        const now = new Date();
        const updatedResult = await client.query<PgFriendRequestRow>(
            `
                update app_friend_requests
                set status = 'cancelled', updated_at = $2, acted_at = $2, acted_by = $3
                where id = $1
                returning
                    id,
                    requester_user_id,
                    null::text as requester_label,
                    target_user_id,
                    null::text as target_label,
                    status,
                    created_at,
                    updated_at
            `,
            [requestId, now, viewerUserId]
        );
        const updated = updatedResult.rows[0];

        // Phase 1c dual-write into the universal social friendship store.
        await shimMirrorCancelFriendship({ legacyId: updated.id });

        return {
            ...mapFriendRequest(updated, viewerUserId),
            requesterLabel: await resolveUserLabel(client, updated.requester_user_id),
            targetLabel: await resolveUserLabel(client, updated.target_user_id),
        };
    });
}

export async function removeFriend(
    viewerUserId: string,
    targetUserId: string
): Promise<{ removed: boolean; targetUserId: string }> {
    const normalizedTarget = targetUserId.trim();
    if (!normalizedTarget) {
        throw new MessagingError('targetUserId is required', 400, 'TARGET_USER_REQUIRED');
    }
    if (normalizedTarget === viewerUserId) {
        throw new MessagingError('You cannot remove yourself', 400, 'FRIEND_SELF');
    }

    return requireMessagingPostgres('removeFriend', async (client) => {
        const [low, high] = normalizeDirectPair(viewerUserId, normalizedTarget);
        const result = await client.query(
            `
                delete from app_friends
                where user_low = $1 and user_high = $2
            `,
            [low, high]
        );

        if (result.rowCount === 0) {
            throw new MessagingError('Friend relationship not found', 404, 'FRIEND_NOT_FOUND');
        }

        // Phase 1c dual-write into the universal social friendship store.
        // The shim flips the universal 'accepted' row to 'removed'.
        await shimMirrorRemoveFriendship({
            viewerUserId,
            otherUserId: normalizedTarget,
        });

        return {
            removed: true,
            targetUserId: normalizedTarget,
        };
    });
}

export async function listBlockedUsers(viewerUserId: string): Promise<BlockedChatUserView[]> {
    return requireMessagingPostgres('listBlockedUsers', async (client) => {
        const result = await client.query<PgBlockedUserRow>(
            `
                select
                    b.target_user_id as user_id,
                    coalesce(
                        nullif(u.settings_json->>'leaderboardDisplayName', ''),
                        nullif(s.snapshot_json->>'fullName', ''),
                        nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                        b.target_user_id
                    ) as label,
                    b.reason,
                    b.created_at
                from app_chat_blocks b
                left join app_users u on u.user_id = b.target_user_id
                left join app_admin_user_snapshots s on s.user_id = b.target_user_id
                where b.user_id = $1
                order by b.created_at desc
            `,
            [viewerUserId]
        );

        return result.rows.map((row) => ({
            userId: row.user_id,
            label: row.label?.trim() || row.user_id,
            reason: row.reason,
            createdAt: new Date(row.created_at),
        }));
    });
}

export async function getMessagingPreferences(viewerUserId: string): Promise<MessagingPreferencesView> {
    const user = await getUser(viewerUserId);
    return {
        dmPrivacy: normalizeDirectMessagePrivacy(user?.settings?.dmPrivacy),
        blockedUsers: await listBlockedUsers(viewerUserId),
    };
}

export async function updateMessagingPreferences(
    viewerUserId: string,
    dmPrivacy: DirectMessagePrivacy
): Promise<MessagingPreferencesView> {
    const normalizedPrivacy = normalizeDirectMessagePrivacy(dmPrivacy);
    const updated = await updateUserSettings(viewerUserId, { dmPrivacy: normalizedPrivacy });
    if (!updated) {
        throw new MessagingError('User not found', 404, 'USER_NOT_FOUND');
    }
    return getMessagingPreferences(viewerUserId);
}

export async function blockChatUser(
    viewerUserId: string,
    targetUserId: string,
    reason?: string | null
): Promise<BlockedChatUserView> {
    const normalizedTarget = targetUserId.trim();
    if (!normalizedTarget) {
        throw new MessagingError('targetUserId is required', 400, 'TARGET_USER_REQUIRED');
    }
    if (normalizedTarget === viewerUserId) {
        throw new MessagingError('You cannot block yourself', 400, 'BLOCK_SELF');
    }
    if (!await userExists(normalizedTarget)) {
        throw new MessagingError('User not found', 404, 'TARGET_USER_NOT_FOUND');
    }

    return requireMessagingPostgres('blockChatUser', async (client) => {
        const now = new Date();
        await client.query(
            `
                insert into app_chat_blocks (user_id, target_user_id, reason, created_at, updated_at)
                values ($1, $2, $3, $4, $4)
                on conflict (user_id, target_user_id)
                do update set reason = excluded.reason, updated_at = excluded.updated_at
            `,
            [viewerUserId, normalizedTarget, reason?.trim() || null, now]
        );

        await client.query(
            `
                delete from app_friends
                where user_low = least($1, $2)
                  and user_high = greatest($1, $2)
            `,
            [viewerUserId, normalizedTarget]
        );

        return {
            userId: normalizedTarget,
            label: await resolveUserLabel(client, normalizedTarget),
            reason: reason?.trim() || null,
            createdAt: now,
        };
    });
}

export async function unblockChatUser(
    viewerUserId: string,
    targetUserId: string
): Promise<{ unblocked: boolean; targetUserId: string }> {
    const normalizedTarget = targetUserId.trim();
    if (!normalizedTarget) {
        throw new MessagingError('targetUserId is required', 400, 'TARGET_USER_REQUIRED');
    }

    return requireMessagingPostgres('unblockChatUser', async (client) => {
        const result = await client.query(
            `
                delete from app_chat_blocks
                where user_id = $1 and target_user_id = $2
            `,
            [viewerUserId, normalizedTarget]
        );
        if (result.rowCount === 0) {
            throw new MessagingError('Block entry not found', 404, 'BLOCK_NOT_FOUND');
        }
        return {
            unblocked: true,
            targetUserId: normalizedTarget,
        };
    });
}

export async function listDialogRooms(viewerUserId: string): Promise<ChatRoomListItem[]> {
    // Only direct DMs land in the /chat «Личные» inbox. Group rooms still exist
    // but are reached through /group-space — they are intentionally excluded
    // here so the inbox shows only person-to-person conversations.
    return requireMessagingPostgres('listDialogRooms', async (client) => {
        const [friendsResult, directRoomsResult] = await Promise.all([
            client.query<PgFriendRow>(
                `
                    select
                        case when f.user_low = $1 then f.user_high else f.user_low end as user_id,
                        coalesce(
                            nullif(u.settings_json->>'leaderboardDisplayName', ''),
                            nullif(s.snapshot_json->>'fullName', ''),
                            nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                            case when f.user_low = $1 then f.user_high else f.user_low end
                        ) as label,
                        f.created_at
                    from app_friends f
                    left join app_users u
                        on u.user_id = case when f.user_low = $1 then f.user_high else f.user_low end
                    left join app_admin_user_snapshots s
                        on s.user_id = case when f.user_low = $1 then f.user_high else f.user_low end
                    where f.user_low = $1 or f.user_high = $1
                    order by f.created_at desc
                `,
                [viewerUserId]
            ),
            client.query<{ room_id: string }>(
                `
                    select distinct room_id
                    from app_chat_messages
                    where room_kind = 'direct'
                      and deleted_at is null
                      and (
                        room_id like $1
                        or room_id like $2
                      )
                `,
                [`direct:${viewerUserId}::%`, `direct:%::${viewerUserId}`]
            ),
        ]);

        const roomMap = new Map<string, ResolvedRoom>();
        friendsResult.rows.forEach((row) => {
            const roomId = buildDirectRoomId(viewerUserId, row.user_id);
            roomMap.set(roomId, {
                roomId,
                kind: 'direct',
                title: row.label?.trim() || row.user_id,
                subtitle: row.user_id,
                peerUserId: row.user_id,
                groupKey: null,
                canWrite: true,
            });
        });

        for (const row of directRoomsResult.rows) {
            if (roomMap.has(row.room_id)) continue;
            try {
                const resolved = await resolveRoom(client, viewerUserId, row.room_id);
                roomMap.set(row.room_id, resolved);
            } catch {
                // Skip direct rooms hidden by privacy or blocks.
            }
        }

        const rooms: ResolvedRoom[] = Array.from(roomMap.values());

        const items = await Promise.all(rooms.map((room) => buildRoomListItem(client, viewerUserId, room)));
        items.sort((left, right) => {
            const leftTime = left.lastMessageAt ? left.lastMessageAt.getTime() : 0;
            const rightTime = right.lastMessageAt ? right.lastMessageAt.getTime() : 0;
            if (leftTime !== rightTime) return rightTime - leftTime;
            return left.title.localeCompare(right.title, 'ru');
        });
        return items;
    });
}

async function getChatMessageById(
    client: PoolClient,
    messageId: string,
    viewerUserId: string
): Promise<ChatMessageView | null> {
    const result = await client.query<PgChatMessageRow>(
        `
            select
                m.id,
                m.room_id,
                m.room_kind,
                m.author_user_id,
                coalesce(
                    nullif(author_user.settings_json->>'leaderboardDisplayName', ''),
                    nullif(author_snapshot.snapshot_json->>'fullName', ''),
                    nullif(author_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                    m.author_user_id
                ) as author_label,
                m.body,
                m.created_at,
                m.edited_at,
                m.reply_to_message_id,
                reply.author_user_id as reply_author_user_id,
                coalesce(
                    nullif(reply_user.settings_json->>'leaderboardDisplayName', ''),
                    nullif(reply_snapshot.snapshot_json->>'fullName', ''),
                    nullif(reply_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                    reply.author_user_id
                ) as reply_author_label,
                reply.body as reply_body
            from app_chat_messages m
            left join app_users author_user on author_user.user_id = m.author_user_id
            left join app_admin_user_snapshots author_snapshot on author_snapshot.user_id = m.author_user_id
            left join app_chat_messages reply on reply.id = m.reply_to_message_id and reply.deleted_at is null
            left join app_users reply_user on reply_user.user_id = reply.author_user_id
            left join app_admin_user_snapshots reply_snapshot on reply_snapshot.user_id = reply.author_user_id
            where m.id = $1
              and m.deleted_at is null
            limit 1
        `,
        [messageId]
    );

    const row = result.rows[0];
    return row ? mapChatMessage(row, viewerUserId) : null;
}

export async function listRoomMessages(
    viewerUserId: string,
    roomId: string,
    limit?: number
): Promise<ChatRoomDetail> {
    const normalizedLimit = clampMessageLimit(limit);
    return requireMessagingPostgres('listRoomMessages', async (client) => {
        const room = await resolveRoom(client, viewerUserId, roomId);
        const result = await client.query<PgChatMessageRow>(
            `
                select
                    m.id,
                    m.room_id,
                    m.room_kind,
                    m.author_user_id,
                    coalesce(
                        nullif(author_user.settings_json->>'leaderboardDisplayName', ''),
                        nullif(author_snapshot.snapshot_json->>'fullName', ''),
                        nullif(author_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                        m.author_user_id
                    ) as author_label,
                    m.body,
                    m.created_at,
                    m.edited_at,
                    m.reply_to_message_id,
                    reply.author_user_id as reply_author_user_id,
                    coalesce(
                        nullif(reply_user.settings_json->>'leaderboardDisplayName', ''),
                        nullif(reply_snapshot.snapshot_json->>'fullName', ''),
                        nullif(reply_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                        reply.author_user_id
                    ) as reply_author_label,
                    reply.body as reply_body
                from app_chat_messages m
                left join app_users author_user on author_user.user_id = m.author_user_id
                left join app_admin_user_snapshots author_snapshot on author_snapshot.user_id = m.author_user_id
                left join app_chat_messages reply on reply.id = m.reply_to_message_id and reply.deleted_at is null
                left join app_users reply_user on reply_user.user_id = reply.author_user_id
                left join app_admin_user_snapshots reply_snapshot on reply_snapshot.user_id = reply.author_user_id
                where m.room_id = $1
                  and m.deleted_at is null
                order by m.created_at desc
                limit $2
            `,
            [room.roomId, normalizedLimit]
        );

        return {
            room: await buildRoomListItem(client, viewerUserId, room),
            messages: result.rows.reverse().map((row) => mapChatMessage(row, viewerUserId)),
            canWrite: room.canWrite,
            maxMessageLength: getChatMessageMaxLength(),
        };
    });
}

export async function markRoomRead(viewerUserId: string, roomId: string): Promise<void> {
    return requireMessagingPostgres('markRoomRead', async (client) => {
        const room = await resolveRoom(client, viewerUserId, roomId);
        const latestMessageResult = await client.query<{ id: string }>(
            `
                select id
                from app_chat_messages
                where room_id = $1
                  and deleted_at is null
                order by created_at desc
                limit 1
            `,
            [room.roomId]
        );
        await upsertRoomRead(client, room.roomId, viewerUserId, latestMessageResult.rows[0]?.id || null);
    });
}

export async function createRoomMessage(params: {
    viewerUserId: string;
    roomId: string;
    body: string;
    replyToMessageId?: string | null;
}): Promise<ChatMessageView> {
    const body = normalizeMultiLineText(params.body || '');
    if (!body) {
        throw new MessagingError('Message body is required', 400, 'MESSAGE_BODY_REQUIRED');
    }
    if (body.length > MAX_CHAT_MESSAGE_LENGTH) {
        throw new MessagingError('Message is too long', 400, 'MESSAGE_TOO_LONG');
    }

    return requireMessagingPostgres('createRoomMessage', async (client) => {
        const room = await resolveRoom(client, params.viewerUserId, params.roomId);
        if (!room.canWrite) {
            throw new MessagingError('Writing to this room is not allowed', 403, 'ROOM_WRITE_FORBIDDEN');
        }

        const replyToMessageId: string | null = params.replyToMessageId?.trim() || null;
        if (replyToMessageId) {
            const replyTargetResult = await client.query<{ id: string }>(
                `
                    select id
                    from app_chat_messages
                    where id = $1
                      and room_id = $2
                      and deleted_at is null
                    limit 1
                `,
                [replyToMessageId, room.roomId]
            );
            if (replyTargetResult.rowCount === 0) {
                throw new MessagingError('Reply target not found', 404, 'REPLY_TARGET_NOT_FOUND');
            }
        }

        const id = randomUUID();
        const now = new Date();
        await client.query(
            `
                insert into app_chat_messages (
                    id, room_id, room_kind, group_key, author_user_id, body, reply_to_message_id, created_at
                )
                values ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [
                id,
                room.roomId,
                room.kind,
                room.groupKey,
                params.viewerUserId,
                body,
                replyToMessageId,
                now,
            ]
        );

        await upsertRoomRead(client, room.roomId, params.viewerUserId, id);

        const created = await getChatMessageById(client, id, params.viewerUserId);
        if (!created) {
            throw new MessagingError('Failed to load created message', 500, 'MESSAGE_CREATE_FAILED');
        }

        // Phase 1c dual-write: mirror into app_social_entity (kind='dm_message').
        // Non-fatal — the legacy insert above already succeeded. The mirror is
        // scoped under `dm:<roomId>` so each direct room owns its own scope in
        // the universal store. Soft/restore/permanent-delete shims exist for
        // when the matching legacy routes are added.
        await shimMirrorCreateChatMessage({
            legacyId: id,
            roomId: room.roomId,
            authorUserId: params.viewerUserId,
            body,
            replyToMessageId,
        });

        return created;
    });
}

// Note: editChatMessage was removed in the /chat rewrite. The `edited_at`
// column remains in the schema so historic edit timestamps still render, and
// the endpoint can be brought back later without a migration.
