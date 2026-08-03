'use client';

import { useState } from 'react';
import FriendActionButton from '@/components/FriendActionButton';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { useGroupMembers } from '../hooks/useGroupMembers';

type MembersHookState = ReturnType<typeof useGroupMembers>;

export default function RequestsTab({ membersState }: { membersState: MembersHookState }) {
    const { messages, language } = useLanguage();
    const [notes, setNotes] = useState<Record<string, string>>({});

    return (
        <div className="card p-4 space-y-4 animate-fadeInUp">
            <div>
                <h3 className="font-semibold text-fg">{messages.group.requestsTitle}</h3>
                <p className="text-sm mt-1 text-muted-fg">{messages.group.requestsSubtitle}</p>
            </div>

            {membersState.joinRequests.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.emptyRequests}</p> : null}
            <div className="space-y-3">
                {membersState.joinRequests.map((request) => (
                    <article key={request.id} className="rounded-3xl p-4 space-y-3 surface-overlay-1" style={{ border: '1px solid var(--border)' }}>
                        <div>
                            <h4 className="font-semibold text-fg">{request.userId}</h4>
                            <p className="text-xs mt-1 text-muted-fg">{request.groupKey} • {new Date(request.createdAt).toLocaleString(localeTag(language))}</p>
                            <div className="mt-3">
                                <FriendActionButton targetUserId={request.userId} compact />
                            </div>
                        </div>
                        {request.reason ? <p className="text-sm whitespace-pre-wrap text-fg">{request.reason}</p> : null}
                        <textarea value={notes[request.id] || ''} onChange={(e) => setNotes((current) => ({ ...current, [request.id]: e.target.value }))} rows={3} placeholder={messages.group.reasonOptionalPlaceholder} className="input resize-y" />
                        <div className="flex items-center gap-2">
                            <button onClick={() => void membersState.reviewJoinRequest(request.id, 'approved', notes[request.id])} className="chip" data-tone="success" data-size="lg" type="button">{messages.group.approve}</button>
                            <button onClick={() => void membersState.reviewJoinRequest(request.id, 'rejected', notes[request.id])} className="chip" data-tone="danger" data-size="lg" type="button">{messages.group.reject}</button>
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );
}
