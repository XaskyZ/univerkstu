'use client';

import { RouteError } from '@/components/RouteError';

export default function ProfileError(props: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteError {...props} titleKey="profile" />;
}
