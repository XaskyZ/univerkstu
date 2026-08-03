'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getGroupCatalog, getGroupSpaceMe, type GroupCatalogItem, type GroupSpaceMe } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import CoordinatorPage from './coordinator/CoordinatorPage';
import CuratorPage from './curator/CuratorPage';
import GroupSpacePage from './GroupSpacePage';
import StarostaPage from './starosta/StarostaPage';
import type { GroupPageMode, GroupWorkspaceContextValue } from './workspace-types';
import { PageMain, PageStateCard } from '@/components/PageShell';

interface GroupWorkspacePageProps {
    workspaceMode: GroupPageMode;
    /**
     * Optional explicit group key (provided by URL-routed wrappers such as
     * `/group/curator/group/[groupKey]`). When set, this overrides both the
     * `?groupKey=` query param and the catalog-based fallback for
     * coordinator/curator modes.
     */
    groupKey?: string;
}

export default function GroupWorkspacePage({ workspaceMode, groupKey: groupKeyProp }: GroupWorkspacePageProps) {
    const { isAuth, loading } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const requestedGroupKey = (groupKeyProp?.trim().toUpperCase() || searchParams.get('groupKey')?.trim().toUpperCase() || '');

    const [me, setMe] = useState<GroupSpaceMe | null>(null);
    const [catalog, setCatalog] = useState<GroupCatalogItem[]>([]);
    const [selectedGroupKey, setSelectedGroupKey] = useState('');
    const [fetching, setFetching] = useState(true);
    const [error, setError] = useState('');

    const refreshBase = useCallback(async () => {
        if (!isAuth) return;
        setFetching(true);
        setError('');
        const [spaceRes, catalogRes] = await Promise.all([getGroupSpaceMe(), getGroupCatalog()]);
        if (!spaceRes.success || !spaceRes.data) {
            setError(spaceRes.error || messages.group.loadSpaceError);
            setFetching(false);
            return;
        }

        const nextCatalog = catalogRes.success ? (catalogRes.data?.groups || []) : [];
        setMe(spaceRes.data);
        setCatalog(nextCatalog);

        const fallbackKey = workspaceMode === 'curator'
            ? (spaceRes.data.group?.groupKey || nextCatalog[0]?.groupKey || '')
            : (spaceRes.data.group?.groupKey || nextCatalog[0]?.groupKey || '');
        const requestedAllowed = requestedGroupKey && nextCatalog.some((item) => item.groupKey === requestedGroupKey);

        if (workspaceMode === 'coordinator' || workspaceMode === 'curator') {
            // When an explicit groupKey prop is provided (URL-routed wrapper),
            // always honor it so navigation between `/group/curator/group/[key]`
            // URLs swaps the workspace target rather than getting stuck on
            // the first value that landed in state.
            if (groupKeyProp && requestedAllowed) {
                setSelectedGroupKey(requestedGroupKey);
            } else {
                setSelectedGroupKey((current) => current || (requestedAllowed ? requestedGroupKey : fallbackKey));
            }
        } else {
            setSelectedGroupKey(spaceRes.data.group?.groupKey || '');
        }

        setFetching(false);
    }, [groupKeyProp, isAuth, messages.group.loadSpaceError, requestedGroupKey, workspaceMode]);

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshBase();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refreshBase]);

    const actualIsCoordinator = Boolean(me?.access.roles.includes('coordinator'));
    const actualIsCurator = Boolean(me?.access.roles.includes('curator'));
    const actualHasGroupManagementPanel = Boolean(me?.group?.groupKey && me?.access.roles.some((role) => role === 'starosta' || role === 'helper'));
    const currentGroupKey = useMemo(() => {
        if (!me) return '';
        if (workspaceMode === 'coordinator' || workspaceMode === 'curator') return selectedGroupKey || requestedGroupKey || me.group?.groupKey || catalog[0]?.groupKey || '';
        return me.group?.groupKey || '';
    }, [catalog, me, requestedGroupKey, selectedGroupKey, workspaceMode]);

    const currentGroupTitle = useMemo(() => {
        if (!currentGroupKey) return '';
        const fromCatalog = catalog.find((item) => item.groupKey === currentGroupKey);
        if (fromCatalog) return fromCatalog.title;
        if (me?.group?.groupKey === currentGroupKey) return me.group.title;
        return currentGroupKey;
    }, [catalog, currentGroupKey, me]);

    const isOwnGroup = Boolean(currentGroupKey && currentGroupKey === me?.group?.groupKey);
    const isCoordinator = Boolean(actualIsCoordinator);
    const isCurator = Boolean(actualIsCurator);
    const canReadCurrentGroup = Boolean(currentGroupKey && (isCoordinator || isCurator || me?.available));
    const canManageContent = Boolean(currentGroupKey && (isCoordinator || isCurator || (isOwnGroup && me?.access.permissions.canManageContent)));
    const canManageMembers = Boolean(currentGroupKey && (isCoordinator || isCurator || (isOwnGroup && me?.access.permissions.canManageMembers)));
    const canManageRoles = Boolean(currentGroupKey && (isCoordinator || isCurator || (isOwnGroup && (me?.access.permissions.canManageHelpers || me?.access.permissions.canAssignStarosta))));
    const canAssignStarosta = Boolean(currentGroupKey && (isCoordinator || isCurator || (isOwnGroup && me?.access.permissions.canAssignStarosta)));
    const hasGroupManagementPanel = Boolean(isOwnGroup && me?.access.roles.some((role) => role === 'starosta' || role === 'helper'));

    const deniedText = workspaceMode === 'coordinator'
        ? (language === 'en' ? 'Coordinator workspace is available only for coordinators.' : language === 'kz' ? 'Координатор кеңістігі тек координаторларға қолжетімді.' : 'Пространство координатора доступно только координаторам.')
        : workspaceMode === 'curator'
            ? (language === 'en' ? 'Curator workspace is available only for curators.' : language === 'kz' ? 'Куратор кеңістігі тек кураторларға қолжетімді.' : 'Пространство куратора доступно только кураторам.')
        : (language === 'en' ? 'Starosta workspace is available only for starostas and helpers of their own group.' : language === 'kz' ? 'Староста кеңістігі тек өз тобының старосталары мен көмекшілеріне қолжетімді.' : 'Пространство старосты доступно только старостам и помощникам своей группы.');

    if (loading || fetching) {
        return <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--muted)' }}>Loading…</div>;
    }

    if (!isAuth || !me) return null;

    if (workspaceMode === 'coordinator' && !actualIsCoordinator) {
        return <PageMain spacing="lg"><PageStateCard message={deniedText} /></PageMain>;
    }

    if (workspaceMode === 'curator' && !actualIsCurator) {
        return <PageMain spacing="lg"><PageStateCard message={deniedText} /></PageMain>;
    }

    // Curator-mode no-group guard: when the curator has no groups attached
    // we must not fall through to <CuratorPage /> with an empty groupKey,
    // because downstream code (StudentCard, etc.) deref `currentGroupKey`
    // without null-checking and would crash.
    if (workspaceMode === 'curator' && catalog.length === 0 && !me?.group?.groupKey) {
        return <PageMain spacing="lg"><PageStateCard message={messages.curator.noGroupDesc} /></PageMain>;
    }

    if (workspaceMode === 'starosta' && !actualHasGroupManagementPanel) {
        return <PageMain spacing="lg"><PageStateCard message={deniedText} /></PageMain>;
    }

    if (error) {
        return <PageMain spacing="lg"><PageStateCard message={error} tone="danger" /></PageMain>;
    }

    const workspace: GroupWorkspaceContextValue = {
        mode: workspaceMode,
        me,
        catalog,
        selectedGroupKey,
        setSelectedGroupKey,
        currentGroupKey,
        currentGroupTitle,
        isCoordinator,
        isCurator,
        isOwnGroup,
        canReadCurrentGroup,
        canManageContent,
        canManageMembers,
        canManageRoles,
        canAssignStarosta,
        hasGroupManagementPanel,
        refreshBase,
    };

    if (workspaceMode === 'coordinator') {
        return <CoordinatorPage workspace={workspace} />;
    }

    if (workspaceMode === 'curator') {
        return <CuratorPage workspace={workspace} />;
    }

    if (workspaceMode === 'starosta') {
        return <StarostaPage workspace={workspace} />;
    }

    return <GroupSpacePage workspace={workspace} />;
}
