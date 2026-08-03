'use client';

import { RouteError } from '@/components/RouteError';

export default function ChatError(props: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteError {...props} titleKey="chat" />;
}
