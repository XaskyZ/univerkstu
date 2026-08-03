'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { CalendarRange, Copy, MapPin, User } from 'lucide-react';
import type { Lesson, TimeSlot } from '@/lib/types';
import { useLanguage, formatMessage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { getCurrentLessonProgress, getLessonDisplayRange } from '../utils/time-helpers';
import { getLessonDetailUi } from '../utils/lesson-detail-i18n';
import { formatLessonPeriod } from '../utils/lesson-period';
import { getLessonTypeBadge, getLessonTypeClass } from '../utils/lesson-type';

const TeacherProfileModal = dynamic(() => import('@/components/TeacherProfileModal'), { ssr: false });

interface LessonCardWithModalProps {
    lesson: Lesson;
    timeSlot: TimeSlot;
    dayKey: string;
    currentDayKey: string;
    nowMs: number;
    noteText: string;
    onNoteSave: (value: string) => void;
    onNoteDelete: () => void;
    onCustomClick?: (id: string) => void;
    enableCustomLessons?: boolean;
}

/** Lesson card wrapper that owns teacher-profile modal state. */
export function LessonCardWithModal({
    lesson,
    timeSlot,
    dayKey,
    currentDayKey,
    nowMs,
    noteText,
    onNoteSave,
    onNoteDelete,
    onCustomClick,
    enableCustomLessons = false,
}: LessonCardWithModalProps) {
    const [selectedTeacherUrl, setSelectedTeacherUrl] = useState<string | null>(null);
    const customId = enableCustomLessons && lesson.rawParams?.startsWith('__custom__:')
        ? lesson.rawParams.slice(11)
        : null;

    return (
        <>
            <LessonCardMobile
                lesson={lesson}
                timeSlot={timeSlot}
                dayKey={dayKey}
                currentDayKey={currentDayKey}
                nowMs={nowMs}
                isCustom={!!customId}
                noteText={noteText}
                onNoteSave={onNoteSave}
                onNoteDelete={onNoteDelete}
                onTeacherClick={lesson.teacherUrl ? () => setSelectedTeacherUrl(lesson.teacherUrl!) : undefined}
                onCardClick={customId && onCustomClick ? () => onCustomClick(customId) : undefined}
            />
            <TeacherProfileModal
                teacherUrl={selectedTeacherUrl}
                teacherName={lesson.teacherName || lesson.teacher}
                onClose={() => setSelectedTeacherUrl(null)}
            />
        </>
    );
}

interface LessonCardMobileProps {
    lesson: Lesson;
    timeSlot: TimeSlot;
    dayKey: string;
    currentDayKey: string;
    nowMs: number;
    noteText: string;
    onNoteSave: (value: string) => void;
    onNoteDelete: () => void;
    isCustom?: boolean;
    onTeacherClick?: () => void;
    onCardClick?: () => void;
}

export function LessonCardMobile({
    lesson,
    timeSlot,
    dayKey,
    currentDayKey,
    nowMs,
    noteText,
    onNoteSave,
    onNoteDelete,
    isCustom,
    onTeacherClick,
    onCardClick,
}: LessonCardMobileProps) {
    const { messages, language } = useLanguage();
    const detailUi = useMemo(() => getLessonDetailUi(language), [language]);
    const [noteOpen, setNoteOpen] = useState(false);
    const [draftNote, setDraftNote] = useState(noteText);
    useEffect(() => {
        setDraftNote(noteText);
    }, [noteText]);
    const ui = {
        manual: language === 'en' ? 'Manual' : language === 'kz' ? 'Қолмен' : 'Вручную',
        openTeacherProfile: language === 'en' ? 'Open teacher profile' : language === 'kz' ? 'Оқытушы профилін ашу' : 'Открыть профиль преподавателя',
        note: language === 'en' ? 'Note' : language === 'kz' ? 'Жазба' : 'Заметка',
        notePlaceholder: language === 'en' ? 'Write a short note for this lesson...' : language === 'kz' ? 'Осы сабаққа қысқа жазба қалдырыңыз...' : 'Напиши короткую заметку к этой паре...',
        save: language === 'en' ? 'Save' : language === 'kz' ? 'Сақтау' : 'Сохранить',
        clear: language === 'en' ? 'Clear' : language === 'kz' ? 'Тазарту' : 'Очистить',
        savedNote: language === 'en' ? 'Saved note' : language === 'kz' ? 'Сақталған жазба' : 'Сохранённая заметка',
        copy: language === 'en' ? 'Copy details' : language === 'kz' ? 'Деректерді көшіру' : 'Скопировать данные',
        copied: language === 'en' ? 'Copied' : language === 'kz' ? 'Көшірілді' : 'Скопировано',
        copyFailed: language === 'en' ? 'Could not copy' : language === 'kz' ? 'Көшіру сәтсіз' : 'Не удалось скопировать',
    };
    const parityClass = lesson.parity === 'num' ? 'parity-num' :
        lesson.parity === 'den' ? 'parity-den' : '';

    const typeClass = getLessonTypeClass(lesson.type, lesson.title);
    const typeBadge = useMemo(
        () => getLessonTypeBadge(lesson.type, lesson.title, language, messages.schedule.lessonFallbackType),
        [language, lesson.title, lesson.type, messages.schedule.lessonFallbackType]
    );
    const shortType = typeBadge?.label || '';
    const periodLabel = useMemo(() => formatLessonPeriod(lesson.period, language), [lesson.period, language]);
    const expandBuildingLabel = useCallback((value: string | null | undefined) => {
        const raw = (value || '').trim();
        if (!raw) return '';
        const normalized = raw.replace(/\s+/g, '').toUpperCase();

        const directMap: Record<string, string> = {
            'ГЛА': 'Главный корпус',
            'ГК': 'Главный корпус',
            'ГЛК': 'Главный корпус',
            '1К': '1-й корпус',
            '2К': '2-й корпус',
            '3К': '3-й корпус',
            '4К': '4-й корпус',
            '5К': '5-й корпус',
        };

        if (language === 'en') {
            const enMap: Record<string, string> = {
                'ГЛА': 'Main building',
                'ГК': 'Main building',
                'ГЛК': 'Main building',
                '1К': 'Building 1',
                '2К': 'Building 2',
                '3К': 'Building 3',
                '4К': 'Building 4',
                '5К': 'Building 5',
            };
            return enMap[normalized] || raw;
        }

        if (language === 'kz') {
            const kzMap: Record<string, string> = {
                'ГЛА': 'Бас корпус',
                'ГК': 'Бас корпус',
                'ГЛК': 'Бас корпус',
                '1К': '1-корпус',
                '2К': '2-корпус',
                '3К': '3-корпус',
                '4К': '4-корпус',
                '5К': '5-корпус',
            };
            return kzMap[normalized] || raw;
        }

        return directMap[normalized] || raw;
    }, [language]);
    const formatRoomLabel = useCallback((room: string | null | undefined) => {
        const raw = (room || '').trim();
        if (!raw) return '';
        const digitsMatch = raw.match(/(\d{2,4})$/);
        const digits = digitsMatch?.[1];

        if (language === 'en') {
            return digits ? `room ${digits}` : raw;
        }
        if (language === 'kz') {
            return digits ? `${digits}-аудитория` : raw;
        }
        return digits ? `${digits}-я аудитория` : `${messages.schedule.roomPrefix} ${raw}`;
    }, [language, messages.schedule.roomPrefix]);
    const displayTeacher = lesson.teacherName || lesson.teacher;
    const displayLocation = [
        expandBuildingLabel(lesson.faculty),
        formatRoomLabel(lesson.room),
    ].filter(Boolean).join(', ');
    const progress = useMemo(
        () => getCurrentLessonProgress(nowMs, dayKey, currentDayKey, lesson, timeSlot),
        [currentDayKey, dayKey, lesson, nowMs, timeSlot]
    );
    const lessonRange = useMemo(() => getLessonDisplayRange(lesson, timeSlot), [lesson, timeSlot]);

    const handleCopy = async (event: React.MouseEvent) => {
        event.stopPropagation();
        const parts = [lesson.title];
        if (shortType) parts.push(shortType);
        if (displayTeacher) parts.push(displayTeacher);
        if (displayLocation) parts.push(displayLocation);
        parts.push(`${lessonRange.start}–${lessonRange.end}`);
        try {
            await navigator.clipboard.writeText(parts.filter(Boolean).join('\n'));
            toast.success(ui.copied);
        } catch {
            toast.error(ui.copyFailed);
        }
    };

    return (
        <div className={`lesson-card ${parityClass}`} onClick={onCardClick} style={onCardClick ? { cursor: 'pointer' } : undefined}>
            {noteText && (
                <span
                    className="lesson-note-indicator"
                    role="img"
                    aria-label={detailUi.hasNoteIndicator}
                    title={noteText.length > 80 ? `${noteText.slice(0, 80).trim()}…` : noteText}
                />
            )}
            {progress && (
                <div className="mb-3">
                    <div className="lesson-progress-row">
                        <div className="lesson-progress-badge">
                            <span>⚡ {messages.schedule.nextUp.badgeNow}</span>
                            <span>{lessonRange.start}–{lessonRange.end}</span>
                        </div>
                        <span className="lesson-progress-time" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatMessage(messages.schedule.lessonRemaining, { value: progress.remainingMinutes })}
                        </span>
                    </div>
                    <div className="lesson-progress-bar">
                        <motion.div
                            className="lesson-progress-fill"
                            initial={false}
                            animate={{ width: `${Math.max(6, progress.ratio * 100)}%` }}
                            transition={{ duration: 1.6, ease: 'easeOut' }}
                        >
                            <motion.div
                                className="lesson-progress-shine"
                                animate={{ x: ['-35%', '135%'] }}
                                transition={{ duration: 2.4, ease: 'linear', repeat: Infinity }}
                            />
                        </motion.div>
                    </div>
                    <div className="lesson-progress-footer">
                        <span>{messages.schedule.lessonProgressLabel}</span>
                        <span>{`${progress.elapsedMinutes} / ${progress.totalMinutes} ${messages.schedule.minutesUnit}`}</span>
                    </div>
                </div>
            )}
            <div className="flex items-start justify-between gap-2">
                <h4 className="lesson-title">{lesson.title}</h4>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        className="lesson-badge lesson-note-btn cursor-pointer"
                        onClick={handleCopy}
                        title={ui.copy}
                        aria-label={ui.copy}
                    >
                        <Copy className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                    </button>
                    <button
                        type="button"
                        className={`lesson-badge cursor-pointer ${noteText ? 'lesson-note-btn-active' : 'lesson-note-btn'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setNoteOpen((prev) => !prev);
                        }}
                        title={ui.note}
                    >
                        📝 {noteText ? 1 : '+'}
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap">
                {typeBadge && (
                    <span
                        className={`lesson-badge ${typeClass}`}
                        title={typeBadge.description || undefined}
                        aria-label={typeBadge.description || undefined}
                    >
                        {typeBadge.label}
                    </span>
                )}

                {lesson.parity !== 'all' && (
                    <span
                        className={`lesson-badge ${lesson.parity === 'num' ? 'numerator' : 'denominator'}`}
                        title={lesson.parity === 'num' ? messages.schedule.numeratorTitle : messages.schedule.denominatorTitle}
                    >
                        {lesson.parity === 'num' ? messages.schedule.numerator : messages.schedule.denominator}
                    </span>
                )}

                {isCustom && (
                    <span className="lesson-badge custom">
                        📌 {ui.manual}
                    </span>
                )}

                {lesson.customTime && (
                    <span className="lesson-badge theme-status-badge-info">
                        🕒 {lesson.customTime.start}-{lesson.customTime.end}
                    </span>
                )}

                {periodLabel && (
                    <span
                        className="lesson-badge lesson-badge-period"
                        title={periodLabel.title}
                    >
                        <CalendarRange className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                        {periodLabel.label}
                    </span>
                )}

                {noteText && (
                    <span className="lesson-badge saved-note">
                        📝 {ui.savedNote}
                    </span>
                )}
            </div>

            {lesson.teacher && (
                <div className="lesson-detail">
                    <User className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                    {onTeacherClick ? (
                        <button
                            className="theme-link inline-flex items-start gap-1 transition-colors cursor-pointer bg-transparent border-none p-0 text-left lesson-detail-label"
                            title={ui.openTeacherProfile}
                            onClick={(e) => { e.stopPropagation(); onTeacherClick(); }}
                        >
                            <span style={{ display: 'inline-block', whiteSpace: 'normal', wordBreak: 'break-word' }}>{displayTeacher}</span>
                            <User className="w-3 h-3 shrink-0 opacity-70" style={{ marginTop: '3px' }} strokeWidth={2} aria-hidden />
                        </button>
                    ) : (
                        <span className="lesson-detail-label">{displayTeacher}</span>
                    )}
                </div>
            )}

            {lesson.room && (
                <div className="lesson-detail">
                    <MapPin className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                    <span className="lesson-detail-label">
                        {displayLocation || `${messages.schedule.roomPrefix} ${lesson.room}`}
                    </span>
                </div>
            )}

            {noteOpen && (
                <div
                    className="lesson-note-editor"
                    onClick={(e) => e.stopPropagation()}
                >
                    <textarea
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        placeholder={ui.notePlaceholder}
                        rows={3}
                        maxLength={500}
                        className="lesson-note-textarea"
                    />
                    <div className="lesson-note-actions">
                        <span className="lesson-note-counter">
                            {draftNote.trim().length}/500
                        </span>
                        <div className="lesson-note-buttons">
                            {noteText && (
                                <button
                                    type="button"
                                    className="lesson-note-btn-action lesson-note-btn-clear"
                                    onClick={() => {
                                        setDraftNote('');
                                        onNoteDelete();
                                        setNoteOpen(false);
                                    }}
                                >
                                    {ui.clear}
                                </button>
                            )}
                            <button
                                type="button"
                                className="lesson-note-btn-action lesson-note-btn-save"
                                onClick={() => {
                                    onNoteSave(draftNote);
                                    if (!draftNote.trim()) {
                                        setDraftNote('');
                                    }
                                    setNoteOpen(false);
                                }}
                            >
                                {ui.save}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
