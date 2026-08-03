import { FastifyInstance, FastifyRequest } from 'fastify';
import { logAction } from '../utils/actionLog.js';
import { traceRuntime } from '../utils/runtimeTrace.js';
import {
    assertCanReadGroup,
    assignRoleAsUser,
    createMembershipDispute,
    createGroupExtraLesson,
    createGroupTask,
    createGroupPost,
    createJoinRequest,
    deleteGroupExtraLesson,
    deleteGroupTask,
    deleteGroupPost,
    findGroupPostViewById,
    permanentlyDeleteGroupPost,
    getEffectiveAccess,
    getGroupCatalog,
    getGroupSpaceMe,
    getCuratorStudentDetail,
    listDeletedGroupExtraLessons,
    listDeletedGroupPosts,
    listDeletedGroupTasks,
    listGroupMembershipDisputes,
    listGroupJoinRequests,
    listGroupMembers,
    listGroupPosts,
    listContentRevisions,
    listCuratorStudents,
    listGroupExtraLessons,
    listGroupTasks,
    listOwnMembershipDisputes,
    listOwnJoinRequests,
    listRoleAssignments,
    normalizeGroupKey,
    restoreDeletedGroupExtraLesson,
    restoreDeletedGroupPost,
    restoreDeletedGroupTask,
    reviewJoinRequest,
    reviewMembershipDispute,
    removeGroupMember,
    restoreContentRevision,
    revokeRoleAsUser,
    toggleGroupTaskCompletion,
    updateGroupExtraLesson,
    updateGroupPost,
    updateGroupTask,
} from '../services/group-space.js';
import {
    listCoordinatorAnnouncementsForGroup,
    markCoordinatorAnnouncementViewed,
} from '../services/coordinator-announcements.js';
import {
    addGroupFile,
    addGroupLink,
    deleteGroupFile,
    deleteGroupLink,
    listGroupFiles,
    listGroupLinks,
    MAX_FILE_DESCRIPTION_LENGTH,
    MAX_FILE_ID_LENGTH,
    MAX_FILE_MIME_LENGTH,
    MAX_FILE_TITLE_LENGTH,
    MAX_LINK_DESCRIPTION_LENGTH,
    MAX_LINK_TITLE_LENGTH,
    MAX_LINK_URL_LENGTH,
} from '../services/group-files-links.js';
import {
    ALLOWED_EMOJI,
    getMyReactions,
    listReactions,
    listReactionsForPosts,
    toggleReaction,
} from '../services/group-reactions.js';
import type { GroupContentType, GroupJoinRequestStatus, GroupMembershipDisputeIssue, GroupMembershipDisputeStatus } from '../types/group.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

// Защита от megabyte-size payload'ов на user-facing freeform полях. Размеры
// согласованы с типовыми UI-лимитами; за превышением — fastify+Ajv возвращает
// 400 через attachValidation handler.
const MAX_GROUP_KEY_LENGTH = 100;
const MAX_POST_ID_LENGTH = 100;
const MAX_POST_TITLE_LENGTH = 200;
const MAX_POST_BODY_LENGTH = 8000;

const createPostBodySchema = {
    type: 'object',
    required: ['title', 'body'],
    properties: {
        groupKey: { type: ['string', 'null'], maxLength: MAX_GROUP_KEY_LENGTH },
        title: { type: 'string', minLength: 1, maxLength: MAX_POST_TITLE_LENGTH },
        body: { type: 'string', minLength: 1, maxLength: MAX_POST_BODY_LENGTH },
        pinned: { type: 'boolean' },
    },
} as const;

const updatePostBodySchema = {
    type: 'object',
    required: ['postId', 'title', 'body'],
    properties: {
        postId: { type: 'string', minLength: 1, maxLength: MAX_POST_ID_LENGTH },
        title: { type: 'string', minLength: 1, maxLength: MAX_POST_TITLE_LENGTH },
        body: { type: 'string', minLength: 1, maxLength: MAX_POST_BODY_LENGTH },
        pinned: { type: 'boolean' },
    },
} as const;

const MAX_TASK_ID_LENGTH = 100;
const MAX_TASK_TITLE_LENGTH = 300;
const MAX_TASK_SUBJECT_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 8000;
const MAX_TASK_DEADLINE_LENGTH = 30;

const taskPriorityEnum = ['low', 'medium', 'high'] as const;

const createTaskBodySchema = {
    type: 'object',
    required: ['title'],
    properties: {
        groupKey: { type: ['string', 'null'], maxLength: MAX_GROUP_KEY_LENGTH },
        title: { type: 'string', minLength: 1, maxLength: MAX_TASK_TITLE_LENGTH },
        subject: { type: ['string', 'null'], maxLength: MAX_TASK_SUBJECT_LENGTH },
        description: { type: ['string', 'null'], maxLength: MAX_TASK_DESCRIPTION_LENGTH },
        deadline: { type: ['string', 'null'], maxLength: MAX_TASK_DEADLINE_LENGTH },
        priority: { type: 'string', enum: taskPriorityEnum },
    },
} as const;

const updateTaskBodySchema = {
    type: 'object',
    required: ['taskId', 'title'],
    properties: {
        taskId: { type: 'string', minLength: 1, maxLength: MAX_TASK_ID_LENGTH },
        title: { type: 'string', minLength: 1, maxLength: MAX_TASK_TITLE_LENGTH },
        subject: { type: ['string', 'null'], maxLength: MAX_TASK_SUBJECT_LENGTH },
        description: { type: ['string', 'null'], maxLength: MAX_TASK_DESCRIPTION_LENGTH },
        deadline: { type: ['string', 'null'], maxLength: MAX_TASK_DEADLINE_LENGTH },
        priority: { type: 'string', enum: taskPriorityEnum },
    },
} as const;

const toggleTaskBodySchema = {
    type: 'object',
    required: ['taskId', 'completed'],
    properties: {
        taskId: { type: 'string', minLength: 1, maxLength: MAX_TASK_ID_LENGTH },
        completed: { type: 'boolean' },
    },
} as const;

