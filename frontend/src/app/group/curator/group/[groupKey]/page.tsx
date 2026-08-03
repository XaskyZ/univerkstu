'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import GroupWorkspacePage from '@/app/group/GroupWorkspacePage';

/**
 * URL-routed entry point into the curator workspace for a specific group.
 *
 * Canonical location: `/group/curator/group/[groupKey]`. The legacy
 * `/curator/group/[groupKey]` URL 308-redirects here (see next.config.ts).
 *
 * The role check itself is delegated to `GroupWorkspacePage`, which already
 * gates curator mode against the `me.access.roles` from the backend.
 */
export default function CuratorGroupPage() {
    const params = useParams<{ groupKey: string }>();
    const groupKey = useMemo(() => {
        const raw = params?.groupKey;
        if (!raw) return '';
        const value = Array.isArray(raw) ? raw[0] : raw;
        // Path segment is URL-encoded by Next when it contains non-ASCII
        // (Cyrillic group keys are common in this app). Decode before
        // handing it to the workspace, which compares against catalog
        // entries case- and encoding-insensitively but expects raw chars.
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }, [params]);

    return <GroupWorkspacePage workspaceMode="curator" groupKey={groupKey} />;
}
