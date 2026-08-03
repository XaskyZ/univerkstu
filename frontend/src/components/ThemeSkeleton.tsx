interface SkeletonProps {
    className?: string;
}

/**
 * Base skeleton component with theme-aware shimmer animation
 */
export function Skeleton({ className = '' }: SkeletonProps) {
    return <div className={`skeleton ${className}`} />;
}

/**
 * Skeleton for schedule page - matches the actual layout
 */
export function ScheduleSkeleton() {
    return (
        <div className="px-4 py-4 space-y-4 animate-fadeIn">
            {/* Week info skeleton */}
            <div className="card p-4">
                <div className="flex justify-between items-center mb-3">
                    <div>
                        <Skeleton className="h-5 w-28 mb-2" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-8 w-24 rounded-full" />
                </div>
                <div className="pt-3 border-t border-[var(--border)]">
                    <Skeleton className="h-10 w-full rounded-lg" />
                </div>
            </div>

            {/* Day cards skeleton */}
            {[1, 2, 3].map((i) => (
                <div key={i} className="card overflow-hidden" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="p-3 border-b border-[var(--border)]">
                        <Skeleton className="h-5 w-24" />
                    </div>
                    <div className="p-3 space-y-2">
                        <Skeleton className="h-16 w-full rounded-lg" />
                        <Skeleton className="h-16 w-full rounded-lg" />
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Skeleton for login page
 */
export function LoginSkeleton() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 animate-fadeIn">
            <Skeleton className="w-20 h-20 rounded-full mb-6" />
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64 mb-8" />
            <div className="w-full max-w-sm space-y-4">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
            </div>
        </div>
    );
}

/**
 * Skeleton for profile page
 */
export function ProfileSkeleton() {
    return (
        <div className="px-4 py-4 space-y-4 animate-fadeIn">
            {/* Profile card */}
            <div className="card p-6">
                <div className="flex items-center gap-4 mb-4">
                    <Skeleton className="w-16 h-16 rounded-full" />
                    <div className="flex-1">
                        <Skeleton className="h-5 w-32 mb-2" />
                        <Skeleton className="h-4 w-24" />
                    </div>
                </div>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="card p-4">
                        <Skeleton className="h-4 w-16 mb-2" />
                        <Skeleton className="h-6 w-12" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Generic loading spinner (fallback)
 */
export function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center p-8">
            <div
                className="w-10 h-10 rounded-full border-3 border-t-transparent animate-spin"
                style={{
                    borderColor: 'rgba(var(--primary-rgb), 0.3)',
                    borderTopColor: 'transparent',
                    borderWidth: '3px'
                }}
            />
        </div>
    );
}