// Шарится для всех /group/posts/{delete,restore-deleted,delete-permanently}.
const postIdOnlyBodySchema = {
    type: 'object',
    required: ['postId'],
    properties: {
        postId: { type: 'string', minLength: 1, maxLength: MAX_POST_ID_LENGTH },
    },
} as const;

// Шарится для /group/tasks/{delete,restore-deleted}.
const taskIdOnlyBodySchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
        taskId: { type: 'string', minLength: 1, maxLength: MAX_TASK_ID_LENGTH },
    },
} as const;

const MAX_REVISION_ID_LENGTH = 100;
const MAX_USER_ID_LENGTH = 200;

const revisionRestoreBodySchema = {
    type: 'object',
    required: ['revisionId'],
    properties: {
        revisionId: { type: 'string', minLength: 1, maxLength: MAX_REVISION_ID_LENGTH },
    },
} as const;

const MAX_LESSON_ID_LENGTH = 100;
const MAX_LESSON_TITLE_LENGTH = 300;
const MAX_LESSON_DATE_LENGTH = 30;
const MAX_LESSON_TIME_LENGTH = 30;
const MAX_LESSON_ROOM_LENGTH = 100;
const MAX_LESSON_TEACHER_LENGTH = 200;
const MAX_LESSON_NOTE_LENGTH = 2000;

const createExtraLessonBodySchema = {
    type: 'object',
    required: ['title', 'date', 'startTime', 'endTime'],
    properties: {
        groupKey: { type: ['string', 'null'], maxLength: MAX_GROUP_KEY_LENGTH },
        title: { type: 'string', minLength: 1, maxLength: MAX_LESSON_TITLE_LENGTH },
        date: { type: 'string', minLength: 1, maxLength: MAX_LESSON_DATE_LENGTH },
        startTime: { type: 'string', minLength: 1, maxLength: MAX_LESSON_TIME_LENGTH },
        endTime: { type: 'string', minLength: 1, maxLength: MAX_LESSON_TIME_LENGTH },
        room: { type: ['string', 'null'], maxLength: MAX_LESSON_ROOM_LENGTH },
        teacher: { type: ['string', 'null'], maxLength: MAX_LESSON_TEACHER_LENGTH },
        note: { type: ['string', 'null'], maxLength: MAX_LESSON_NOTE_LENGTH },
    },
} as const;

const updateExtraLessonBodySchema = {
    type: 'object',
    required: ['lessonId', 'title', 'date', 'startTime', 'endTime'],
    properties: {
        lessonId: { type: 'string', minLength: 1, maxLength: MAX_LESSON_ID_LENGTH },
        title: { type: 'string', minLength: 1, maxLength: MAX_LESSON_TITLE_LENGTH },
        date: { type: 'string', minLength: 1, maxLength: MAX_LESSON_DATE_LENGTH },
        startTime: { type: 'string', minLength: 1, maxLength: MAX_LESSON_TIME_LENGTH },
        endTime: { type: 'string', minLength: 1, maxLength: MAX_LESSON_TIME_LENGTH },
        room: { type: ['string', 'null'], maxLength: MAX_LESSON_ROOM_LENGTH },
        teacher: { type: ['string', 'null'], maxLength: MAX_LESSON_TEACHER_LENGTH },
        note: { type: ['string', 'null'], maxLength: MAX_LESSON_NOTE_LENGTH },
    },
} as const;

// Шарится для /extra-lessons/delete и /extra-lessons/restore-deleted (одно поле).
const lessonIdOnlyBodySchema = {
    type: 'object',
    required: ['lessonId'],
    properties: {
        lessonId: { type: 'string', minLength: 1, maxLength: MAX_LESSON_ID_LENGTH },
    },
} as const;

const MAX_REQUEST_ID_LENGTH = 100;
const MAX_DISPUTE_ID_LENGTH = 100;
const MAX_REASON_LENGTH = 2000;
const MAX_NOTE_LENGTH = 2000;

const joinRequestCreateBodySchema = {
    type: 'object',
    required: ['groupKey'],
    properties: {
        groupKey: { type: 'string', minLength: 1, maxLength: MAX_GROUP_KEY_LENGTH },
        reason: { type: ['string', 'null'], maxLength: MAX_REASON_LENGTH },
    },
} as const;

const joinRequestReviewBodySchema = {
    type: 'object',
    required: ['requestId', 'decision'],
    properties: {
        requestId: { type: 'string', minLength: 1, maxLength: MAX_REQUEST_ID_LENGTH },
        decision: { type: 'string', enum: ['approved', 'rejected'] },
        note: { type: ['string', 'null'], maxLength: MAX_NOTE_LENGTH },
    },
} as const;

const disputeCreateBodySchema = {
    type: 'object',
    required: ['groupKey', 'issueType', 'reason'],
    properties: {
        groupKey: { type: 'string', minLength: 1, maxLength: MAX_GROUP_KEY_LENGTH },
        issueType: { type: 'string', enum: ['join_blocked', 'removal_appeal', 'official_group_mismatch'] },
        reason: { type: 'string', minLength: 1, maxLength: MAX_REASON_LENGTH },
    },
} as const;

const disputeReviewBodySchema = {
    type: 'object',
    required: ['disputeId', 'decision'],
    properties: {
        disputeId: { type: 'string', minLength: 1, maxLength: MAX_DISPUTE_ID_LENGTH },
        decision: { type: 'string', enum: ['approved', 'rejected', 'needs_admin'] },
        note: { type: ['string', 'null'], maxLength: MAX_NOTE_LENGTH },
    },
} as const;

const MAX_ANNOUNCEMENT_ID_LENGTH = 100;

const announcementViewBodySchema = {
    type: 'object',
    required: ['announcementId', 'groupKey'],
    properties: {
        announcementId: { type: 'string', minLength: 1, maxLength: MAX_ANNOUNCEMENT_ID_LENGTH },
        groupKey: { type: 'string', minLength: 1, maxLength: MAX_GROUP_KEY_LENGTH },
    },
} as const;

