'use client';

import { useEffect, useRef, useState } from 'react';
import { CustomLesson, addCustomLesson, updateCustomLesson, deleteCustomLesson } from '@/lib/custom-lessons';
import { TimeSlot } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import { LESSON_TYPES } from './add-lesson-modal/types';
import {
    createInitialFormState,
    getClosestTimeSlotIndex,
    shiftTimePart,
    toMinutes,
} from './add-lesson-modal/utils';
import { getAddLessonUi } from './add-lesson-modal/strings';

interface AddLessonModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    timeSlots: TimeSlot[];
    /** Pre-selected day index (0-5) when opening from a specific day */
    defaultDayIndex?: number;
    /** Existing lesson to edit (null = create new) */
    editLesson?: CustomLesson | null;
}

export default function AddLessonModal({
    isOpen,
    onClose,
    onSaved,
    timeSlots,
    defaultDayIndex = 0,
    editLesson = null,
}: AddLessonModalProps) {
    const dialogRef = useRef<HTMLDialogElement | null>(null);

    // Drive the native <dialog> imperatively. showModal() opens with browser
    // focus-trap + ::backdrop + native ESC handling for free.
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOpen && !dialog.open) {
            dialog.showModal();
        } else if (!isOpen && dialog.open) {
            dialog.close();
        }
    }, [isOpen]);

    const modalKey = editLesson ? `edit:${editLesson.id}` : `new:${defaultDayIndex}`;

    return (
        <dialog
            ref={dialogRef}
            className="add-lesson-dialog"
            onClick={(event) => {
                // Click on backdrop (the dialog element itself) closes; clicks
                // on the inner panel bubble up but pass the panel as target.
                if (event.target === event.currentTarget) onClose();
            }}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            {isOpen ? (
                <AddLessonModalBody
                    key={modalKey}
                    onClose={onClose}
                    onSaved={onSaved}
                    timeSlots={timeSlots}
                    defaultDayIndex={defaultDayIndex}
                    editLesson={editLesson}
                />
            ) : null}
        </dialog>
    );
}

