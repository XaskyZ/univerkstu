'use client';

import React, { useState, ReactNode } from 'react';
import { useSwipeable } from 'react-swipeable';

interface SwipeableViewsProps {
    children: ReactNode[];
    index: number;
    onChangeIndex: (index: number) => void;
    className?: string;
    enableMouseEvents?: boolean;
    threshold?: number;
}

export default function SwipeableViews({
    children,
    index,
    onChangeIndex,
    className = '',
    enableMouseEvents = true,
    threshold = 50,
}: SwipeableViewsProps) {
    const [offsetX, setOffsetX] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);

    const totalSlides = React.Children.count(children);

    const handlers = useSwipeable({
        onSwiping: (eventData) => {
            if (Math.abs(eventData.deltaX) > Math.abs(eventData.deltaY)) {
                setIsSwiping(true);
                setOffsetX(eventData.deltaX);
            }
        },
        onSwipedLeft: (eventData) => {
            setIsSwiping(false);
            if (eventData.deltaX < -threshold && index < totalSlides - 1) {
                onChangeIndex(index + 1);
            }
            setOffsetX(0);
        },
        onSwipedRight: (eventData) => {
            setIsSwiping(false);
            if (eventData.deltaX > threshold && index > 0) {
                onChangeIndex(index - 1);
            }
            setOffsetX(0);
        },
        onTouchEndOrOnMouseUp: () => {
            setIsSwiping(false);
            setOffsetX(0);
        },
        trackMouse: enableMouseEvents,
        trackTouch: true,
        preventScrollOnSwipe: true,
    });

    return (
        <div
            {...handlers}
            className={`swipeable-views-container overflow-hidden ${className}`}
        >
            <div
                className="swipeable-views-slider flex"
                style={{
                    transform: `translateX(calc(-${index * 100}% + ${isSwiping ? offsetX : 0}px))`,
                    transition: isSwiping ? 'none' : 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                {React.Children.map(children, (child, i) => (
                    <div
                        key={i}
                        className="swipeable-view flex-shrink-0 w-full"
                        style={{ minWidth: '100%' }}
                    >
                        {child}
                    </div>
                ))}
            </div>
        </div>
    );
}

// Dots indicator component
export function SwipeableDots({
    count,
    activeIndex,
    onDotClick
}: {
    count: number;
    activeIndex: number;
    onDotClick?: (index: number) => void;
}) {
    return (
        <div className="swipe-indicator">
            {Array.from({ length: count }, (_, i) => (
                <button
                    key={i}
                    className={`swipe-dot ${i === activeIndex ? 'active' : ''}`}
                    onClick={() => onDotClick?.(i)}
                    aria-label={`Go to slide ${i + 1}`}
                />
            ))}
        </div>
    );
}
