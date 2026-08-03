/**
 * Pure-helper unit tests for the social user-hint search service. The actual
 * SQL helpers are covered indirectly by route-level mocks in
 * `routes/social.test.ts`; the heavy lifting in this file is the scoring +
 * ranking logic that drives the @mention dropdown ordering.
 */
import { describe, expect, it } from 'vitest';
import {
    SOCIAL_USER_SEARCH_DEFAULT_LIMIT,
    SOCIAL_USER_SEARCH_MAX_LIMIT,
    clampSocialUserSearchLimit,
    parseSocialUserScope,
    rankSocialUserCandidates,
    scoreSocialUserHint,
} from './social-users.js';

describe('parseSocialUserScope', () => {
    it('parses a group scope', () => {
        expect(parseSocialUserScope('group:ITS-21')).toEqual({ scopeType: 'group', rawId: 'ITS-21' });
    });

    it('parses a dm scope with the legacy direct prefix preserved', () => {
        expect(parseSocialUserScope('dm:direct:alice::bob')).toEqual({
            scopeType: 'dm',
            rawId: 'direct:alice::bob',
        });
    });

    it('parses the global chat scope (soft directory of recent participants)', () => {
        expect(parseSocialUserScope('global:chat')).toEqual({
            scopeType: 'global',
            rawId: 'chat',
        });
    });

    it('rejects unknown global subscopes — only global:chat is allowed', () => {
        // Guard against typos / future scopes accidentally opening a true
        // global directory. The service must explicitly opt-in each new
        // scope id.
        expect(parseSocialUserScope('global:everyone')).toBeNull();
        expect(parseSocialUserScope('global:foo')).toBeNull();
        expect(parseSocialUserScope('global:directory')).toBeNull();
    });

    it('trims whitespace inside the global scope rawId before validating', () => {
        // We allow the parser to be lenient with surrounding whitespace
        // (matches the group scope behaviour above) but the trimmed value
        // still has to equal `chat` exactly.
        expect(parseSocialUserScope('global:  chat  ')).toEqual({
            scopeType: 'global',
            rawId: 'chat',
        });
        expect(parseSocialUserScope('global:  not-chat  ')).toBeNull();
    });

    it('returns null for unknown scope types (security: no global directory)', () => {
        expect(parseSocialUserScope('announcement:foo')).toBeNull();
        expect(parseSocialUserScope('event:42')).toBeNull();
    });

    it('returns null for missing separator', () => {
        expect(parseSocialUserScope('groupITS21')).toBeNull();
    });

    it('returns null for empty / whitespace-only / non-string input', () => {
        expect(parseSocialUserScope('')).toBeNull();
        expect(parseSocialUserScope('   ')).toBeNull();
        expect(parseSocialUserScope(undefined as unknown as string)).toBeNull();
    });

    it('returns null when the raw id is missing', () => {
        expect(parseSocialUserScope('group:')).toBeNull();
        expect(parseSocialUserScope('dm:')).toBeNull();
    });

    it('trims the raw id', () => {
        expect(parseSocialUserScope('group:  ITS-21  ')).toEqual({ scopeType: 'group', rawId: 'ITS-21' });
    });
});

describe('clampSocialUserSearchLimit', () => {
    it('returns the default for non-finite / non-number input', () => {
        expect(clampSocialUserSearchLimit(undefined)).toBe(SOCIAL_USER_SEARCH_DEFAULT_LIMIT);
        expect(clampSocialUserSearchLimit(null)).toBe(SOCIAL_USER_SEARCH_DEFAULT_LIMIT);
        expect(clampSocialUserSearchLimit(Number.NaN)).toBe(SOCIAL_USER_SEARCH_DEFAULT_LIMIT);
        expect(clampSocialUserSearchLimit('5' as unknown as number)).toBe(SOCIAL_USER_SEARCH_DEFAULT_LIMIT);
    });

    it('floors fractional limits and clamps below 1', () => {
        expect(clampSocialUserSearchLimit(3.7)).toBe(3);
        expect(clampSocialUserSearchLimit(0)).toBe(1);
        expect(clampSocialUserSearchLimit(-5)).toBe(1);
    });

    it('caps at SOCIAL_USER_SEARCH_MAX_LIMIT', () => {
        expect(clampSocialUserSearchLimit(SOCIAL_USER_SEARCH_MAX_LIMIT + 100)).toBe(SOCIAL_USER_SEARCH_MAX_LIMIT);
    });
});

describe('scoreSocialUserHint', () => {
    it('returns 0 for empty query', () => {
        expect(scoreSocialUserHint({ userId: 'alice' }, '')).toBe(0);
    });

    it('returns 0 when neither field contains the query', () => {
        expect(scoreSocialUserHint({ userId: 'alice', displayName: 'Alice' }, 'zzz')).toBe(0);
    });

    it('scores exact userId match highest', () => {
        expect(scoreSocialUserHint({ userId: 'alice' }, 'alice')).toBe(100);
    });

    it('scores exact displayName match below exact userId match', () => {
        expect(scoreSocialUserHint({ userId: 'user42', displayName: 'Alice' }, 'alice')).toBe(90);
    });

    it('scores userId prefix above displayName prefix', () => {
        expect(scoreSocialUserHint({ userId: 'alicex', displayName: 'zzz' }, 'al')).toBe(50);
        expect(scoreSocialUserHint({ userId: 'user42', displayName: 'Alice Smith' }, 'al')).toBe(45);
    });

    it('scores substring match below prefix match', () => {
        expect(scoreSocialUserHint({ userId: 'xxalicexx', displayName: 'zzz' }, 'al')).toBe(15);
        expect(scoreSocialUserHint({ userId: 'user42', displayName: 'mr alice' }, 'al')).toBe(10);
    });

    it('is case-insensitive on both sides', () => {
        expect(scoreSocialUserHint({ userId: 'AlIce', displayName: 'AlIcE' }, 'ALICE')).toBe(100);
    });
});

