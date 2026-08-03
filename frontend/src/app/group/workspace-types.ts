'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { GroupCatalogItem, GroupSpaceMe } from '@/lib/api';

export type GroupPageMode = 'group' | 'coordinator' | 'curator' | 'starosta';

export interface GroupWorkspaceContextValue {
    mode: GroupPageMode;
    me: GroupSpaceMe;
    catalog: GroupCatalogItem[];
    selectedGroupKey: string;
    setSelectedGroupKey: Dispatch<SetStateAction<string>>;
    currentGroupKey: string;
    currentGroupTitle: string;
    isCoordinator: boolean;
    isCurator: boolean;
    isOwnGroup: boolean;
    canReadCurrentGroup: boolean;
    canManageContent: boolean;
    canManageMembers: boolean;
    canManageRoles: boolean;
    canAssignStarosta: boolean;
    hasGroupManagementPanel: boolean;
    refreshBase: () => Promise<void>;
}
