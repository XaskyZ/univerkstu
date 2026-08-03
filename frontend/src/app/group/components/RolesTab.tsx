'use client';

import { useState } from 'react';
import FriendActionButton from '@/components/FriendActionButton';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { useGroupRoles } from '../hooks/useGroupRoles';

type RolesHookState = ReturnType<typeof useGroupRoles>;

export default function RolesTab({ rolesState, canAssignStarosta }: { rolesState: RolesHookState; canAssignStarosta: boolean }) {
    const { messages, language } = useLanguage();
    const [userId, setUserId] = useState('');
    const [roleId, setRoleId] = useState<'starosta' | 'helper'>('helper');
    const [reason, setReason] = useState('');

    return (
        <div className="space-y-4">
            <div className="card p-4 space-y-4 animate-fadeInUp">
                <div>
                    <h3 className="font-semibold text-fg">{messages.group.rolesTitle}</h3>
                    <p className="text-sm mt-1 text-muted-fg">{messages.group.rolesSubtitle}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_180px_1fr_auto]">
                    <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={messages.group.userIdPlaceholder} className="input" />
                    <select value={roleId} onChange={(e) => setRoleId(e.target.value as 'starosta' | 'helper')} className="input">
                        {canAssignStarosta ? <option value="starosta">{messages.group.roleStarosta}</option> : null}
                        <option value="helper">{messages.group.roleHelper}</option>
                    </select>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={messages.group.reasonOptionalPlaceholder} className="input" />
                    <button onClick={() => void rolesState.assignRole(userId, roleId, reason)} className="btn btn-primary px-4 py-2 text-sm" type="button">{messages.group.assignRole}</button>
                </div>

                {rolesState.loading ? <p className="text-sm text-muted-fg">{messages.group.loadingShort}</p> : null}
                {rolesState.error ? <p className="text-sm text-danger-fg">{rolesState.error}</p> : null}
                {!rolesState.loading && !rolesState.error && rolesState.assignments.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.emptyRoles}</p> : null}
                <div className="space-y-3">
                    {rolesState.assignments.map((assignment) => (
                        <article
                            key={`${assignment.userId}-${assignment.roleId}-${assignment.scopeId}`}
                            className="rounded-3xl p-4 flex items-center justify-between gap-3 surface-overlay-1"
                            style={{ border: '1px solid var(--border)' }}
                        >
                            <div>
                                <h4 className="font-semibold text-fg">{assignment.userId}</h4>
                                <p className="text-xs mt-1 text-muted-fg">{assignment.roleId} • {assignment.scopeId} • {new Date(assignment.createdAt).toLocaleString(localeTag(language))}</p>
                                <div className="mt-3">
                                    <FriendActionButton targetUserId={assignment.userId} compact />
                                </div>
                            </div>
                            <button onClick={() => void rolesState.revokeRole(assignment.userId, assignment.roleId as 'starosta' | 'helper', reason)} className="chip" data-tone="danger" type="button">{messages.group.revokeRole}</button>
                        </article>
                    ))}
                </div>
            </div>
        </div>
    );
}