describe('rankSocialUserCandidates', () => {
    const pool = [
        { userId: 'alice', displayName: 'Alice Carter' },
        { userId: 'alex', displayName: 'Alex Johnson' },
        { userId: 'bob', displayName: 'Robert Smith' },
        { userId: 'al_ferguson', displayName: 'AL Ferguson' },
        { userId: 'noise', displayName: 'No relation' },
    ];

    it('returns empty list when nothing matches', () => {
        expect(rankSocialUserCandidates(pool, 'zzz', 10)).toEqual([]);
    });

    it('orders by score then userId ascending', () => {
        const out = rankSocialUserCandidates(pool, 'al', 10);
        // all of alice/alex/al_ferguson have userId prefix score 50; sorted by userId asc.
        expect(out.map((h) => h.userId)).toEqual(['al_ferguson', 'alex', 'alice']);
    });

    it('exact userId match always wins', () => {
        const out = rankSocialUserCandidates(pool, 'alex', 10);
        expect(out[0].userId).toBe('alex');
    });

    it('honours the limit', () => {
        const out = rankSocialUserCandidates(pool, 'al', 2);
        expect(out).toHaveLength(2);
    });

    it('drops the displayName field when the candidate has none', () => {
        const out = rankSocialUserCandidates(
            [{ userId: 'alice', displayName: null }, { userId: 'alex' }],
            'al',
            10,
        );
        for (const hint of out) {
            expect(hint.displayName).toBeUndefined();
        }
    });

    it('preserves the displayName when present', () => {
        const out = rankSocialUserCandidates([{ userId: 'alice', displayName: 'Alice' }], 'ali', 10);
        expect(out[0]).toEqual({ userId: 'alice', displayName: 'Alice' });
    });

    it('survives an empty input list', () => {
        expect(rankSocialUserCandidates([], 'al', 10)).toEqual([]);
    });
});

/**
 * Ranking-flavoured tests scoped to the global chat directory — the SQL side
 * is mocked indirectly via the shared `rankSocialUserCandidates` helper, so
 * these cases confirm the contract `searchSocialUsers` relies on when it
 * feeds the recent-participants pool through the ranker. Together with the
 * `parseSocialUserScope` cases above this gives us 5+ new global-scope cases.
 */
describe('rankSocialUserCandidates — global chat directory shape', () => {
    // Simulated recent-participants pool — what `loadGlobalChatCandidates`
    // would return (already excluding the viewer). Recency ordering is
    // captured by the SQL `order by max(created_at) desc`; the ranker only
    // sees the userId/displayName pair so the order doesn't survive into the
    // ranked output (score + alphabetical break it).
    const recentGlobalParticipants = [
        { userId: 'curator_alex', displayName: 'Alex (curator)' },
        { userId: 'alice', displayName: 'Alice Carter' },
        { userId: 'bob_smith', displayName: 'Bob Smith' },
        { userId: 'almira', displayName: null },
        { userId: 'noise', displayName: 'Different person' },
    ];

    it('matches the recent global participants on a userId prefix', () => {
        const out = rankSocialUserCandidates(recentGlobalParticipants, 'al', 10);
        // All three of curator_alex / alice / almira contain `al`, but only
        // alice + almira have a userId-prefix score (50). curator_alex hits
        // the substring branch (15). Display order: prefix matches first
        // (alphabetical), then substring matches.
        expect(out.map((h) => h.userId)).toEqual(['alice', 'almira', 'curator_alex']);
    });

    it('promotes an exact userId match above prefix candidates', () => {
        const out = rankSocialUserCandidates(recentGlobalParticipants, 'alice', 10);
        expect(out[0].userId).toBe('alice');
    });

    it('honours the limit when more than N participants match', () => {
        const out = rankSocialUserCandidates(recentGlobalParticipants, 'al', 2);
        expect(out).toHaveLength(2);
        expect(out.map((h) => h.userId)).toEqual(['alice', 'almira']);
    });

    it('returns [] when no recent participant matches the query', () => {
        const out = rankSocialUserCandidates(recentGlobalParticipants, 'zzz_nobody', 10);
        expect(out).toEqual([]);
    });

    it('preserves the displayName when present and drops it when null (global pool shape)', () => {
        const out = rankSocialUserCandidates(recentGlobalParticipants, 'al', 10);
        const alice = out.find((h) => h.userId === 'alice');
        const almira = out.find((h) => h.userId === 'almira');
        expect(alice?.displayName).toBe('Alice Carter');
        expect(almira?.displayName).toBeUndefined();
    });
});
