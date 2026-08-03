import { ChevronDown } from 'lucide-react';
import { UMKDCourse } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import { UMKDFileList } from './UMKDFileList';

interface UMKDCourseCardProps {
    course: UMKDCourse;
    index: number;
    isExpanded: boolean;
    onToggle: () => void;
}

/**
 * Legacy inline-expand card layout. The current /umkd index page renders a
 * tile grid instead and drills into `/umkd/[courseId]` for the file list, so
 * this component is no longer reachable from the index — but it's kept
 * intact for any future reuse (or for reverting if the tile grid needs
 * rolling back).
 *
 * Inner file rendering now lives in `UMKDFileList.tsx` so this card and the
 * detail page share the same code path.
 */
export function UMKDCourseCard({ course, index, isExpanded, onToggle }: UMKDCourseCardProps) {
    const { messages } = useLanguage();
    return (
        <div
            className="card animate-fadeInUp overflow-hidden"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            <button
                onClick={onToggle}
                className="w-full p-4 flex items-center justify-between text-left transition-all"
                style={{ background: isExpanded ? 'rgba(var(--primary-rgb), 0.1)' : 'transparent' }}
            >
                <div className="flex-1 min-w-0 pr-4">
                    <h3 className="font-semibold text-sm leading-tight text-fg">
                        {course.name}
                    </h3>
                    {course.kind && (
                        <span className="text-xs mt-1 inline-block text-muted-fg">
                            {messages.umkd.courseCodePrefix}: {course.kind}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {course.files.length > 0 ? (
                        <span className="text-xs px-2 py-1 rounded-full"
                            style={{ background: 'var(--primary)', color: 'white' }}>
                            {course.files.length}
                        </span>
                    ) : course.isEmpty ? (
                        <span className="text-xs px-2 py-1 rounded-full"
                            style={{ background: 'var(--muted)', color: 'white' }}>
                            0
                        </span>
                    ) : null}
                    <ChevronDown
                        className={`w-5 h-5 transition-transform text-muted-fg ${isExpanded ? 'rotate-180' : ''}`}
                        strokeWidth={2}
                        aria-hidden
                    />
                </div>
            </button>

            {isExpanded && (
                <div className="animate-fadeIn">
                    <UMKDFileList course={course} />
                </div>
            )}
        </div>
    );
}
