'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import { useAuth } from '@/lib/auth-context';
import type { GroupCatalogItem } from '@/lib/api';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useSocialStream } from '@/lib/use-social-stream';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useGroupMembers } from '../hooks/useGroupMembers';
import MemberCard from './MemberCard';

type MembersHookState = ReturnType<typeof useGroupMembers>;

export default function MembersTab({ membersState, catalog, canManageMembers, groupKey }: { membersState: MembersHookState; catalog: GroupCatalogItem[]; canManageMembers: boolean; groupKey?: string }) {
    const { messages } = useLanguage();
    const { userId } = useAuth();
    const [query, setQuery] = useState('');
    const [joinGroupKey, setJoinGroupKey] = useState('');
    const [joinReason, setJoinReason] = useState('');
    const [removalReasons, setRemovalReasons] = useState<Record<string, string>>({});

    // Presence (SSE) — gated behind the `socialFeedBeta` opt-in. When the flag
    // is off we never open the connection and `onlineUserIds` stays empty, so
    // `MemberCard` renders without the online dot. Mirrors the bridge pattern
    // used by `DialogsPanel` / `FeedTab`.
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const presenceScope = groupKey ? `group:${groupKey}` : null;
    const [lastPresenceEvent, setLastPresenceEvent] = useState<{
        scope: string;
        onlineUserIds: string[];
        receivedAt: number;
    } | null>(null);
    useSocialStream({
        scopes: presenceScope ? [presenceScope] : [],
        enabled: socialBeta && Boolean(presenceScope),
        onEvent: (event) => {
            const forwarded = forwardPresenceOrTyping(event);
            if (forwarded?.kind === 'presence') {
                setLastPresenceEvent(forwarded.payload);
            }
        },
    });
    const presence = usePresence(presenceScope, { lastEvent: lastPresenceEvent });
    const onlineUserIds = useMemo(
        () => new Set(socialBeta ? presence.onlineUserIds : []),
        [presence.onlineUserIds, socialBeta],
    );

    const filteredMembers = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return membersState.members;
        return membersState.members.filter((member) => {
            const fullName = member.fullName || '';
            const haystack = `${fullName} ${member.userId}`.toLowerCase();
            return haystack.includes(normalized);
        });
    }, [membersState.members, query]);

    const memberSuggestions = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return [];
        return membersState.members
            .map((member, index) => {
                const fullName = member.fullName || '';
                const userId = member.userId;
                const haystack = `${fullName} ${userId}`.toLowerCase();
                let score = 0;
                if (fullName.toLowerCase() === normalized || userId.toLowerCase() === normalized) score = 400;
                else if (fullName.toLowerCase().startsWith(normalized) || userId.toLowerCase().startsWith(normalized)) score = 240;
                else if (haystack.includes(normalized)) score = 160;
                return { member, score, index };
            })
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score !== left.score ? right.score - left.score : left.index - right.index)
            .slice(0, 8)
            .map((item) => item.member);
    }, [membersState.members, query]);

    const showSuggestions = useMemo(() => {
        if (!query.trim()) return false;
        return memberSuggestions.length > 0 && !memberSuggestions.some((member) => (member.fullName || member.userId).toLowerCase() === query.trim().toLowerCase());
    }, [memberSuggestions, query]);

    return (
        <div className="space-y-4">
            <div className="card p-4 space-y-4 animate-fadeInUp">
                <div>
                    <h3 className="font-semibold text-fg">{messages.group.membersTitle}</h3>
                    <p className="text-sm mt-1 text-muted-fg">{messages.group.autoMembersHint}</p>
                </div>

                <div className="relative">
                    <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} placeholder={messages.group.membersSearchPlaceholder} className="input" />
                    {showSuggestions ? (
                        <div className="absolute z-20 left-0 right-0 mt-2 rounded-2xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                            {memberSuggestions.map((member) => (
                                <button
                                    key={`member-suggestion-${member.userId}`}
                                    type="button"
                                    onClick={() => setQuery(member.fullName || member.userId)}
                                    className="w-full px-3 py-3 text-left transition text-fg"
                                    style={{ borderTop: '1px solid var(--border)' }}
                                >
                                    <div className="text-sm font-medium">{member.fullName || member.userId}</div>
                                    <div className="text-xs font-mono mt-1 text-muted-fg">{member.userId}</div>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                {membersState.loading ? <p className="text-sm text-muted-fg">{messages.group.loadingMembers}</p> : null}
                {membersState.error ? <p className="text-sm text-danger-fg">{membersState.error}</p> : null}
                {!membersState.loading && !membersState.error && filteredMembers.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.emptyMembers}</p> : null}
                <div className="space-y-3">
                    {filteredMembers.map((member) => (
                        <MemberCard
                            key={member.userId}
                            member={member}
                            isOnline={onlineUserIds.has(member.userId)}
                            actions={canManageMembers && member.canBeRemovedManually && member.userId !== userId ? (
                                <div className="space-y-2 min-w-[180px]">
                                    <input
                                        value={removalReasons[member.userId] || ''}
                                        onChange={(e) => setRemovalReasons((current) => ({ ...current, [member.userId]: e.target.value }))}
                                        placeholder={messages.group.removalReason}
                                        className="input text-xs"
                                    />
                                    <button onClick={() => void membersState.removeMember(member.userId, removalReasons[member.userId] || '')} className="chip w-full justify-center" data-tone="danger" type="button">{messages.group.excludeMember}</button>
                                </div>
                            ) : undefined}
                        />
                    ))}
                </div>
            </div>

            {membersState.members.length === 0 && !query.trim() ? (
                <div className="card p-4 space-y-4 animate-fadeInUp" style={{ animationDelay: '40ms' }}>
                    <div>
                        <h3 className="font-semibold text-fg">{messages.group.joinRequestTitle}</h3>
                        <p className="text-sm mt-1 text-muted-fg">{messages.group.joinRequestSubtitle}</p>
                    </div>
                    <input list="group-catalog-join" value={joinGroupKey} onChange={(e) => setJoinGroupKey(e.target.value.toUpperCase())} placeholder={messages.group.joinGroupPlaceholder} className="input" />
                    <textarea value={joinReason} onChange={(e) => setJoinReason(e.target.value)} rows={4} placeholder={messages.group.joinReasonPlaceholder} className="input resize-y" />
                    <button onClick={() => void membersState.createJoinRequestItem(joinGroupKey, joinReason)} className="btn btn-primary px-4 py-2 text-sm" type="button">{messages.group.sendRequest}</button>
                    <datalist id="group-catalog-join">{catalog.map((item) => <option key={item.groupKey} value={item.groupKey}>{item.title}</option>)}</datalist>
                </div>
            ) : null}
        </div>
    );
}