function AddLessonModalBody({
    onClose,
    onSaved,
    timeSlots,
    defaultDayIndex = 0,
    editLesson = null,
}: Omit<AddLessonModalProps, 'isOpen'>) {
    const { language } = useLanguage();
    const [title, setTitle] = useState(() => createInitialFormState(editLesson, defaultDayIndex).title);
    const [type, setType] = useState<CustomLesson['type']>(() => createInitialFormState(editLesson, defaultDayIndex).type);
    const [teacher, setTeacher] = useState(() => createInitialFormState(editLesson, defaultDayIndex).teacher);
    const [room, setRoom] = useState(() => createInitialFormState(editLesson, defaultDayIndex).room);
    const [dayIndex, setDayIndex] = useState(() => createInitialFormState(editLesson, defaultDayIndex).dayIndex);
    const [timeSlotIndex, setTimeSlotIndex] = useState(() => createInitialFormState(editLesson, defaultDayIndex).timeSlotIndex);
    const [timeMode, setTimeMode] = useState<'slot' | 'custom'>(() => createInitialFormState(editLesson, defaultDayIndex).timeMode);
    const [customStart, setCustomStart] = useState(() => createInitialFormState(editLesson, defaultDayIndex).customStart);
    const [customEnd, setCustomEnd] = useState(() => createInitialFormState(editLesson, defaultDayIndex).customEnd);
    const [parity, setParity] = useState<'all' | 'num' | 'den'>(() => createInitialFormState(editLesson, defaultDayIndex).parity);
    const ui = getAddLessonUi(language);
    const customTimeInvalid =
        timeMode === 'custom' &&
        customStart.length > 0 &&
        customEnd.length > 0 &&
        (toMinutes(customEnd) ?? 0) <= (toMinutes(customStart) ?? Number.POSITIVE_INFINITY);

    const enableCustomMode = () => {
        if (timeMode !== 'custom') {
            const slot = timeSlots[timeSlotIndex];
            setCustomStart(slot?.start ?? '08:00');
            setCustomEnd(slot?.end ?? '08:45');
        }
        setTimeMode('custom');
    };

    const handleSave = () => {
        if (!title.trim()) return;
        if (timeMode === 'custom') {
            const start = toMinutes(customStart);
            const end = toMinutes(customEnd);
            if (start === null || end === null || end <= start) return;
        }

        const resolvedTimeSlotIndex = timeMode === 'custom'
            ? getClosestTimeSlotIndex(customStart, timeSlots)
            : timeSlotIndex;

        const data = {
            title: title.trim(),
            type,
            teacher: teacher.trim(),
            room: room.trim(),
            dayIndex,
            timeSlotIndex: resolvedTimeSlotIndex,
            customStart: timeMode === 'custom' ? customStart : undefined,
            customEnd: timeMode === 'custom' ? customEnd : undefined,
            parity,
        };

        if (editLesson) {
            updateCustomLesson(editLesson.id, data);
        } else {
            addCustomLesson(data);
        }

        onSaved();
        onClose();
    };

    const handleDelete = () => {
        if (!editLesson) return;
        deleteCustomLesson(editLesson.id);
        onSaved();
        onClose();
    };

    return (
        <div
            className="add-lesson-panel"
            onClick={(event) => event.stopPropagation()}
        >
                        {/* Header */}
                        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-fg">
                                {editLesson ? ui.editLesson : ui.addLesson}
                            </h2>
                            <button
                                onClick={onClose}
                                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                                style={{ background: 'var(--bg)', color: 'var(--muted)' }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Form */}
                        <div className="px-5 pb-[max(6rem,calc(68px+env(safe-area-inset-bottom)))] sm:pb-5 space-y-4 overflow-y-auto flex-1">
                            {/* Title */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.subject}
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder={ui.subjectPlaceholder}
                                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
                                    style={{
                                        background: 'var(--bg)',
                                        color: 'var(--text)',
                                        border: '1px solid var(--border)',
                                    }}
                                    autoFocus
                                />
                            </div>

                            {/* Type */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.type}
                                </label>
                                <div className="flex gap-2">
                                    {LESSON_TYPES.map(t => (
                                        <button
                                            key={t}
                                            onClick={() => setType(t)}
                                            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                                            style={{
                                                background: type === t ? 'var(--primary)' : 'var(--bg)',
                                                color: type === t ? '#fff' : 'var(--text-secondary)',
                                                border: `1px solid ${type === t ? 'var(--primary)' : 'var(--border)'}`,
                                            }}
                                        >
                                            {ui.typeLabels[t]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Day */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.day}
                                </label>
                                <div className="flex gap-1.5">
                                    {ui.dayNames.map((name, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setDayIndex(i)}
                                            className="flex-1 py-2 rounded-xl text-xs font-medium transition-all"
                                            style={{
                                                background: dayIndex === i ? 'var(--primary)' : 'var(--bg)',
                                                color: dayIndex === i ? '#fff' : 'var(--text-secondary)',
                                                border: `1px solid ${dayIndex === i ? 'var(--primary)' : 'var(--border)'}`,
                                            }}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Time */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.time}
                                </label>
                                <div className="flex gap-2 mb-2">
                                    <button
                                        type="button"
                                        onClick={() => setTimeMode('slot')}
                                        className="flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                                        style={{
                                            background: timeMode === 'slot' ? 'var(--primary)' : 'var(--bg)',
                                            color: timeMode === 'slot' ? '#fff' : 'var(--text-secondary)',
                                            border: `1px solid ${timeMode === 'slot' ? 'var(--primary)' : 'var(--border)'}`,
                                        }}
                                    >
                                        {ui.bySlots}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={enableCustomMode}
                                        className="flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                                        style={{
                                            background: timeMode === 'custom' ? 'var(--primary)' : 'var(--bg)',
                                            color: timeMode === 'custom' ? '#fff' : 'var(--text-secondary)',
                                            border: `1px solid ${timeMode === 'custom' ? 'var(--primary)' : 'var(--border)'}`,
                                        }}
                                    >
                                        {ui.customTime}
                                    </button>
                                </div>

                                {timeMode === 'slot' ? (
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {timeSlots.map((slot, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setTimeSlotIndex(i)}
                                                className="px-2 py-2 rounded-xl text-xs font-medium transition-all"
                                                style={{
                                                    background: timeSlotIndex === i ? 'var(--primary)' : 'var(--bg)',
                                                    color: timeSlotIndex === i ? '#fff' : 'var(--text-secondary)',
                                                    border: `1px solid ${timeSlotIndex === i ? 'var(--primary)' : 'var(--border)'}`,
                                                }}
                                            >
                                                {slot.start}–{slot.end}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <p className="text-[11px] mb-1 text-muted-fg">
                                                    {ui.start}
                                                </p>
                                                <div className="rounded-xl p-2.5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                                                    <div className="text-center mb-2">
                                                        <span className="text-base font-semibold tabular-nums text-fg">
                                                            {customStart || '--:--'}
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-1 mb-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomStart(v => shiftTimePart(v, 'hour', -1, '08:00'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.decHour}
                                                        </button>
                                                        <span className="text-[11px] self-center text-center text-muted-fg">
                                                            {ui.hours}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomStart(v => shiftTimePart(v, 'hour', 1, '08:00'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.incHour}
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomStart(v => shiftTimePart(v, 'minute', -1, '08:00'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.decMinute}
                                                        </button>
                                                        <span className="text-[11px] self-center text-center text-muted-fg">
                                                            {ui.minutes}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomStart(v => shiftTimePart(v, 'minute', 1, '08:00'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.incMinute}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            <div>
                                                <p className="text-[11px] mb-1 text-muted-fg">
                                                    {ui.end}
                                                </p>
                                                <div className="rounded-xl p-2.5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                                                    <div className="text-center mb-2">
                                                        <span className="text-base font-semibold tabular-nums text-fg">
                                                            {customEnd || '--:--'}
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-1 mb-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomEnd(v => shiftTimePart(v, 'hour', -1, '08:45'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.decHour}
                                                        </button>
                                                        <span className="text-[11px] self-center text-center text-muted-fg">
                                                            {ui.hours}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomEnd(v => shiftTimePart(v, 'hour', 1, '08:45'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.incHour}
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomEnd(v => shiftTimePart(v, 'minute', -1, '08:45'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.decMinute}
                                                        </button>
                                                        <span className="text-[11px] self-center text-center text-muted-fg">
                                                            {ui.minutes}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomEnd(v => shiftTimePart(v, 'minute', 1, '08:45'))}
                                                            className="px-2 py-1 rounded-lg text-xs surface-overlay-3"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {ui.incMinute}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        {customTimeInvalid && (
                                            <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>
                                                {ui.invalidTime}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Parity */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.week}
                                </label>
                                <div className="flex gap-2">
                                    {([['all', ui.every], ['num', ui.numerator], ['den', ui.denominator]] as const).map(([val, label]) => (
                                        <button
                                            key={val}
                                            onClick={() => setParity(val)}
                                            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                                            style={{
                                                background: parity === val ? 'var(--primary)' : 'var(--bg)',
                                                color: parity === val ? '#fff' : 'var(--text-secondary)',
                                                border: `1px solid ${parity === val ? 'var(--primary)' : 'var(--border)'}`,
                                            }}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Teacher (optional) */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.teacher}
                                </label>
                                <input
                                    type="text"
                                    value={teacher}
                                    onChange={e => setTeacher(e.target.value)}
                                    placeholder={ui.optional}
                                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
                                    style={{
                                        background: 'var(--bg)',
                                        color: 'var(--text)',
                                        border: '1px solid var(--border)',
                                    }}
                                />
                            </div>

                            {/* Room (optional) */}
                            <div>
                                <label className="block text-xs mb-1.5 font-medium text-muted-fg">
                                    {ui.room}
                                </label>
                                <input
                                    type="text"
                                    value={room}
                                    onChange={e => setRoom(e.target.value)}
                                    placeholder={ui.optional}
                                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
                                    style={{
                                        background: 'var(--bg)',
                                        color: 'var(--text)',
                                        border: '1px solid var(--border)',
                                    }}
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-2">
                                {editLesson && (
                                    <button
                                        onClick={handleDelete}
                                        className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                                        style={{
                                            background: 'rgba(255,107,138,0.15)',
                                            color: 'var(--danger)',
                                        }}
                                    >
                                        {ui.delete}
                                    </button>
                                )}
                                <button
                                    onClick={handleSave}
                                    disabled={
                                        !title.trim() ||
                                        (timeMode === 'custom' && (
                                            !customStart ||
                                            !customEnd ||
                                            customTimeInvalid
                                        ))
                                    }
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                                    style={{
                                        background: 'var(--gradient-primary)',
                                        color: '#fff',
                                    }}
                                >
                                    {editLesson ? ui.save : ui.add}
                                </button>
                            </div>
                        </div>
        </div>
    );
}
