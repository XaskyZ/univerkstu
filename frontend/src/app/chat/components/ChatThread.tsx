'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const SCROLL_DOWN_THRESHOLD_PX = 120;

interface ChatThreadProps<M> {
    messages: M[];
    getKey: (m: M) => string;
    getAuthor: (m: M) => string;
    getTimestamp: (m: M) => string;
    renderBubble: (m: M, ctx: { isContinuation: boolean }) => ReactNode;
    threadEndRef: RefObject<HTMLDivElement | null>;
    locale: string;
    emptyState?: ReactNode;
    loadingState?: ReactNode;
    isLoading?: boolean;
    threadStyle?: React.CSSProperties;
}

export function ChatThread<M>({
    messages,
    getKey,
    getAuthor,
    getTimestamp,
    renderBubble,
    threadEndRef,
    locale,
    emptyState,
    loadingState,
    isLoading,
    threadStyle,
}: ChatThreadProps<M>) {
    const { messages: i18n } = useLanguage();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [scrolledUp, setScrolledUp] = useState(false);
    const [unseenCount, setUnseenCount] = useState(0);
    const lastSeenLengthRef = useRef(messages.length);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onScroll = () => {
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            const isUp = distanceFromBottom > SCROLL_DOWN_THRESHOLD_PX;
            setScrolledUp(isUp);
            if (!isUp) setUnseenCount(0);
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const lastSeen = lastSeenLengthRef.current;
        const delta = messages.length - lastSeen;
        if (delta > 0 && scrolledUp) {
            setUnseenCount((current) => current + delta);
        }
        lastSeenLengthRef.current = messages.length;
    }, [messages.length, scrolledUp]);

    const handleScrollDown = () => {
        threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        setUnseenCount(0);
    };

    const showEmpty = !isLoading && messages.length === 0 && emptyState;
    const showLoading = isLoading && messages.length === 0;

    return (
        <>
            <div className="chat-thread" ref={containerRef} style={threadStyle}>
                {showLoading ? (
                    loadingState ?? (
                        <div className="chat-skeleton-thread" aria-hidden>
                            <div className="chat-skeleton-bubble" />
                            <div className="chat-skeleton-bubble chat-skeleton-bubble--short" />
                            <div className="chat-skeleton-bubble chat-skeleton-bubble--own" />
                            <div className="chat-skeleton-bubble" />
                            <div className="chat-skeleton-bubble chat-skeleton-bubble--own chat-skeleton-bubble--short" />
                        </div>
                    )
                ) : null}
                {showEmpty ? emptyState : null}
                {messages.map((message, index, list) => {
                    const prev = index > 0 ? list[index - 1] : null;
                    const messageDate = new Date(getTimestamp(message));
                    const prevDate = prev ? new Date(getTimestamp(prev)) : null;
                    const sameDay = !!prevDate && prevDate.toDateString() === messageDate.toDateString();
                    const showDaySeparator = !prev || !sameDay;
                    const sameAuthorWindow = !!prev
                        && getAuthor(prev) === getAuthor(message)
                        && sameDay
                        && (messageDate.getTime() - prevDate!.getTime()) < GROUP_WINDOW_MS
                        && !showDaySeparator;

                    return (
                        <div key={getKey(message)}>
                            {showDaySeparator ? (
                                <div className="message-day-separator">
                                    <span>{new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long' }).format(messageDate)}</span>
                                </div>
                            ) : null}
                            {renderBubble(message, { isContinuation: sameAuthorWindow })}
                        </div>
                    );
                })}
                <div ref={threadEndRef} />
            </div>
            {scrolledUp ? (
                <button
                    type="button"
                    className="chat-scroll-down"
                    onClick={handleScrollDown}
                    aria-label={i18n.common.scrollDown}
                >
                    <ChevronDown className="w-4 h-4" strokeWidth={2.4} aria-hidden />
                    {unseenCount > 0 ? <span className="chat-scroll-down-badge">{unseenCount}</span> : null}
                </button>
            ) : null}
        </>
    );
}
