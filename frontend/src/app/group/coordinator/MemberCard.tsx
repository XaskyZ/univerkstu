'use client';

import FriendActionButton from '@/components/FriendActionButton';
import type { GroupMemberView, GroupSpaceSummary } from '@/lib/api';
import type { CoordinatorUi, ManagedRole } from './types';

type PhoneCacheEntry = {
    phone: string | null;
    source: 'profile_cache' | 'admin_snapshot' | null;
    missingReason: 'profile_not_cached' | 'phone_not_provided' | null;
};

interface MemberCardProps {
    group: GroupSpaceSummary;
    member: GroupMemberView;
    ui: CoordinatorUi;
    /** BCP-47 locale tag for date formatting (from the parent's UI language). */
    locale: string;
    phoneCache: PhoneCacheEntry | undefined;
    phoneLoadingUserId: string;
    roleActionKey: string;
    onRoleToggle: (groupKey: string, userId: string, roleId: ManagedRole, enabled: boolean) => void;
    onPhoneReveal: (userId: string) => void;
}

export function MemberCard({
    group,
    member,
    ui,
    locale,
    phoneCache,
    phoneLoadingUserId,
    roleActionKey,
    onRoleToggle,
    onPhoneReveal,
}: MemberCardProps) {
    const hasStarosta = member.roles.includes('starosta');
    const hasHelper = member.roles.includes('helper');
    const phoneLabel = phoneCache?.phone
        || (phoneCache?.missingReason === 'profile_not_cached'
            ? ui.phoneNotSynced
            : phoneCache?.missingReason === 'phone_not_provided'
                ? ui.phoneNotProvided
                : ui.phoneMissing);

    return (
        <article className="workspace-card p-4 transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold tracking-[-0.02em] text-fg">{member.fullName || member.userId}</div>
                        {hasStarosta ? <span className="chip" data-tone="primary" data-size="sm">{ui.starosta}</span> : null}
                        {hasHelper ? <span className="chip" data-tone="success" data-size="sm">{ui.helper}</span> : null}
                    </div>
                    <div className="text-xs font-mono text-muted-fg">{member.userId}</div>
                    <FriendActionButton targetUserId={member.userId} compact />
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="chip" data-tone="muted" data-size="sm">
                            {member.source === 'manual' ? ui.manualMember : ui.autoMember}
                        </span>
                        <span className="chip" data-tone="muted" data-size="sm">
                            {ui.memberSince}: {new Date(member.joinedAt).toLocaleDateString(locale)}
                        </span>
                    </div>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-2 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <button
                            onClick={() => onRoleToggle(group.groupKey, member.userId, 'starosta', !hasStarosta)}
                            disabled={roleActionKey === `${group.groupKey}:${member.userId}:starosta:${!hasStarosta ? 'assign' : 'revoke'}`}
                            className="px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-60"
                            style={{ background: hasStarosta ? 'rgba(var(--status-danger-rgb), 0.14)' : 'rgba(var(--primary-rgb), 0.16)', color: hasStarosta ? 'var(--danger)' : 'var(--primary)' }}
                        >
                            {hasStarosta ? ui.revokeStarosta : ui.assignStarosta}
                        </button>
                        <button
                            onClick={() => onRoleToggle(group.groupKey, member.userId, 'helper', !hasHelper)}
                            disabled={roleActionKey === `${group.groupKey}:${member.userId}:helper:${!hasHelper ? 'assign' : 'revoke'}`}
                            className="px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-60"
                            style={{ background: hasHelper ? 'rgba(var(--status-danger-rgb), 0.14)' : 'rgba(var(--good-rgb), 0.14)', color: hasHelper ? 'var(--danger)' : 'var(--good)' }}
                        >
                            {hasHelper ? ui.revokeHelper : ui.assignHelper}
                        </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        {phoneCache === undefined ? (
                            <button
                                onClick={() => onPhoneReveal(member.userId)}
                                className="px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                                style={{ background: 'var(--surface-overlay-3)', color: 'var(--text)', border: '1px solid var(--surface-overlay-3)' }}
                            >
                                {phoneLoadingUserId === member.userId ? ui.phoneLoading : ui.showPhone}
                            </button>
                        ) : (
                            <div className="chip" data-size="lg" style={{ background: 'var(--status-info-bg)', color: 'var(--status-info-color)', borderColor: 'var(--status-info-border)' }}>
                                {ui.phone}: {phoneLabel}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}

interface ResponsibleMemberCardProps {
    member: GroupMemberView;
    ui: CoordinatorUi;
}

export function ResponsibleMemberCard({ member, ui }: ResponsibleMemberCardProps) {
    return (
        <article
            className="rounded-[22px] px-4 py-3"
            style={{
                background: 'linear-gradient(135deg, rgba(var(--primary-rgb), 0.08), var(--surface-overlay-1))',
                border: '1px solid var(--surface-border-2)',
            }}
        >
            <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium text-fg">{member.fullName || member.userId}</div>
                {member.roles.includes('starosta') ? (
                    <span className="chip" data-tone="primary" data-size="sm">
                        {ui.starosta}
                    </span>
                ) : null}
                {member.roles.includes('helper') ? (
                    <span className="chip" data-tone="success" data-size="sm">
                        {ui.helper}
                    </span>
                ) : null}
            </div>
            <div className="text-xs font-mono mt-2 text-muted-fg">{member.userId}</div>
            <div className="mt-3">
                <FriendActionButton targetUserId={member.userId} compact />
            </div>
        </article>
    );
}
