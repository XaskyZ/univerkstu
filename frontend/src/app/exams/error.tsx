'use client';

import { RouteError } from '@/components/RouteError';

export default function ExamsError(props: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteError {...props} titleKey="exams" />;
}
