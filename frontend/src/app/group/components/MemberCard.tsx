'use client';

import type { GroupMemberView } from '@/lib/api';
import FriendActionButton from '@/components/FriendActionButton';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';

function sourceLabel(source: GroupMemberView['source']) {
    if (source === 'platonus_auto') return 'platonus_auto';
    if (source === 'join_request') return 'join_request';
    return 'manual';
}

export default function MemberCard({
    member,
    actions,
    isOnline = false,
}: {
    member: GroupMemberView;
    actions?: React.ReactNode;
    /**
     * When true, renders a small status dot next to the member's name. Wired
     * by parents that own an SSE presence connection (e.g. `MembersTab` under
     * the `socialFeedBeta` flag). Stays `false` by default so the legacy path
     * shows no presence indicator.
     */
    isOnline?: boolean;
}) {
    const { language, messages } = useLanguage();
    return (
        <article className="rounded-3xl p-4 flex items-start justify-between gap-3 surface-overlay-1" style={{ border: '1px solid var(--border)' }}>
            <div className="space-y-2">
                <div>
                    <h4 className="font-semibold text-fg flex items-center gap-2">
                        <span>{member.fullName || member.userId}</span>
                        {isOnline ? (
                            <span
                                // Online dot — matches the style used by `DialogsPanel` so the
                                // visual language is consistent across chat + group tabs. Uses
                                // semantic status tokens so every theme adapts.
                                aria-label={messages.common.online}
                                title={messages.common.online}
                                style={{
                                    display: 'inline-block',
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: 'var(--status-success-color, #2ecc71)',
                                    border: '2px solid var(--surface-base, #fff)',
                                    boxSizing: 'border-box',
                                    flex: '0 0 auto',
                                }}
                            />
                        ) : null}
                    </h4>
                    {member.fullName ? <p className="text-xs font-mono text-muted-fg">{member.userId}</p> : null}
                    <p className="text-xs text-muted-fg">{new Date(member.joinedAt).toLocaleString(localeTag(language))}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="chip" data-tone="muted">
                        {sourceLabel(member.source)}
                    </span>
                    {member.roles.map((role) => (
                        <span key={role} className="chip" data-tone="primary">
                            {role}
                        </span>
                    ))}
                </div>
                <FriendActionButton targetUserId={member.userId} compact />
            </div>
            {actions}
        </article>
    );
}
