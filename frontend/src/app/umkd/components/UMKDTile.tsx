'use client';

import { useRouter } from 'next/navigation';
import { UMKDCourse } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import {
    categorizeUmkdCourse,
    UMKD_CATEGORY_LABEL,
} from '../lib/categorize';
import { UMKD_CATEGORY_ICONS } from '../icons';

interface UMKDTileProps {
    course: UMKDCourse;
}

/**
 * Returns the language-aware "файлов" / "файл" / "файла" plural form.
 */
function pluralizeFiles(count: number, forms: { one: string; few: string; many: string }): string {
    const abs = Math.abs(count);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return forms.one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms.few;
    return forms.many;
}

export function UMKDTile({ course }: UMKDTileProps) {
    const router = useRouter();
    const { messages, language } = useLanguage();

    const categoryKey = categorizeUmkdCourse(course.name);
    const Icon = UMKD_CATEGORY_ICONS[categoryKey];
    const categoryLabel = UMKD_CATEGORY_LABEL[categoryKey][language];

    const fileCount = course.files.length;
    const isEmpty = fileCount === 0;

    const metaText = `${fileCount} ${pluralizeFiles(fileCount, messages.umkd.filesShort)}`;

    const handleOpen = () => {
        router.push(`/umkd/${encodeURIComponent(course.id)}`);
    };

    return (
        <button
            type="button"
            onClick={handleOpen}
            aria-label={`${course.name} — ${categoryLabel}${isEmpty ? ` (${messages.umkd.empty})` : ''}`}
            className="card text-left p-4 flex flex-col gap-3 transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2"
            style={{
                opacity: isEmpty ? 0.55 : 1,
                cursor: 'pointer',
                width: '100%',
                minHeight: '140px',
            }}
        >
            <div
                className="flex items-center justify-center w-12 h-12 rounded-xl"
                style={{
                    background: 'rgba(var(--primary-rgb), 0.12)',
                    color: 'var(--primary)',
                }}
                aria-hidden
                title={categoryLabel}
            >
                <Icon className="w-10 h-10" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
                <h3
                    className="text-sm font-semibold leading-tight"
                    style={{
                        color: 'var(--text)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                    }}
                >
                    {course.name}
                </h3>
                {!isEmpty && (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {metaText}
                    </span>
                )}
            </div>
        </button>
    );
}
