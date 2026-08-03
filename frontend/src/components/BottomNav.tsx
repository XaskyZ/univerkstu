'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BookOpen, CalendarDays, GraduationCap, Menu, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { getCachedAcademicContext } from '@/lib/platonus-semesters';
import { isExamSessionContext } from '@/lib/session-mode';
import { useSocialUnread } from '@/lib/hooks/use-social-unread';
import { formatUnreadBadge } from '@/app/notifications/strings';

const ACADEMIC_CACHE_STORAGE_KEY = 'cache_academic_context';

// useSyncExternalStore subscribers — defined at module scope so they have
// stable identity across renders.
function subscribeAcademicCache(callback: () => void) {
    if (typeof window === 'undefined') return () => {};
    const handler = (event: StorageEvent) => {
        if (event.key === null || event.key === ACADEMIC_CACHE_STORAGE_KEY) callback();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
}

function readInSessionSnapshot(): boolean {
    return isExamSessionContext(getCachedAcademicContext());
}

function readInSessionServerSnapshot(): boolean {
    return false;
}

interface NavItem {
    href: string;
    label: string;
    icon: React.ReactNode;
}

const baseNavItems: NavItem[] = [
    {
        href: '/grades',
        label: 'Grades',
        icon: <GraduationCap className="w-6 h-6" strokeWidth={1.8} />,
    },
    {
        href: '/umkd',
        label: 'UMKD',
        icon: <BookOpen className="w-6 h-6" strokeWidth={1.8} />,
    },
    {
        href: '/schedule',
        label: 'Schedule',
        icon: <CalendarDays className="w-6 h-6" strokeWidth={1.8} />,
    },
    {
        href: '/profile',
        label: 'Profile',
        icon: <User className="w-6 h-6" strokeWidth={1.8} />,
    },
    {
        href: '/settings',
        label: 'More',
        icon: <Menu className="w-6 h-6" strokeWidth={1.8} />,
    },
];

const ROUTE_ORDER = ['/grades', '/umkd', '/schedule', '/profile', '/settings'];

export default function BottomNav() {
    const pathname = usePathname();
    const router = useRouter();
    const { messages } = useLanguage();
    const { isAuth } = useAuth();
    // Poll the Notification Center unread count while we're in the
    // authenticated shell. The hook self-pauses on tab-hidden so this is
    // cheap. The result drives a small badge on the "More" icon — that menu
    // is currently the entry point to `/notifications`.
    const unread = useSocialUnread(isAuth === true);
    const unreadLabel = formatUnreadBadge(unread);
    // Hydration-safe session-mode gate: the server snapshot is `false` so SSR
    // and the first client render both produce "Расписание". After hydration
    // the client snapshot reads the cached academic context and may flip the
    // label to "Сессия"; subsequent navigations re-render naturally and the
    // snapshot is re-evaluated. Cross-tab cache writes fire `storage` events
    // and update us via the subscribe callback.
    const inSession = useSyncExternalStore(
        subscribeAcademicCache,
        readInSessionSnapshot,
        readInSessionServerSnapshot,
    );

    const scheduleLabel = inSession ? messages.bottomNav.session : messages.bottomNav.schedule;

    const navItems = useMemo<NavItem[]>(() => [
        { ...baseNavItems[0], label: messages.bottomNav.grades },
        { ...baseNavItems[1], label: messages.bottomNav.umkd },
        { ...baseNavItems[2], label: scheduleLabel },
        { ...baseNavItems[3], label: messages.bottomNav.profile },
        { ...baseNavItems[4], label: messages.bottomNav.more },
    ], [messages.bottomNav.grades, messages.bottomNav.more, messages.bottomNav.profile, messages.bottomNav.umkd, scheduleLabel]);

    useEffect(() => {
        const nav = navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
            deviceMemory?: number;
            hardwareConcurrency?: number;
        };
        const saveData = nav.connection?.saveData === true;
        const slowNetwork = nav.connection?.effectiveType === '2g' || nav.connection?.effectiveType === 'slow-2g';
        const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
        const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
        const constrained = saveData || slowNetwork || lowMemory || lowCpu;

        const currentIndex = ROUTE_ORDER.findIndex((route) =>
            pathname === route || (route === '/schedule' && pathname === '/')
        );

        if (currentIndex !== -1) {
            const prev = ROUTE_ORDER[currentIndex - 1];
            const next = ROUTE_ORDER[currentIndex + 1];
            if (prev) router.prefetch(prev);
            if (next) router.prefetch(next);
        }

        if (constrained) return;

        const warmup = () => {
            const secondaryRoutes = navItems
                .map((item) => item.href)
                .filter((href) => href !== pathname)
                .filter((href) => href !== ROUTE_ORDER[currentIndex - 1] && href !== ROUTE_ORDER[currentIndex + 1]);

            for (const href of secondaryRoutes) {
                router.prefetch(href);
            }
        };

        const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
        if (idle) {
            const id = idle(warmup);
            return () => {
                (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
            };
        }

        const timeout = globalThis.setTimeout(warmup, 250);
        return () => globalThis.clearTimeout(timeout);
    }, [navItems, pathname, router]);

    // Скрываем навбар на страницах входа и в админке
    if (pathname === '/' || pathname === '/login' || pathname?.startsWith('/admin')) {
        return null;
    }

    return (
        <nav className="bottom-nav">
            {navItems.map((item) => {
                const isActive = pathname === item.href ||
                    (item.href === '/schedule' && pathname === '/');
                // Only the "More" entry surfaces the notifications badge today
                // — that's the menu that links into `/notifications`.
                const showBadge = item.href === '/settings' && unreadLabel.length > 0;

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`bottom-nav-item ${isActive ? 'active' : ''}`}
                        aria-label={item.label}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={(event) => {
                            if (isActive) return;
                            event.preventDefault();
                            window.dispatchEvent(new CustomEvent('app:navigate', { detail: { to: item.href } }));
                        }}
                    >
                        <span className="bottom-nav-icon" aria-hidden style={{ position: 'relative' }}>
                            {item.icon}
                            {showBadge ? (
                                <span
                                    aria-label={`${unread} unread notifications`}
                                    role="status"
                                    style={{
                                        position: 'absolute',
                                        top: -4,
                                        right: -8,
                                        minWidth: 18,
                                        height: 18,
                                        padding: '0 5px',
                                        borderRadius: '999px',
                                        background: 'var(--primary)',
                                        color: '#fff',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        lineHeight: '18px',
                                        textAlign: 'center',
                                        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                                    }}
                                >
                                    {unreadLabel}
                                </span>
                            ) : null}
                        </span>
                        <span className="bottom-nav-label">{item.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