const removeMemberBodySchema = {
    type: 'object',
    required: ['userId', 'reason'],
    properties: {
        groupKey: { type: ['string', 'null'], maxLength: MAX_GROUP_KEY_LENGTH },
        userId: { type: 'string', minLength: 1, maxLength: MAX_USER_ID_LENGTH },
        reason: { type: 'string', minLength: 1, maxLength: MAX_REASON_LENGTH },
    },
} as const;

// User-facing role mutation: только `starosta` и `helper`. Назначение coordinator/curator
// идёт через admin endpoint'ы и требует более высоких прав.
const userRoleMutationBodySchema = {
    type: 'object',
    required: ['userId', 'roleId', 'groupKey'],
    properties: {
        userId: { type: 'string', minLength: 1, maxLength: MAX_USER_ID_LENGTH },
        roleId: { type: 'string', enum: ['starosta', 'helper'] },
        groupKey: { type: 'string', minLength: 1, maxLength: MAX_GROUP_KEY_LENGTH },
        reason: { type: ['string', 'null'], maxLength: MAX_REASON_LENGTH },
    },
} as const;

// they participate in the same Ajv compile pass.
const MAX_FILE_ENTRY_ID_LENGTH = 100;
const MAX_LINK_ENTRY_ID_LENGTH = 100;

const groupLinkCreateBodySchema = {
    type: 'object',
    required: ['title', 'url'],
    properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_LINK_TITLE_LENGTH },
        url: { type: 'string', minLength: 1, maxLength: MAX_LINK_URL_LENGTH },
        description: { type: ['string', 'null'], maxLength: MAX_LINK_DESCRIPTION_LENGTH },
    },
} as const;

const groupFileCreateBodySchema = {
    type: 'object',
    required: ['title', 'fileId'],
    properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_FILE_TITLE_LENGTH },
        fileId: { type: 'string', minLength: 1, maxLength: MAX_FILE_ID_LENGTH },
        description: { type: ['string', 'null'], maxLength: MAX_FILE_DESCRIPTION_LENGTH },
        mime: { type: ['string', 'null'], maxLength: MAX_FILE_MIME_LENGTH },
        // size is bytes — large but bounded to keep Ajv happy on int input.
        sizeBytes: { type: ['integer', 'null'], minimum: 0 },
    },
} as const;

async function resolveTargetGroupKey(userId: string, requestedGroupKey?: string): Promise<string | null> {
    const normalized = requestedGroupKey?.trim();
    if (normalized) {
        return normalizeGroupKey(normalized);
    }

    const me = await getGroupSpaceMe(userId);
    return me.group?.groupKey || null;
}

export function toClientError(error: unknown, fallback: string): { statusCode: number; message: string } {
    const message = error instanceof Error ? error.message : fallback;
    const statusCode = message.includes('Forbidden') ? 403 : 400;
    return { statusCode, message };
}

export function buildUnavailableGroupSpace(note: string) {
    return {
        available: false,
        group: null,
        membership: {
            active: false,
            source: null,
        },
        access: {
            roles: [],
            permissions: {
                canManageContent: false,
                canManageMembers: false,
                canManageHelpers: false,
                canAssignStarosta: false,
                canViewAudit: false,
            },
        },
        note,
    };
}

