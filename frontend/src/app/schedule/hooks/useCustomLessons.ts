'use client';

import { useCallback, useState } from 'react';
import { type CustomLesson, getCustomLessons } from '@/lib/custom-lessons';
import { getScheduleNotes, removeScheduleNote, saveScheduleNote } from '@/lib/schedule-notes';

/**
 * Owns custom lessons + lesson notes state.
 *
 *  - `customLessons` — manually added lessons (for future group space, currently disabled)
 *  - `lessonNotesByUser` — per-user note dictionary (keyed by lesson noteKey)
 *  - Add/Edit modal state for the manual-lesson modal
 */
export function useCustomLessons(userId: string) {
    const [customLessons, setCustomLessons] = useState<CustomLesson[]>(() => getCustomLessons());
    const [lessonNotesByUser, setLessonNotesByUser] = useState<Record<string, Record<string, string>>>(() => ({
        [userId]: getScheduleNotes(userId),
    }));
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [editingLesson, setEditingLesson] = useState<CustomLesson | null>(null);
    const [addModalDefaultDay, setAddModalDefaultDay] = useState(0);

    const refreshCustomLessons = useCallback(() => {
        setCustomLessons(getCustomLessons());
    }, []);

    const saveLessonNote = useCallback((noteKey: string, value: string) => {
        const nextNotes = saveScheduleNote(userId, noteKey, value);
        setLessonNotesByUser((prev) => ({ ...prev, [userId]: nextNotes }));
    }, [userId]);

    const deleteLessonNote = useCallback((noteKey: string) => {
        const nextNotes = removeScheduleNote(userId, noteKey);
        setLessonNotesByUser((prev) => ({ ...prev, [userId]: nextNotes }));
    }, [userId]);

    const openAddModal = useCallback((dayIdx: number) => {
        setEditingLesson(null);
        setAddModalDefaultDay(dayIdx);
        setAddModalOpen(true);
    }, []);

    const openEditModal = useCallback((lesson: CustomLesson) => {
        setEditingLesson(lesson);
        setAddModalDefaultDay(lesson.dayIndex);
        setAddModalOpen(true);
    }, []);

    const closeModal = useCallback(() => {
        setAddModalOpen(false);
        setEditingLesson(null);
    }, []);

    const lessonNotes = lessonNotesByUser[userId] || getScheduleNotes(userId);

    return {
        customLessons,
        lessonNotes,
        addModalOpen,
        editingLesson,
        addModalDefaultDay,
        refreshCustomLessons,
        saveLessonNote,
        deleteLessonNote,
        openAddModal,
        openEditModal,
        closeModal,
    };
}
