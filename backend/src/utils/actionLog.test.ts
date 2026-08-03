import { describe, it, expect } from 'vitest';
import { escapeActionLogLike, inferRouteKindForAction, inferStructuredFields } from './actionLog.js';
import { escapeRequestAuditLike } from './requestAudit.js';
import { escapeRuntimeTraceLike } from './runtimeTrace.js';

describe('ILIKE escaping for admin log filters', () => {
    // The admin filters build `... ilike '%<input>%'`. Values are bound as $n so
    // this was never injection, but an unescaped `%` / `_` silently broadens the
    // match — a search for `a_c` also returned `abc`. Same rule as
    // escapeSocialSearchLike in services/social.ts.

    const helpers: Array<[string, (value: string) => string]> = [
        ['escapeActionLogLike', escapeActionLogLike],
        ['escapeRequestAuditLike', escapeRequestAuditLike],
        ['escapeRuntimeTraceLike', escapeRuntimeTraceLike],
    ];

    for (const [name, escape] of helpers) {
        describe(name, () => {
            it('leaves ordinary text untouched', () => {
                expect(escape('user123')).toBe('user123');
                expect(escape('/api/v3/schedule')).toBe('/api/v3/schedule');
                expect(escape('')).toBe('');
            });

            it('escapes the single-char wildcard', () => {
                expect(escape('a_c')).toBe('a\\_c');
            });

            it('escapes the multi-char wildcard', () => {
                expect(escape('100%')).toBe('100\\%');
            });

            it('escapes backslashes first so the escape char itself is literal', () => {
                expect(escape('a\\b')).toBe('a\\\\b');
                // A pre-existing `\%` must not be read as an already-escaped `%`.
                expect(escape('\\%')).toBe('\\\\\\%');
            });

            it('handles a mixed pathological input', () => {
                expect(escape('%_\\')).toBe('\\%\\_\\\\');
            });

            it('is not idempotent by design (escape exactly once, at query build time)', () => {
                expect(escape(escape('%'))).not.toBe(escape('%'));
            });
        });
    }
});

describe('inferRouteKindForAction', () => {
    it('maps group_* prefixes to "group"', () => {
        expect(inferRouteKindForAction('group_role_assign')).toBe('group');
        expect(inferRouteKindForAction('group_post_create')).toBe('group');
        expect(inferRouteKindForAction('group_task_update')).toBe('group');
        expect(inferRouteKindForAction('group_space_update')).toBe('group');
    });

    it('maps global_chat_* prefixes to "chat"', () => {
        expect(inferRouteKindForAction('global_chat_message_create')).toBe('chat');
        expect(inferRouteKindForAction('global_chat_user_mute')).toBe('chat');
        expect(inferRouteKindForAction('global_chat_report_review')).toBe('chat');
    });

    it('maps global_feed_* prefixes to "chat" (intentional — feed shares the chat surface)', () => {
        expect(inferRouteKindForAction('global_feed_post_create')).toBe('chat');
        expect(inferRouteKindForAction('global_feed_post_pin')).toBe('chat');
    });

    it('maps friend_request_* + friend_remove + chat_* to "chat"', () => {
        expect(inferRouteKindForAction('friend_request_create')).toBe('chat');
        expect(inferRouteKindForAction('friend_request_accept')).toBe('chat');
        expect(inferRouteKindForAction('friend_remove')).toBe('chat');
        expect(inferRouteKindForAction('chat_direct_message_create')).toBe('chat');
        expect(inferRouteKindForAction('chat_room_read')).toBe('chat');
    });

    it('maps files_* / platonus_* / support_* / referral_* prefixes to their domain', () => {
        expect(inferRouteKindForAction('files_download_success')).toBe('files');
        expect(inferRouteKindForAction('files_info_view')).toBe('files');
        expect(inferRouteKindForAction('platonus_login')).toBe('platonus');
        expect(inferRouteKindForAction('platonus_disconnect')).toBe('platonus');
        expect(inferRouteKindForAction('support_request_create')).toBe('support');
        expect(inferRouteKindForAction('support_override_grant')).toBe('support');
        expect(inferRouteKindForAction('referral_claim')).toBe('referrals');
    });

    it('maps single-action types via exact match', () => {
        expect(inferRouteKindForAction('schedule_refresh')).toBe('schedule');
        expect(inferRouteKindForAction('exams_refresh')).toBe('exams');
        expect(inferRouteKindForAction('umkd_refresh')).toBe('umkd');
        expect(inferRouteKindForAction('profile_view')).toBe('profile');
        expect(inferRouteKindForAction('admin_user_hydrate')).toBe('admin');
    });

    it('maps the 6 auth-related actions to "auth"', () => {
        expect(inferRouteKindForAction('login')).toBe('auth');
        expect(inferRouteKindForAction('curator_login')).toBe('auth');
        expect(inferRouteKindForAction('login_failed')).toBe('auth');
        expect(inferRouteKindForAction('curator_login_failed')).toBe('auth');
        expect(inferRouteKindForAction('login_rate_limited')).toBe('auth');
        expect(inferRouteKindForAction('curator_login_rate_limited')).toBe('auth');
    });

    it('returns null for actions that have no route mapping', () => {
        // Some actions are cross-cutting and don't fit any single route bucket.
        // The function returns null and the caller is expected to handle it.
        expect(inferRouteKindForAction('frontend_runtime_error')).toBe(null);
        expect(inferRouteKindForAction('app_rating_submit')).toBe(null);
        expect(inferRouteKindForAction('app_feedback_submit')).toBe(null);
        expect(inferRouteKindForAction('session_revoked')).toBe(null);
        expect(inferRouteKindForAction('sessions_revoke_all')).toBe(null);
        expect(inferRouteKindForAction('curator_account_upsert')).toBe(null);
    });
});

