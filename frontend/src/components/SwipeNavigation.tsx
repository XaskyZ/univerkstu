'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useSwipeable } from 'react-swipeable';
import { ReactNode, useState, useCallback, useEffect, useRef } from 'react';

// Порядок должен соответствовать BottomNav
const ROUTES = ['/exams', '/grades', '/umkd', '/schedule', '/profile', '/settings'];
const PAGE_SWIPE_DISABLED_MATCHERS = [
    '/schedule',
    '/admin',
];

interface SwipeNavigationProps {
    children: ReactNode;
}

export default function SwipeNavigation({ children }: SwipeNavigationProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [isAnimating, setIsAnimating] = useState(false);
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
    const canHandleSwipeRef = useRef(true);

    // Находим текущий индекс
    const currentIndex = ROUTES.findIndex(r => pathname === r || (r === '/schedule' && pathname === '/'));

    // Проверяем, нужно ли применять свайпы
    const isLoginPage = pathname === '/' || pathname === '/login';
    const isPageSwipeDisabled = PAGE_SWIPE_DISABLED_MATCHERS.some((route) =>
        pathname === route || pathname.startsWith(`${route}/`)
    );

    const startTransitionTo = useCallback((targetRoute: string, source: 'swipe' | 'external' = 'external') => {
        if (isAnimating || isLoginPage) return;
        if (source === 'swipe' && isPageSwipeDisabled) return;

        const targetIndex = ROUTES.findIndex((route) => route === targetRoute);
        if (targetIndex === -1 || targetIndex === currentIndex) return;

        const direction: 'left' | 'right' = targetIndex > currentIndex ? 'left' : 'right';

        setSlideDirection(direction);
        setIsAnimating(true);

        setTimeout(() => {
            router.push(targetRoute);
            // Reset animation state after navigation transition frame.
            setTimeout(() => {
                setIsAnimating(false);
                setSlideDirection(null);
            }, 180);
        }, 50);
    }, [isAnimating, isLoginPage, isPageSwipeDisabled, currentIndex, router]);

    const navigateTo = useCallback((direction: 'left' | 'right') => {
        const newIndex = direction === 'left'
            ? Math.min(currentIndex + 1, ROUTES.length - 1)
            : Math.max(currentIndex - 1, 0);
        void startTransitionTo(ROUTES[newIndex], 'swipe');
    }, [currentIndex, startTransitionTo]);

    useEffect(() => {
        const handleExternalNavigation = (event: Event) => {
            const customEvent = event as CustomEvent<{ to?: string }>;
            const targetRoute = customEvent.detail?.to;
            if (!targetRoute) return;
            void startTransitionTo(targetRoute, 'external');
        };

        window.addEventListener('app:navigate', handleExternalNavigation as EventListener);
        return () => {
            window.removeEventListener('app:navigate', handleExternalNavigation as EventListener);
        };
    }, [startTransitionTo]);

    const handlers = useSwipeable({
        onTouchStartOrOnMouseDown: ({ event }) => {
            const target = event.target as HTMLElement | null;
            if (!target) {
                canHandleSwipeRef.current = true;
                return;
            }

            const interactive = target.closest(
                'input, textarea, select, button, a, [contenteditable="true"], [data-no-page-swipe]'
            );
            if (interactive) {
                canHandleSwipeRef.current = false;
                return;
            }

            let node: HTMLElement | null = target;
            while (node) {
                const style = window.getComputedStyle(node);
                const overflowX = style.overflowX;
                const isHorizontalScrollable =
                    (overflowX === 'auto' || overflowX === 'scroll') &&
                    node.scrollWidth > node.clientWidth + 2;

                if (isHorizontalScrollable) {
                    canHandleSwipeRef.current = false;
                    return;
                }
                node = node.parentElement;
            }

            canHandleSwipeRef.current = true;
        },
        onSwipedLeft: (e) => {
            if (!canHandleSwipeRef.current) return;
            if (Math.abs(e.deltaX) > 50) {
                navigateTo('left');
            }
        },
        onSwipedRight: (e) => {
            if (!canHandleSwipeRef.current) return;
            if (Math.abs(e.deltaX) > 50) {
                navigateTo('right');
            }
        },
        onTouchEndOrOnMouseUp: () => {
            canHandleSwipeRef.current = true;
        },
        trackMouse: false,
        trackTouch: true,
        preventScrollOnSwipe: false,
        delta: 50,
    });

    // На странице логина не применяем свайп-обёртку
    if (isLoginPage) {
        return <>{children}</>;
    }

    return (
        <div
            {...handlers}
            className="swipe-navigation-container"
            style={{
                minHeight: '100vh',
                touchAction: 'pan-y pinch-zoom'
            }}
        >
            <div
                className={`swipe-content ${slideDirection ? `slide-${slideDirection}` : ''}`}
                style={{
                    animation: isAnimating ? `slideOut${slideDirection === 'left' ? 'Left' : 'Right'} 0.2s ease-out` : undefined
                }}
            >
                {children}
            </div>
        </div>
    );
}