export async function groupRoutes(app: FastifyInstance) {
    app.get('/group/me', {
        preHandler: [app.authenticate as any],
    }, async (request: AuthenticatedRequest, reply) => {
        try {
            const data = await getGroupSpaceMe(request.user.userId);
            return {
                success: true,
                data,
            };
        } catch (error) {
            request.log.error(error, '[Group] Failed to resolve group space');
            const message = error instanceof Error ? error.message : 'Unknown group/me error';

            traceRuntime({
                source: 'backend',
                scope: 'group.me',
                event: 'group_me_failed',
                level: 'error',
                userId: request.user.userId,
                message: `group/me failed for ${request.user.userId}: ${message}`,
                metadata: {
                    errorMessage: message,
                    stack: error instanceof Error ? error.stack || null : null,
                },
            });

            return reply.send({
                success: true,
                degraded: true,
                data: buildUnavailableGroupSpace('Group space is temporarily unavailable. Try again later.'),
            });
        }
    });

    app.get('/group/catalog', {
        preHandler: [app.authenticate as any],
    }, async (_request, reply) => {
        try {
            return {
                success: true,
                data: {
                    groups: await getGroupCatalog(),
                },
            };
        } catch {
            return reply.status(500).send({ success: false, error: 'Failed to load group catalog' });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/members', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    members: await listGroupMembers(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load members');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/curator/students', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    students: await listCuratorStudents(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load curator students');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Params: { userId: string }; Querystring: { groupKey?: string } }>('/group/curator/students/:userId', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            const userId = request.params.userId?.trim() || '';
            if (!groupKey || !userId) {
                return reply.status(400).send({ success: false, error: 'groupKey and userId are required' });
            }

            const student = await getCuratorStudentDetail(authRequest.user.userId, groupKey, userId);
            if (!student) {
                return reply.status(404).send({ success: false, error: 'Student not found in group' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    student,
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load curator student detail');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/coordinator-announcements', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    announcements: await listCoordinatorAnnouncementsForGroup(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load coordinator announcements');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { announcementId?: string; groupKey?: string };
    }>('/group/coordinator-announcements/view', {
        preHandler: [app.authenticate as any],
        schema: { body: announcementViewBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'announcementId and groupKey are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const announcementId = request.body.announcementId!.trim();
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.body.groupKey);
            if (!announcementId || !groupKey) {
                return reply.status(400).send({ success: false, error: 'announcementId and groupKey are required' });
            }

            await markCoordinatorAnnouncementViewed({
                actorUserId: authRequest.user.userId,
                announcementId,
                groupKey,
            });

            return {
                success: true,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to mark announcement as viewed');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { groupKey?: string; userId?: string; reason?: string };
    }>('/group/members/remove', {
        preHandler: [app.authenticate as any],
        schema: { body: removeMemberBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'groupKey, userId and reason are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const targetUserId = request.body.userId!.trim();
            const reason = request.body.reason!.trim();
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.body.groupKey);

            if (!groupKey || !targetUserId || !reason) {
                return reply.status(400).send({ success: false, error: 'groupKey, userId and reason are required' });
            }

            const removed = await removeGroupMember({
                actorUserId: authRequest.user.userId,
                targetUserId,
                groupKey,
                reason,
            });

            if (removed) {
                logAction(
                    authRequest.user.userId,
                    'group_member_remove',
                    `Removed member ${targetUserId} from group ${groupKey}; reason=${reason}`
                );
            }

            return {
                success: true,
                data: { removed },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to remove member');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/feed', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            const posts = await listGroupPosts(authRequest.user.userId, groupKey);
            // Reaction aggregates + per-user "mine" picks are fetched in two batched
            // queries so the feed can render the bar inline without a per-post
            // round trip. Privacy: aggregates carry only counts, never userIds.
            const postIds = posts.map((p) => p.id);
            const [aggregatesMap, mineMap] = await Promise.all([
                listReactionsForPosts(postIds),
                getMyReactions(postIds, authRequest.user.userId),
            ]);
            const enrichedPosts = posts.map((post) => ({
                ...post,
                reactions: {
                    items: aggregatesMap.get(post.id) || [],
                    mine: mineMap.get(post.id) || [],
                },
            }));

            return {
                success: true,
                data: {
                    groupKey,
                    posts: enrichedPosts,
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load feed');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/feed/deleted', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    posts: await listDeletedGroupPosts(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load deleted posts');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/tasks', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    tasks: await listGroupTasks(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load tasks');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/tasks/deleted', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    tasks: await listDeletedGroupTasks(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load deleted tasks');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{
        Querystring: { groupKey?: string; contentType?: GroupContentType; entityId?: string };
    }>('/group/revisions', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const contentType = request.query.contentType;
            const entityId = request.query.entityId?.trim() || '';
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);

            if (!groupKey || !contentType || !entityId) {
                return reply.status(400).send({ success: false, error: 'groupKey, contentType and entityId are required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    contentType,
                    entityId,
                    revisions: await listContentRevisions({
                        actorUserId: authRequest.user.userId,
                        groupKey,
                        contentType,
                        entityId,
                    }),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load revisions');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { revisionId?: string };
    }>('/group/revisions/restore', {
        preHandler: [app.authenticate as any],
        schema: { body: revisionRestoreBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'revisionId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const revisionId = request.body.revisionId!.trim();

            if (!revisionId) {
                return reply.status(400).send({ success: false, error: 'revisionId is required' });
            }

            const restored = await restoreContentRevision({
                actorUserId: authRequest.user.userId,
                revisionId,
            });

            const actionMap = {
                post: 'group_post_restore',
                task: 'group_task_restore',
                extra_lesson: 'group_extra_lesson_restore',
            } as const;

            logAction(
                authRequest.user.userId,
                actionMap[restored.contentType],
                `Restored ${restored.contentType} ${restored.entityId} in group ${restored.groupKey} from revision ${revisionId}`
            );

            return {
                success: true,
                data: restored,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to restore revision');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { groupKey?: string; title?: string; body?: string; pinned?: boolean };
    }>('/group/posts', {
        preHandler: [app.authenticate as any],
        schema: { body: createPostBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'groupKey, title and body are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            // Ajv уже гарантировал тип+длину; trim руками (Ajv не trim'ит).
            const title = (request.body.title ?? '').trim();
            const body = (request.body.body ?? '').trim();
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.body.groupKey);

            if (!groupKey || !title || !body) {
                return reply.status(400).send({ success: false, error: 'groupKey, title and body are required' });
            }

            const created = await createGroupPost({
                actorUserId: authRequest.user.userId,
                groupKey,
                title,
                body,
                pinned: Boolean(request.body?.pinned),
            });

            logAction(
                authRequest.user.userId,
                'group_post_create',
                `Created post "${created.title}" in group ${groupKey}${created.pinned ? ' [pinned]' : ''}`
            );

            return {
                success: true,
                data: created,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to create post');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { postId?: string; title?: string; body?: string; pinned?: boolean };
    }>('/group/posts/update', {
        preHandler: [app.authenticate as any],
        schema: { body: updatePostBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'postId, title and body are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const postId = request.body.postId!.trim();
            const title = request.body.title!.trim();
            const body = request.body.body!.trim();

            if (!postId || !title || !body) {
                return reply.status(400).send({ success: false, error: 'postId, title and body are required' });
            }

            const updated = await updateGroupPost({
                actorUserId: authRequest.user.userId,
                postId,
                title,
                body,
                pinned: Boolean(request.body?.pinned),
            });

            logAction(
                authRequest.user.userId,
                'group_post_update',
                `Updated post ${updated.id} in group ${updated.groupKey}; title="${updated.title}"; pinned=${updated.pinned ? 'true' : 'false'}`
            );

            return {
                success: true,
                data: updated,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to update post');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: {
            groupKey?: string;
            title?: string;
            subject?: string;
            description?: string;
            deadline?: string;
            priority?: 'low' | 'medium' | 'high';
        };
    }>('/group/tasks', {
        preHandler: [app.authenticate as any],
        schema: { body: createTaskBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'groupKey and title are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const title = request.body.title!.trim();
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.body.groupKey);

            if (!groupKey || !title) {
                return reply.status(400).send({ success: false, error: 'groupKey and title are required' });
            }

            const created = await createGroupTask({
                actorUserId: authRequest.user.userId,
                groupKey,
                title,
                subject: request.body.subject?.trim() || null,
                description: request.body.description?.trim() || null,
                deadline: request.body.deadline?.trim() || null,
                priority: request.body.priority,
            });

            logAction(
                authRequest.user.userId,
                'group_task_create',
                `Created task "${created.title}" in group ${groupKey}; priority=${created.priority}; deadline=${created.deadline || 'none'}`
            );

            return {
                success: true,
                data: created,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to create task');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: {
            taskId?: string;
            title?: string;
            subject?: string;
            description?: string;
            deadline?: string;
            priority?: 'low' | 'medium' | 'high';
        };
    }>('/group/tasks/update', {
        preHandler: [app.authenticate as any],
        schema: { body: updateTaskBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'taskId and title are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const taskId = request.body.taskId!.trim();
            const title = request.body.title!.trim();

            if (!taskId || !title) {
                return reply.status(400).send({ success: false, error: 'taskId and title are required' });
            }

            const updated = await updateGroupTask({
                actorUserId: authRequest.user.userId,
                taskId,
                title,
                subject: request.body.subject?.trim() || null,
                description: request.body.description?.trim() || null,
                deadline: request.body.deadline?.trim() || null,
                priority: request.body.priority,
            });

            logAction(
                authRequest.user.userId,
                'group_task_update',
                `Updated task ${updated.id} in group ${updated.groupKey}; title="${updated.title}"; priority=${updated.priority}; deadline=${updated.deadline || 'none'}`
            );

            return {
                success: true,
                data: updated,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to update task');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { postId?: string };
    }>('/group/posts/delete', {
        preHandler: [app.authenticate as any],
        schema: { body: postIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'postId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const postId = request.body.postId!.trim();
            if (!postId) {
                return reply.status(400).send({ success: false, error: 'postId is required' });
            }

            const deleted = await deleteGroupPost({
                actorUserId: authRequest.user.userId,
                postId,
            });

            if (deleted) {
                logAction(authRequest.user.userId, 'group_post_delete', `Moved post ${postId} to deleted items`);
            }

            return {
                success: true,
                data: { deleted },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to delete post');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { postId?: string };
    }>('/group/posts/restore-deleted', {
        preHandler: [app.authenticate as any],
        schema: { body: postIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'postId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const postId = request.body.postId!.trim();
            if (!postId) {
                return reply.status(400).send({ success: false, error: 'postId is required' });
            }

            const restored = await restoreDeletedGroupPost({
                actorUserId: authRequest.user.userId,
                postId,
            });

            logAction(
                authRequest.user.userId,
                'group_post_restore_deleted',
                `Restored deleted post ${restored.id} in group ${restored.groupKey}; title="${restored.title}"`
            );

            return {
                success: true,
                data: restored,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to restore deleted post');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { postId?: string };
    }>('/group/posts/delete-permanently', {
        preHandler: [app.authenticate as any],
        schema: { body: postIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'postId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const postId = request.body.postId!.trim();
            if (!postId) {
                return reply.status(400).send({ success: false, error: 'postId is required' });
            }

            const deleted = await permanentlyDeleteGroupPost({
                actorUserId: authRequest.user.userId,
                postId,
            });

            if (deleted) {
                logAction(authRequest.user.userId, 'group_post_delete_permanently', `Permanently deleted post ${postId}`);
            }

            return {
                success: true,
                data: { deleted },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to permanently delete post');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { taskId?: string; completed?: boolean };
    }>('/group/tasks/toggle', {
        preHandler: [app.authenticate as any],
        schema: { body: toggleTaskBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'taskId and completed are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const taskId = request.body.taskId!.trim();
            if (!taskId) {
                return reply.status(400).send({ success: false, error: 'taskId and completed are required' });
            }

            const updated = await toggleGroupTaskCompletion({
                actorUserId: authRequest.user.userId,
                taskId,
                completed: request.body.completed!,
            });

            logAction(
                authRequest.user.userId,
                'group_task_toggle',
                `Changed task ${updated.id} in group ${updated.groupKey} to ${updated.completed ? 'completed' : 'open'}`
            );

            return {
                success: true,
                data: updated,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to toggle task');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { taskId?: string };
    }>('/group/tasks/delete', {
        preHandler: [app.authenticate as any],
        schema: { body: taskIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'taskId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const taskId = request.body.taskId!.trim();
            if (!taskId) {
                return reply.status(400).send({ success: false, error: 'taskId is required' });
            }

            const deleted = await deleteGroupTask({
                actorUserId: authRequest.user.userId,
                taskId,
            });

            if (deleted) {
                logAction(authRequest.user.userId, 'group_task_delete', `Moved task ${taskId} to deleted items`);
            }

            return {
                success: true,
                data: { deleted },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to delete task');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { taskId?: string };
    }>('/group/tasks/restore-deleted', {
        preHandler: [app.authenticate as any],
        schema: { body: taskIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'taskId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const taskId = request.body.taskId!.trim();
            if (!taskId) {
                return reply.status(400).send({ success: false, error: 'taskId is required' });
            }

            const restored = await restoreDeletedGroupTask({
                actorUserId: authRequest.user.userId,
                taskId,
            });

            logAction(
                authRequest.user.userId,
                'group_task_restore_deleted',
                `Restored deleted task ${restored.id} in group ${restored.groupKey}; title="${restored.title}"`
            );

            return {
                success: true,
                data: restored,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to restore deleted task');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/extra-lessons', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    lessons: await listGroupExtraLessons(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load extra lessons');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/extra-lessons/deleted', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    lessons: await listDeletedGroupExtraLessons(authRequest.user.userId, groupKey),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load deleted extra lessons');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: {
            groupKey?: string;
            title?: string;
            date?: string;
            startTime?: string;
            endTime?: string;
            room?: string;
            teacher?: string;
            note?: string;
        };
    }>('/group/extra-lessons', {
        preHandler: [app.authenticate as any],
        schema: { body: createExtraLessonBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'groupKey, title, date, startTime and endTime are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const title = request.body.title!.trim();
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.body.groupKey);

            if (!groupKey || !title) {
                return reply.status(400).send({ success: false, error: 'groupKey, title, date, startTime and endTime are required' });
            }

            const created = await createGroupExtraLesson({
                actorUserId: authRequest.user.userId,
                groupKey,
                title,
                date: request.body.date!,
                startTime: request.body.startTime!,
                endTime: request.body.endTime!,
                room: request.body.room?.trim() || null,
                teacher: request.body.teacher?.trim() || null,
                note: request.body.note?.trim() || null,
            });

            logAction(
                authRequest.user.userId,
                'group_extra_lesson_create',
                `Created extra lesson "${created.title}" in group ${groupKey}; ${created.date} ${created.startTime}-${created.endTime}`
            );

            return {
                success: true,
                data: created,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to create extra lesson');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: {
            lessonId?: string;
            title?: string;
            date?: string;
            startTime?: string;
            endTime?: string;
            room?: string;
            teacher?: string;
            note?: string;
        };
    }>('/group/extra-lessons/update', {
        preHandler: [app.authenticate as any],
        schema: { body: updateExtraLessonBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'lessonId, title, date, startTime and endTime are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const lessonId = request.body.lessonId!.trim();
            const title = request.body.title!.trim();

            if (!lessonId || !title) {
                return reply.status(400).send({ success: false, error: 'lessonId, title, date, startTime and endTime are required' });
            }

            const updated = await updateGroupExtraLesson({
                actorUserId: authRequest.user.userId,
                lessonId,
                title,
                date: request.body.date!,
                startTime: request.body.startTime!,
                endTime: request.body.endTime!,
                room: request.body.room?.trim() || null,
                teacher: request.body.teacher?.trim() || null,
                note: request.body.note?.trim() || null,
            });

            logAction(
                authRequest.user.userId,
                'group_extra_lesson_update',
                `Updated extra lesson ${updated.id} in group ${updated.groupKey}; title="${updated.title}"; ${updated.date} ${updated.startTime}-${updated.endTime}`
            );

            return {
                success: true,
                data: updated,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to update extra lesson');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { lessonId?: string };
    }>('/group/extra-lessons/delete', {
        preHandler: [app.authenticate as any],
        schema: { body: lessonIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'lessonId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const lessonId = request.body.lessonId!.trim();
            if (!lessonId) {
                return reply.status(400).send({ success: false, error: 'lessonId is required' });
            }

            const deleted = await deleteGroupExtraLesson({
                actorUserId: authRequest.user.userId,
                lessonId,
            });

            if (deleted) {
                logAction(authRequest.user.userId, 'group_extra_lesson_delete', `Moved extra lesson ${lessonId} to deleted items`);
            }

            return {
                success: true,
                data: { deleted },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to delete extra lesson');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { lessonId?: string };
    }>('/group/extra-lessons/restore-deleted', {
        preHandler: [app.authenticate as any],
        schema: { body: lessonIdOnlyBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'lessonId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const lessonId = request.body.lessonId!.trim();
            if (!lessonId) {
                return reply.status(400).send({ success: false, error: 'lessonId is required' });
            }

            const restored = await restoreDeletedGroupExtraLesson({
                actorUserId: authRequest.user.userId,
                lessonId,
            });

            logAction(
                authRequest.user.userId,
                'group_extra_lesson_restore_deleted',
                `Restored deleted extra lesson ${restored.id} in group ${restored.groupKey}; title="${restored.title}"`
            );

            return {
                success: true,
                data: restored,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to restore deleted extra lesson');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get('/group/disputes/me', {
        preHandler: [app.authenticate as any],
    }, async (request: AuthenticatedRequest, reply) => {
        try {
            return {
                success: true,
                data: {
                    disputes: await listOwnMembershipDisputes(request.user.userId),
                },
            };
        } catch {
            return reply.status(500).send({ success: false, error: 'Failed to load disputes' });
        }
    });

    app.get<{
        Querystring: { groupKey?: string; status?: GroupMembershipDisputeStatus };
    }>('/group/disputes', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    disputes: await listGroupMembershipDisputes(authRequest.user.userId, groupKey, request.query.status || 'pending'),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load disputes');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { groupKey?: string; issueType?: GroupMembershipDisputeIssue; reason?: string };
    }>('/group/disputes', {
        preHandler: [app.authenticate as any],
        schema: { body: disputeCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'groupKey, issueType and reason are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = request.body.groupKey!.trim();
            const issueType = request.body.issueType!;
            const reason = request.body.reason!.trim();

            if (!groupKey || !reason) {
                return reply.status(400).send({ success: false, error: 'groupKey, issueType and reason are required' });
            }

            const created = await createMembershipDispute({
                userId: authRequest.user.userId,
                groupKey,
                issueType,
                reason,
            });

            logAction(
                authRequest.user.userId,
                'group_membership_dispute_create',
                `Created membership dispute ${created.id} for group ${created.groupKey}; issue=${created.issueType}`
            );

            return {
                success: true,
                data: created,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to create dispute');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { disputeId?: string; decision?: Exclude<GroupMembershipDisputeStatus, 'pending'>; note?: string };
    }>('/group/disputes/review', {
        preHandler: [app.authenticate as any],
        schema: { body: disputeReviewBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'disputeId and decision are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const disputeId = request.body.disputeId!.trim();
            const decision = request.body.decision!;

            if (!disputeId) {
                return reply.status(400).send({ success: false, error: 'disputeId and decision are required' });
            }

            const reviewed = await reviewMembershipDispute({
                actorUserId: authRequest.user.userId,
                disputeId,
                decision,
                note: request.body.note?.trim() || null,
            });

            const actionMap = {
                approved: 'group_membership_dispute_approve',
                rejected: 'group_membership_dispute_reject',
                needs_admin: 'group_membership_dispute_escalate',
            } as const;

            logAction(
                authRequest.user.userId,
                actionMap[decision],
                `Reviewed dispute ${reviewed.id} for ${reviewed.userId} in group ${reviewed.groupKey}; decision=${decision}`
            );

            return {
                success: true,
                data: reviewed,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to review dispute');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get('/group/join-requests/me', {
        preHandler: [app.authenticate as any],
    }, async (request: AuthenticatedRequest, reply) => {
        try {
            return {
                success: true,
                data: {
                    requests: await listOwnJoinRequests(request.user.userId),
                },
            };
        } catch {
            return reply.status(500).send({ success: false, error: 'Failed to load join requests' });
        }
    });

    app.get<{
        Querystring: { groupKey?: string; status?: GroupJoinRequestStatus };
    }>('/group/join-requests', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = await resolveTargetGroupKey(authRequest.user.userId, request.query.groupKey);
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    requests: await listGroupJoinRequests(authRequest.user.userId, groupKey, request.query.status || 'pending'),
                },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load join requests');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { groupKey?: string; reason?: string };
    }>('/group/join-requests', {
        preHandler: [app.authenticate as any],
        schema: { body: joinRequestCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'groupKey is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = request.body.groupKey!.trim();
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            const created = await createJoinRequest({
                userId: authRequest.user.userId,
                groupKey,
                reason: request.body.reason?.trim() || null,
            });

            logAction(
                authRequest.user.userId,
                'group_join_request_create',
                `Created join request ${created.id} for group ${created.groupKey}${created.reason ? `; reason=${created.reason}` : ''}`
            );

            return {
                success: true,
                data: created,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to create join request');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { requestId?: string; decision?: 'approved' | 'rejected'; note?: string };
    }>('/group/join-requests/review', {
        preHandler: [app.authenticate as any],
        schema: { body: joinRequestReviewBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'requestId and decision are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const requestId = request.body.requestId!.trim();
            const decision = request.body.decision!;

            if (!requestId) {
                return reply.status(400).send({ success: false, error: 'requestId and decision are required' });
            }

            const reviewed = await reviewJoinRequest({
                actorUserId: authRequest.user.userId,
                requestId,
                decision,
                note: request.body.note?.trim() || null,
            });

            logAction(
                authRequest.user.userId,
                decision === 'approved' ? 'group_join_request_approve' : 'group_join_request_reject',
                `Reviewed join request ${reviewed.id} for ${reviewed.userId} in group ${reviewed.groupKey}; decision=${decision}`
            );

            return {
                success: true,
                data: reviewed,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to review join request');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Querystring: { groupKey?: string } }>('/group/roles', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const fallback = await getGroupSpaceMe(authRequest.user.userId);
            const requestedGroupKey = request.query.groupKey?.trim();
            const groupKey = requestedGroupKey
                ? normalizeGroupKey(requestedGroupKey)
                : fallback.group?.groupKey || null;

            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }

            const access = await getEffectiveAccess(authRequest.user.userId, groupKey);
            if (!access.permissions.canManageMembers && !access.permissions.canAssignStarosta) {
                return reply.status(403).send({ success: false, error: 'Forbidden' });
            }

            return {
                success: true,
                data: {
                    groupKey,
                    assignments: await listRoleAssignments({ groupKey }),
                },
            };
        } catch (error) {
            request.log.error(error, '[Group] Failed to list roles');
            return reply.status(500).send({ success: false, error: 'Failed to list roles' });
        }
    });

    app.post<{
        Body: { userId?: string; roleId?: 'starosta' | 'helper'; groupKey?: string; reason?: string };
    }>('/group/roles/assign', {
        preHandler: [app.authenticate as any],
        schema: { body: userRoleMutationBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'userId, roleId and groupKey are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const userId = request.body.userId!.trim();
            const roleId = request.body.roleId!;
            const groupKey = request.body.groupKey!.trim();

            if (!userId || !groupKey) {
                return reply.status(400).send({ success: false, error: 'userId, roleId and groupKey are required' });
            }

            const assigned = await assignRoleAsUser({
                actorUserId: authRequest.user.userId,
                targetUserId: userId,
                roleId,
                groupKey,
                reason: request.body.reason?.trim() || null,
            });

            logAction(
                authRequest.user.userId,
                'group_role_assign',
                `Assigned role ${roleId} to ${assigned.userId} in scope ${assigned.scopeId}`
            );

            return {
                success: true,
                data: assigned,
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to assign role');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Body: { userId?: string; roleId?: 'starosta' | 'helper'; groupKey?: string; reason?: string };
    }>('/group/roles/revoke', {
        preHandler: [app.authenticate as any],
        schema: { body: userRoleMutationBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'userId, roleId and groupKey are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const userId = request.body.userId!.trim();
            const roleId = request.body.roleId!;
            const groupKey = request.body.groupKey!.trim();

            if (!userId || !groupKey) {
                return reply.status(400).send({ success: false, error: 'userId, roleId and groupKey are required' });
            }

            const revoked = await revokeRoleAsUser({
                actorUserId: authRequest.user.userId,
                targetUserId: userId,
                roleId,
                groupKey,
                reason: request.body.reason?.trim() || null,
            });

            if (revoked) {
                logAction(
                    authRequest.user.userId,
                    'group_role_revoke',
                    `Revoked role ${roleId} from ${userId} in group ${normalizeGroupKey(groupKey)}`
                );
            }

            return {
                success: true,
                data: { revoked },
            };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to revoke role');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    // ------------------------------------------------------------------
    // Files & Links tab
    //
    // Six endpoints — three for links (list/create/delete), three for files
    // (list/create/delete). All gated through the standard group-space
    // authorization helpers (`assertCanReadGroup` / `assertCanManageContent`)
    // inside the service so we don't duplicate access logic here.
    //
    // The `:groupKey` segment matches the spec; the rest of the group routes
    // resolve groupKey via query/body, but the spec for this tab pinned it as
    // a path param.
    // ------------------------------------------------------------------

    app.get<{ Params: { groupKey: string } }>('/group/:groupKey/links', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = normalizeGroupKey(request.params.groupKey || '');
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }
            const links = await listGroupLinks(authRequest.user.userId, groupKey);
            return { success: true, data: { groupKey, links } };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load links');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Params: { groupKey: string };
        Body: { title?: string; url?: string; description?: string | null };
    }>('/group/:groupKey/links', {
        preHandler: [app.authenticate as any],
        schema: { body: groupLinkCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'title and url are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = normalizeGroupKey(request.params.groupKey || '');
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }
            const created = await addGroupLink(
                groupKey,
                {
                    title: request.body.title!,
                    url: request.body.url!,
                    description: request.body.description ?? null,
                },
                authRequest.user.userId
            );
            logAction(
                authRequest.user.userId,
                'group_link_create',
                `Added link "${created.title}" to group ${groupKey}`
            );
            return { success: true, data: created };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to add link');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.delete<{ Params: { groupKey: string; linkId: string } }>('/group/:groupKey/links/:linkId', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = normalizeGroupKey(request.params.groupKey || '');
            const linkId = (request.params.linkId || '').trim();
            if (!groupKey || !linkId) {
                return reply.status(400).send({ success: false, error: 'groupKey and linkId are required' });
            }
            if (linkId.length > MAX_LINK_ENTRY_ID_LENGTH) {
                return reply.status(400).send({ success: false, error: 'linkId is too long' });
            }
            const deleted = await deleteGroupLink(groupKey, linkId, authRequest.user.userId);
            if (deleted) {
                logAction(authRequest.user.userId, 'group_link_delete', `Deleted link ${linkId} from group ${groupKey}`);
            }
            return { success: true, data: { deleted } };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to delete link');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.get<{ Params: { groupKey: string } }>('/group/:groupKey/files', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = normalizeGroupKey(request.params.groupKey || '');
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }
            const files = await listGroupFiles(authRequest.user.userId, groupKey);
            return { success: true, data: { groupKey, files } };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to load files');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Params: { groupKey: string };
        Body: {
            title?: string;
            fileId?: string;
            description?: string | null;
            mime?: string | null;
            sizeBytes?: number | null;
        };
    }>('/group/:groupKey/files', {
        preHandler: [app.authenticate as any],
        schema: { body: groupFileCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'title and fileId are required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = normalizeGroupKey(request.params.groupKey || '');
            if (!groupKey) {
                return reply.status(400).send({ success: false, error: 'groupKey is required' });
            }
            const created = await addGroupFile(
                groupKey,
                {
                    title: request.body.title!,
                    fileId: request.body.fileId!,
                    description: request.body.description ?? null,
                    mime: request.body.mime ?? null,
                    sizeBytes: request.body.sizeBytes ?? null,
                },
                authRequest.user.userId
            );
            logAction(
                authRequest.user.userId,
                'group_file_create',
                `Added file entry "${created.title}" (fileId=${created.fileId}) to group ${groupKey}`
            );
            return { success: true, data: created };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to add file entry');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.delete<{ Params: { groupKey: string; fileEntryId: string } }>('/group/:groupKey/files/:fileEntryId', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const groupKey = normalizeGroupKey(request.params.groupKey || '');
            const fileEntryId = (request.params.fileEntryId || '').trim();
            if (!groupKey || !fileEntryId) {
                return reply.status(400).send({ success: false, error: 'groupKey and fileEntryId are required' });
            }
            if (fileEntryId.length > MAX_FILE_ENTRY_ID_LENGTH) {
                return reply.status(400).send({ success: false, error: 'fileEntryId is too long' });
            }
            const deleted = await deleteGroupFile(groupKey, fileEntryId, authRequest.user.userId);
            if (deleted) {
                logAction(
                    authRequest.user.userId,
                    'group_file_delete',
                    `Deleted file entry ${fileEntryId} from group ${groupKey}`
                );
            }
            return { success: true, data: { deleted } };
        } catch (error) {
            const clientError = toClientError(error, 'Failed to delete file entry');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    // ------------------------------------------------------------------
    // Feed post reactions — limited emoji set, toggle semantics, per-post.
    //
    // Two endpoints: GET (read aggregates + my picks) and POST (toggle).
    // Both gated by `assertCanReadGroup` so only members / role holders for
    // THIS group can see or change reactions. The post must belong to the
    // requested group — otherwise we reject before touching the reaction table.
    // ------------------------------------------------------------------
    const reactionToggleBodySchema = {
        type: 'object',
        required: ['emoji'],
        properties: {
            emoji: { type: 'string', enum: [...ALLOWED_EMOJI] },
        },
    } as const;

    async function resolvePostInGroup(
        userId: string,
        rawGroupKey: string,
        rawPostId: string
    ): Promise<{ groupKey: string; postId: string }> {
        const groupKey = normalizeGroupKey(rawGroupKey || '');
        const postId = (rawPostId || '').trim();
        if (!groupKey) {
            throw new Error('groupKey is required');
        }
        if (!postId) {
            throw new Error('postId is required');
        }
        if (postId.length > MAX_POST_ID_LENGTH) {
            throw new Error('postId is too long');
        }
        await assertCanReadGroup(userId, groupKey);
        const post = await findGroupPostViewById(postId);
        if (!post || post.groupKey !== groupKey) {
            // Mask "wrong group" as 404 to avoid leaking which posts exist in
            // adjacent groups.
            throw new Error('Post not found');
        }
        if (post.deletedAt) {
            throw new Error('Post not found');
        }
        return { groupKey, postId };
    }

    app.get<{ Params: { groupKey: string; postId: string } }>('/group/:groupKey/posts/:postId/reactions', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const { groupKey, postId } = await resolvePostInGroup(
                authRequest.user.userId,
                request.params.groupKey,
                request.params.postId
            );
            const [aggregates, mineMap] = await Promise.all([
                listReactions(postId),
                getMyReactions([postId], authRequest.user.userId),
            ]);
            return {
                success: true,
                data: {
                    groupKey,
                    postId,
                    reactions: aggregates,
                    mine: mineMap.get(postId) || [],
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load reactions';
            if (message === 'Post not found') {
                return reply.status(404).send({ success: false, error: message });
            }
            const clientError = toClientError(error, 'Failed to load reactions');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });

    app.post<{
        Params: { groupKey: string; postId: string };
        Body: { emoji?: string };
    }>('/group/:groupKey/posts/:postId/reactions', {
        preHandler: [app.authenticate as any],
        schema: { body: reactionToggleBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'emoji is required and must be one of the allowed set' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const { groupKey, postId } = await resolvePostInGroup(
                authRequest.user.userId,
                request.params.groupKey,
                request.params.postId
            );
            const emoji = request.body.emoji!;
            const { added } = await toggleReaction(postId, authRequest.user.userId, emoji);
            const [aggregates, mineMap] = await Promise.all([
                listReactions(postId),
                getMyReactions([postId], authRequest.user.userId),
            ]);
            return {
                success: true,
                data: {
                    groupKey,
                    postId,
                    added,
                    reactions: aggregates,
                    mine: mineMap.get(postId) || [],
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to toggle reaction';
            if (message === 'Post not found') {
                return reply.status(404).send({ success: false, error: message });
            }
            const clientError = toClientError(error, 'Failed to toggle reaction');
            return reply.status(clientError.statusCode).send({ success: false, error: clientError.message });
        }
    });
}
