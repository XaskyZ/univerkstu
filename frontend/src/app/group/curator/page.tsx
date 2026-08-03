'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getGroupCatalog, getGroupSpaceMe, type GroupCatalogItem, type GroupSpaceMe } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';

/**
 * Curator index/router under the canonical `/group/curator` namespace.
 *
 * Behaviour:
 * - `catalog.length === 0` → show empty state asking the user to contact
 *   admin to attach a group.
 * - `catalog.length === 1` → `router.replace('/group/curator/group/<onlyKey>')`.
 *   We use `replace` (not `push`) so back-navigation doesn't trap the user
 *   in a redirect loop between `/group/curator` and the per-group page.
 * - `catalog.length > 1` → render a minimal index of cards, each linking
 *   to `/group/curator/group/<key>`.
 *
 * The role check is enforced by reading `me.access.roles` from the same
 * `/group-space/me` payload that drives the workspace.
 */
export default function CuratorIndexPage() {
    const { isAuth, loading } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();

    const [me, setMe] = useState<GroupSpaceMe | null>(null);
    const [catalog, setCatalog] = useState<GroupCatalogItem[]>([]);
    const [fetching, setFetching] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        let cancelled = false;
        async function load() {
            setFetching(true);
            setError('');
            const [spaceRes, catalogRes] = await Promise.all([getGroupSpaceMe(), getGroupCatalog()]);
            if (cancelled) return;
            if (!spaceRes.success || !spaceRes.data) {
                setError(spaceRes.error || messages.group.loadSpaceError);
                setFetching(false);
                return;
            }
            setMe(spaceRes.data);
            setCatalog(catalogRes.success ? (catalogRes.data?.groups || []) : []);
            setFetching(false);
        }
        void load();
        return () => { cancelled = true; };
    }, [isAuth, messages.group.loadSpaceError]);

    const isCurator = Boolean(me?.access.roles.includes('curator'));

    // Auto-redirect when the curator has exactly one group. `useEffect`
    // guarantees we don't call router during render.
    useEffect(() => {
        if (fetching || !me || !isCurator) return;
        if (catalog.length === 1) {
            router.replace(`/group/curator/group/${encodeURIComponent(catalog[0].groupKey)}`);
        }
    }, [catalog, fetching, isCurator, me, router]);

    const deniedText = useMemo(() => (
        language === 'en'
            ? 'Curator workspace is available only for curators.'
            : language === 'kz'
                ? 'Куратор кеңістігі тек кураторларға қолжетімді.'
                : 'Пространство куратора доступно только кураторам.'
    ), [language]);

    if (loading || fetching) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--muted)' }}>
                Loading…
            </div>
        );
    }

    if (!isAuth || !me) return null;

    if (!isCurator) {
        return (
            <PageShell>
                <PageMain spacing="lg">
                    <PageStateCard message={deniedText} />
                </PageMain>
            </PageShell>
        );
    }

    if (error) {
        return (
            <PageShell>
                <PageMain spacing="lg">
                    <PageStateCard message={error} tone="danger" />
                </PageMain>
            </PageShell>
        );
    }

    if (catalog.length === 0) {
        return (
            <PageShell>
                <PageMain spacing="lg">
                    <section className="card p-6 space-y-2">
                        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
                            {messages.curator.noGroupTitle}
                        </h1>
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>
                            {messages.curator.noGroupDesc}
                        </p>
                    </section>
                </PageMain>
            </PageShell>
        );
    }

    if (catalog.length === 1) {
        // Single-group case: we've already kicked off the replace navigation
        // above. Show a minimal placeholder rather than briefly flashing the
        // multi-group index. Auth + role have already passed at this point.
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--muted)' }}>
                Loading…
            </div>
        );
    }

    return (
        <PageShell>
            <PageMain spacing="lg">
                <section className="card p-5 space-y-4">
                    <header className="space-y-1">
                        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
                            {messages.curator.multiGroupTitle}
                        </h1>
                    </header>
                    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {catalog.map((group) => (
                            <li key={group.groupKey}>
                                <article
                                    className="card p-4 h-full flex flex-col gap-3"
                                    style={{ background: 'var(--surface-overlay-1)' }}
                                >
                                    <div className="space-y-1 min-w-0">
                                        <div
                                            className="text-[11px] uppercase tracking-[0.18em]"
                                            style={{ color: 'var(--muted)' }}
                                        >
                                            {group.groupKey}
                                        </div>
                                        <div
                                            className="font-semibold truncate"
                                            style={{ color: 'var(--text)' }}
                                        >
                                            {group.title || group.groupKey}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-primary mt-auto self-start text-sm px-4 py-2"
                                        onClick={() => router.push(`/group/curator/group/${encodeURIComponent(group.groupKey)}`)}
                                    >
                                        {messages.curator.openGroupBtn}
                                    </button>
                                </article>
                            </li>
                        ))}
                    </ul>
                </section>
            </PageMain>
        </PageShell>
    );
}
