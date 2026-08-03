'use client';

import { MapPin, User } from 'lucide-react';
import { Lesson } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import {
    detectLessonTypeKind,
    detectSelfStudyKind,
    getLessonTypeLabel,
    type LessonTypeKind,
} from '@/app/schedule/utils/lesson-type';

export type LessonAccentType = LessonTypeKind | 'srsp';

/**
 * Accent bucket used for the `data-type` styling hook. The label wording lives
 * in `@/app/schedule/utils/lesson-type` — this only picks the accent.
 */
export function detectAccentType(rawType: string | null): LessonAccentType {
    const kind = detectLessonTypeKind(rawType);
    if (kind !== 'other') return kind;
    return detectSelfStudyKind(rawType) === 'srsp' ? 'srsp' : 'other';
}

interface LessonCardProps {
    lesson: Lesson;
    /** Optional time slot start/end shown on the left rail. */
    startTime?: string;
    endTime?: string;
}

export default function LessonCard({ lesson, startTime, endTime }: LessonCardProps) {
    const { messages, language } = useLanguage();
    const accentType = detectAccentType(lesson.type);

    const typeLabel = getLessonTypeLabel(lesson.type, language, messages.schedule.lessonFallbackType);

    const parityLabel = lesson.parity === 'num'
        ? messages.schedule.numerator
        : lesson.parity === 'den'
            ? messages.schedule.denominator
            : '';

    return (
        <article className="lesson-card-v2" data-type={accentType}>
            {(startTime || endTime) ? (
                <div className="lesson-card-time">
                    <div>{startTime || '—'}</div>
                    {endTime ? <div className="lesson-card-time-end">{endTime}</div> : null}
                </div>
            ) : null}

            <div className="lesson-card-body">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <h4 className="lesson-card-title">{lesson.title}</h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {typeLabel ? (
                            <span
                                className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                style={{
                                    background: 'var(--lesson-accent, var(--primary))',
                                    color: '#fff',
                                    opacity: 0.92,
                                }}
                            >
                                {typeLabel}
                            </span>
                        ) : null}
                        {parityLabel ? (
                            <span
                                className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                title={lesson.parity === 'num' ? messages.schedule.numeratorTitle : messages.schedule.denominatorTitle}
                                style={{
                                    background: lesson.parity === 'num'
                                        ? 'rgba(var(--good-rgb), 0.16)'
                                        : 'rgba(var(--status-warning-rgb), 0.16)',
                                    color: lesson.parity === 'num'
                                        ? 'var(--good)'
                                        : 'var(--status-warning-color, var(--accent-2))',
                                }}
                            >
                                {parityLabel}
                            </span>
                        ) : null}
                    </div>
                </div>

                {(lesson.teacher || lesson.room) ? (
                    <div className="lesson-card-meta">
                        {lesson.teacher ? (
                            <span className="lesson-card-meta-item">
                                <User className="w-3 h-3 opacity-60" aria-hidden />
                                <span>{lesson.teacher}</span>
                            </span>
                        ) : null}
                        {lesson.room ? (
                            <span className="lesson-card-meta-item">
                                <MapPin className="w-3 h-3 opacity-60" aria-hidden />
                                <span>
                                    {lesson.faculty ? `${lesson.faculty}, ` : ''}
                                    {messages.schedule.roomPrefix} {lesson.room}
                                </span>
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </article>
    );
}
