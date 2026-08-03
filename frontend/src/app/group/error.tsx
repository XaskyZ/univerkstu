'use client';

import { RouteError } from '@/components/RouteError';

export default function GroupError(props: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteError {...props} titleKey="group" />;
}