describe('inferStructuredFields', () => {
    it('returns empty object when details is missing/null/empty', () => {
        expect(inferStructuredFields('login', null)).toEqual({});
        expect(inferStructuredFields('login', undefined)).toEqual({});
        expect(inferStructuredFields('login', '')).toEqual({});
    });

    describe('targetUserId extraction', () => {
        it('extracts userId after "user " / "user:" / "user="', () => {
            // Pattern: /user(?:\s|=|:)+([a-zA-Z0-9._-]+)/i
            expect(inferStructuredFields('login', 'user abc.123').targetUserId).toBe('abc.123');
            expect(inferStructuredFields('login', 'user=abc-123').targetUserId).toBe('abc-123');
            expect(inferStructuredFields('login', 'user: abc_123').targetUserId).toBe('abc_123');
        });

        it('extracts userId after "for " (login fallback pattern)', () => {
            // Pattern: /for\s+([a-zA-Z0-9._-]+)/i  — used in messages like "fetched fresh for abc.123"
            expect(inferStructuredFields('schedule_refresh', 'fetched fresh for abc.123').targetUserId).toBe('abc.123');
        });

        it('returns null targetUserId when no pattern matches', () => {
            expect(inferStructuredFields('login', 'random message').targetUserId).toBe(null);
        });
    });

    describe('groupKey extraction', () => {
        it('extracts groupKey after "group" / "groupKey:" / "group=" / "group "', () => {
            expect(inferStructuredFields('group_post_create', 'group CIT-23-1').groupKey).toBe('CIT-23-1');
            expect(inferStructuredFields('group_post_create', 'groupKey=CIT-23-1').groupKey).toBe('CIT-23-1');
            expect(inferStructuredFields('group_post_create', 'groupKey: CIT-23-1').groupKey).toBe('CIT-23-1');
        });

        it('returns null groupKey when no pattern matches', () => {
            expect(inferStructuredFields('group_post_create', 'random').groupKey).toBe(null);
        });
    });

    describe('entityId extraction', () => {
        it('extracts entity id after "post"/"task"/"lesson"/"file" + identifier', () => {
            expect(inferStructuredFields('group_post_create', 'post abc-123 created').entityId).toBe('abc-123');
            expect(inferStructuredFields('group_task_create', 'task xyz_456 added').entityId).toBe('xyz_456');
            expect(inferStructuredFields('group_extra_lesson_create', 'lesson 789').entityId).toBe('789');
            expect(inferStructuredFields('files_download_success', 'file abc.zip').entityId).toBe('abc');
        });

        it('returns null entityId when no entity keyword present', () => {
            expect(inferStructuredFields('login', 'just a message').entityId).toBe(null);
        });
    });

    describe('result inference (case-insensitive keyword detection)', () => {
        it('maps success-ish words to "success"', () => {
            expect(inferStructuredFields('login', 'request approved').result).toBe('success');
            expect(inferStructuredFields('group_post_create', 'post created').result).toBe('success');
            expect(inferStructuredFields('login', 'login successful').result).toBe('success');
            expect(inferStructuredFields('platonus_login', 'connected to platonus').result).toBe('success');
            expect(inferStructuredFields('schedule_refresh', 'fetched fresh data').result).toBe('success');
        });

        it('maps failure-ish words to "failed"', () => {
            expect(inferStructuredFields('login', 'login failed').result).toBe('failed');
            expect(inferStructuredFields('login', 'permission denied').result).toBe('failed');
            expect(inferStructuredFields('login', 'an error occurred').result).toBe('failed');
            expect(inferStructuredFields('files_download_failed', 'file not found').result).toBe('failed');
            expect(inferStructuredFields('group_join_request_reject', 'rejected by admin').result).toBe('failed');
        });

        it('maps "deleted" to "deleted" (overrides later "success" check via if-chain order)', () => {
            // Important behavior: the if-chain order means deleted wins over success-ish words.
            // "moved to trash, deleted" → "deleted" not "success".
            expect(inferStructuredFields('group_post_delete', 'post deleted').result).toBe('deleted');
        });

        it('maps "restored" / "restore" to "restored"', () => {
            expect(inferStructuredFields('group_post_restore', 'post restored').result).toBe('restored');
            expect(inferStructuredFields('group_post_restore', 'manual restore').result).toBe('restored');
        });

        it('returns null result when no keyword matches', () => {
            expect(inferStructuredFields('login', 'mundane message').result).toBe(null);
        });
    });

    it('integrates all 4 inference paths in one message', () => {
        const fields = inferStructuredFields(
            'group_post_create',
            'user abc.123 group CIT-23-1 created post xyz-456'
        );
        expect(fields.targetUserId).toBe('abc.123');
        expect(fields.groupKey).toBe('CIT-23-1');
        expect(fields.entityId).toBe('xyz-456');
        expect(fields.result).toBe('success');
    });
});
