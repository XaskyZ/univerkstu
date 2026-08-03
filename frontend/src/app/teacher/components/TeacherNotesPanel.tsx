'use client';

/**
 * Private Teacher Notes panel — see backend/src/services/teacherNotes.ts.
 * Loads the current user's note for `teacherKey` on mount, lets them edit/save
 * or delete it. Plain text only, 2000-char cap enforced both client-side
 * (textarea maxLength) and server-side (Fastify schema + service validation).
 * Notes are strictly private; this panel never displays anyone else's data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
    deleteTeacherNote as deleteTeacherNoteApi,
    getTeacherNote,
    saveTeacherNote,
    TEACHER_NOTE_MAX_LENGTH,
} from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm-dialog';

interface TeacherNotesPanelProps {
    /** Normalized or raw teacher key — server normalizes again on its end. */
    teacherKey: string;
}

export default function TeacherNotesPanel({ teacherKey }: TeacherNotesPanelProps) {
    const { messages } = useLanguage();
    const labels = messages.teacherNotes;

    const [note, setNote] = useState('');
    const [savedNote, setSavedNote] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!teacherKey) return;

        let cancelled = false;
        const run = async () => {
            setLoading(true);
            setLoadError(false);
            try {
                const res = await getTeacherNote(teacherKey);
                if (cancelled) return;
                if (res.success && res.data) {
                    const value = res.data.note ?? '';
                    setNote(value);
                    setSavedNote(value);
                } else {
                    setLoadError(true);
                }
            } catch {
                if (!cancelled) setLoadError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void run();
        return () => {
            cancelled = true;
        };
    }, [teacherKey]);

    const handleSave = useCallback(async () => {
        if (saving) return;
        const trimmed = note.trim();
        if (trimmed.length > TEACHER_NOTE_MAX_LENGTH) {
            toast.error(labels.tooLong);
            return;
        }
        setSaving(true);
        try {
            const res = await saveTeacherNote(teacherKey, trimmed);
            if (res.success) {
                setSavedNote(trimmed);
                setNote(trimmed);
                toast.success(labels.saved);
            } else {
                const msg = (res.error || '').toLowerCase().includes('too long')
                    ? labels.tooLong
                    : labels.loadFailed;
                toast.error(msg);
            }
        } catch {
            toast.error(labels.loadFailed);
        } finally {
            setSaving(false);
        }
    }, [labels.loadFailed, labels.saved, labels.tooLong, note, saving, teacherKey]);

    const handleDelete = useCallback(async () => {
        if (deleting || saving) return;
        if (!savedNote) {
            // Nothing on server yet — just clear the textarea.
            setNote('');
            return;
        }
        if (!(await confirmDialog(labels.confirmDelete, { danger: true }))) {
            return;
        }
        setDeleting(true);
        try {
            const res = await deleteTeacherNoteApi(teacherKey);
            if (res.success) {
                setNote('');
                setSavedNote(null);
            } else {
                toast.error(labels.loadFailed);
            }
        } catch {
            toast.error(labels.loadFailed);
        } finally {
            setDeleting(false);
        }
    }, [deleting, labels.confirmDelete, labels.loadFailed, saving, savedNote, teacherKey]);

    const charCount = note.length;
    const overLimit = charCount > TEACHER_NOTE_MAX_LENGTH;
    const dirty = note.trim() !== (savedNote ?? '');
    const busy = saving || deleting;

    return (
        <div className="teacher-notes-panel">
            <div className="teacher-notes-header">
                <h3
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--muted)' }}
                >
                    {labels.label}
                </h3>
                <span
                    className="text-xs tabular-nums"
                    style={{ color: overLimit ? 'var(--danger)' : 'var(--muted)' }}
                    aria-live="polite"
                >
                    {charCount}/{TEACHER_NOTE_MAX_LENGTH}
                </span>
            </div>

            {loading ? (
                <div
                    className="teacher-notes-skeleton"
                    style={{
                        background: 'var(--surface-overlay-1, rgba(127,127,127,0.08))',
                        borderRadius: 12,
                        height: 96,
                    }}
                    aria-hidden
                />
            ) : (
                <>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={labels.placeholder}
                        maxLength={TEACHER_NOTE_MAX_LENGTH}
                        rows={4}
                        disabled={busy}
                        className="teacher-notes-textarea"
                        style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: 12,
                            border: '1px solid var(--border)',
                            background: 'var(--surface-overlay-1, transparent)',
                            color: 'var(--text)',
                            fontSize: '0.875rem',
                            lineHeight: 1.45,
                            resize: 'vertical',
                            outline: 'none',
                            opacity: busy ? 0.6 : 1,
                        }}
                    />

                    {loadError && (
                        <p
                            className="text-xs mt-1"
                            style={{ color: 'var(--danger)' }}
                        >
                            {labels.loadFailed}
                        </p>
                    )}

                    <div className="teacher-notes-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSave}
                            disabled={busy || overLimit || !dirty}
                            style={{ flex: 1 }}
                        >
                            {labels.save}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleDelete}
                            disabled={busy || (!savedNote && !note)}
                            aria-label={labels.delete}
                            style={{
                                color: 'var(--danger)',
                                borderColor: 'var(--border)',
                            }}
                        >
                            <Trash2 className="w-4 h-4" aria-hidden />
                            <span>{labels.delete}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
