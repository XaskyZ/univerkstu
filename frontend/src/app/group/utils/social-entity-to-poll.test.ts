import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import { socialEntityToPollView } from './social-entity-to-poll';

function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    reactions?: SocialEntityView['reactions'];
    myReactions?: SocialEntityView['myReactions'];
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'poll-1',
            kind: 'poll',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'starosta-1',
            payload: {
                question: 'Pick a color',
                options: [
                    { id: 'r', label: 'Red' },
                    { id: 'g', label: 'Green' },
                    { id: 'b', label: 'Blue' },
                ],
                votes: {},
            },
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: overrides.reactions ?? [],
        myReactions: overrides.myReactions ?? [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('socialEntityToPollView', () => {
    it('maps a fresh poll (no votes) into a render-ready shape', () => {
        const poll = socialEntityToPollView(makeView(), 'viewer');
        expect(poll).toMatchObject({
            id: 'poll-1',
            groupKey: 'ITS-21',
            question: 'Pick a color',
            authorUserId: 'starosta-1',
            myVote: null,
            totalVotes: 0,
            closedAt: null,
            pinned: false,
        });
        expect(poll.options).toEqual([
            { id: 'r', label: 'Red', voteCount: 0, voters: [] },
            { id: 'g', label: 'Green', voteCount: 0, voters: [] },
            { id: 'b', label: 'Blue', voteCount: 0, voters: [] },
        ]);
    });

    it('computes per-option voteCount, voters and totalVotes', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [
                        { id: 'a', label: 'A' },
                        { id: 'b', label: 'B' },
                    ],
                    votes: {
                        a: ['u1', 'u2', 'u3'],
                        b: ['u4'],
                    },
                },
            },
        });
        const poll = socialEntityToPollView(view, 'u5');
        expect(poll.totalVotes).toBe(4);
        expect(poll.options[0]).toEqual({ id: 'a', label: 'A', voteCount: 3, voters: ['u1', 'u2', 'u3'] });
        expect(poll.options[1]).toEqual({ id: 'b', label: 'B', voteCount: 1, voters: ['u4'] });
    });

    it('derives myVote when viewer is in a bucket', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
                    votes: { a: ['viewer'], b: [] },
                },
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.myVote).toBe('a');
    });

    it('returns myVote=null for an anonymous viewer (empty viewerUserId)', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [{ id: 'a', label: 'A' }],
                    votes: { a: ['someone'] },
                },
            },
        });
        const poll = socialEntityToPollView(view, '');
        expect(poll.myVote).toBeNull();
    });

    it('strips the `group:` prefix from scopeId', () => {
        const view = makeView({ entity: { scopeId: 'group:CSE-22A' } });
        expect(socialEntityToPollView(view, 'viewer').groupKey).toBe('CSE-22A');
    });

    it('surfaces closedAt when the poll is closed', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [{ id: 'a', label: 'A' }],
                    votes: {},
                    closedAt: '2026-05-20T10:00:00Z',
                },
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.closedAt).toBe('2026-05-20T10:00:00Z');
    });

    it('skips malformed options (missing id or label)', () => {
        // Defensive: an old payload could have an option with a numeric id
        // (legacy schema bug). The adapter must drop those rather than crash.
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [
                        { id: 'good', label: 'Good' },
                        { label: 'no-id' },
                        { id: 'no-label' },
                        null,
                        'string-row',
                    ] as unknown[],
                    votes: { good: ['u1'] },
                },
            },
        });
        const poll = socialEntityToPollView(view, 'u1');
        expect(poll.options).toEqual([
            { id: 'good', label: 'Good', voteCount: 1, voters: ['u1'] },
        ]);
        expect(poll.myVote).toBe('good');
    });

    it('ignores vote buckets pointing to unknown options', () => {
        // Defensive: if an option was removed but its bucket survives in
        // votes, totalVotes must not double-count those orphan voters.
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [{ id: 'a', label: 'A' }],
                    votes: { a: ['u1'], ghost: ['u2', 'u3'] },
                },
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.totalVotes).toBe(1);
        expect(poll.options).toHaveLength(1);
        expect(poll.options[0].voters).toEqual(['u1']);
    });

    it('reshapes server reactions into the legacy { items, mine } envelope', () => {
        const view = makeView({
            reactions: [{ emoji: '👍', count: 2 }, { emoji: '🎉', count: 1 }],
            myReactions: ['👍'],
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.reactions).toEqual({
            items: [{ emoji: '👍', count: 2 }, { emoji: '🎉', count: 1 }],
            mine: ['👍'],
        });
    });

    it('preserves soft-delete fields', () => {
        const view = makeView({
            entity: {
                deletedAt: '2026-04-01T12:00:00Z',
                deletedByUserId: 'moderator-1',
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.deletedAt).toBe('2026-04-01T12:00:00Z');
        expect(poll.deletedBy).toBe('moderator-1');
    });

    it('returns empty options array when payload omits options', () => {
        const view = makeView({ entity: { payload: { question: 'q', votes: {} } } });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.options).toEqual([]);
        expect(poll.totalVotes).toBe(0);
    });
});

describe('socialEntityToPollView — multi-choice', () => {
    it('surfaces multiChoice=false by default (legacy single-choice payloads)', () => {
        const poll = socialEntityToPollView(makeView(), 'viewer');
        expect(poll.multiChoice).toBe(false);
    });

    it('surfaces multiChoice=true when payload sets the flag', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    multiChoice: true,
                    options: [{ id: 'a', label: 'A' }],
                    votes: {},
                },
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.multiChoice).toBe(true);
    });

    it('collects every option the viewer voted for into myVotes (multi-choice)', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    multiChoice: true,
                    options: [
                        { id: 'a', label: 'A' },
                        { id: 'b', label: 'B' },
                        { id: 'c', label: 'C' },
                    ],
                    votes: { a: ['alice'], b: ['bob'], c: ['alice', 'carol'] },
                },
            },
        });
        const poll = socialEntityToPollView(view, 'alice');
        // myVote (singular) — first selection for legacy clients.
        expect(poll.myVote).toBe('a');
        // myVotes (plural) — every selection in payload order.
        expect(poll.myVotes).toEqual(['a', 'c']);
    });

    it('myVotes is length-1 for a single-choice payload with one viewer pick', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
                    votes: { a: ['viewer'], b: [] },
                },
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.myVote).toBe('a');
        expect(poll.myVotes).toEqual(['a']);
    });

    it('myVotes is [] for an anonymous viewer regardless of payload', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    multiChoice: true,
                    options: [{ id: 'a', label: 'A' }],
                    votes: { a: ['someone'] },
                },
            },
        });
        const poll = socialEntityToPollView(view, '');
        expect(poll.myVote).toBeNull();
        expect(poll.myVotes).toEqual([]);
    });

    it('ignores stray truthy non-boolean multiChoice values (only `true` flips it on)', () => {
        const view = makeView({
            entity: {
                payload: {
                    question: 'q',
                    // The jsonb column can technically hold anything; the
                    // adapter MUST treat anything-but-true as single-choice.
                    multiChoice: 'yes' as unknown as boolean,
                    options: [{ id: 'a', label: 'A' }],
                    votes: {},
                },
            },
        });
        const poll = socialEntityToPollView(view, 'viewer');
        expect(poll.multiChoice).toBe(false);
    });
});
