'use client';

import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with canvas and window
const ThemeBackground = dynamic(() => import('./ThemeBackground'), {
    ssr: false,
});

export default function ThemeBackgroundWrapper() {
    return <ThemeBackground />;
}
