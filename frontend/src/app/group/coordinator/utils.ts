import type {
    GroupMemberView,
    GroupSpaceSummary,
} from '@/lib/api';
import type { GroupWorkspaceContextValue } from '../workspace-types';

export { getAnnouncementAccent } from '../utils/announcement-accent';

export function sortGroups(groups: GroupSpaceSummary[]) {
    return [...groups].sort((left, right) => {
        if (right.memberCount !== left.memberCount) return right.memberCount - left.memberCount;
        return left.title.localeCompare(right.title, 'ru');
    });
}

export function mergeCoordinatorGroups(
    catalog: GroupWorkspaceContextValue['catalog'],
    adminGroups: GroupSpaceSummary[]
): GroupSpaceSummary[] {
    const byGroupKey = new Map<string, GroupSpaceSummary>();

    for (const item of catalog) {
        byGroupKey.set(item.groupKey, {
            groupKey: item.groupKey,
            title: item.title,
            slug: item.slug,
            memberCount: 0,
            starostas: [],
            helpers: [],
        });
    }

    for (const item of adminGroups) {
        const existing = byGroupKey.get(item.groupKey);
        byGroupKey.set(item.groupKey, {
            groupKey: item.groupKey,
            title: item.title || existing?.title || item.groupKey,
            slug: item.slug || existing?.slug || item.groupKey.toLowerCase(),
            memberCount: item.memberCount ?? existing?.memberCount ?? 0,
            starostas: item.starostas ?? existing?.starostas ?? [],
            helpers: item.helpers ?? existing?.helpers ?? [],
        });
    }

    return sortGroups(Array.from(byGroupKey.values()));
}

export function sortMembers(members: GroupMemberView[]) {
    const rank = (member: GroupMemberView) => {
        if (member.roles.includes('starosta')) return 0;
        if (member.roles.includes('helper')) return 1;
        return 2;
    };

    return [...members].sort((left, right) => {
        const rankDiff = rank(left) - rank(right);
        if (rankDiff !== 0) return rankDiff;
        const leftName = (left.fullName || left.userId).toLowerCase();
        const rightName = (right.fullName || right.userId).toLowerCase();
        return leftName.localeCompare(rightName, 'ru');
    });
}

export function filterMembers(members: GroupMemberView[], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return members;
    return members.filter((member) => `${member.fullName || ''} ${member.userId}`.toLowerCase().includes(normalized));
}

export function matchesGroupSearch(group: GroupSpaceSummary, query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return `${group.title} ${group.groupKey} ${group.slug}`.toLowerCase().includes(normalized);
}

