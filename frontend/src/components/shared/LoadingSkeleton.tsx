import type { FC } from 'react';

/**
 * Reusable loading skeleton components
 * Replace abrupt spinners with content-shaped placeholders
 */

export const SkeletonBlock: FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />
);

export const SkeletonLine: FC<{ width?: string }> = ({ width = 'w-full' }) => (
    <div className={`h-4 animate-pulse rounded bg-slate-200 ${width}`} />
);

export const CardSkeleton: FC = () => (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <SkeletonBlock className="mb-3 h-4 w-1/3" />
        <SkeletonBlock className="mb-2 h-8 w-1/4" />
        <SkeletonBlock className="h-3 w-2/3" />
    </div>
);

export const TaskCardSkeleton: FC = () => (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3">
            <SkeletonBlock className="h-5 w-5 rounded" />
            <div className="flex-1 space-y-2">
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="h-3 w-1/2" />
                <div className="flex gap-2">
                    <SkeletonBlock className="h-5 w-16 rounded-full" />
                    <SkeletonBlock className="h-5 w-12 rounded-full" />
                </div>
            </div>
        </div>
    </div>
);

export const ListSkeleton: FC<{ count?: number }> = ({ count = 5 }) => (
    <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
            <TaskCardSkeleton key={i} />
        ))}
    </div>
);

export const DashboardSkeleton: FC = () => (
    <div className="space-y-8 animate-in fade-in">
        {/* Header */}
        <div className="space-y-2">
            <SkeletonBlock className="h-8 w-64" />
            <SkeletonBlock className="h-4 w-96" />
        </div>
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
        </div>
        {/* Content area */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
            <div className="lg:col-span-8 space-y-6">
                <SkeletonBlock className="h-48 w-full rounded-xl" />
                <SkeletonBlock className="h-32 w-full rounded-xl" />
            </div>
            <div className="lg:col-span-4 space-y-4 xl:col-span-4">
                <ListSkeleton count={3} />
            </div>
        </div>
    </div>
);

export default {
    SkeletonBlock,
    SkeletonLine,
    CardSkeleton,
    TaskCardSkeleton,
    ListSkeleton,
    DashboardSkeleton,
};
