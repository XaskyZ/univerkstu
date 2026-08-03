'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ExternalLink, User, X } from 'lucide-react';
import { getTeacherProfile, type TeacherProfile } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import TeacherNotesPanel from '@/app/teacher/components/TeacherNotesPanel';

interface TeacherProfileModalProps {
    teacherUrl: string | null;
    teacherName?: string;
    onClose: () => void;
}

export default function TeacherProfileModal({ teacherUrl, teacherName, onClose }: TeacherProfileModalProps) {
    const { messages } = useLanguage();
    const [profile, setProfile] = useState<TeacherProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
    const dialogRef = useRef<HTMLDialogElement | null>(null);

    useEffect(() => {
        if (!teacherUrl) return;
        setPhotoLoadFailed(false);

        const loadProfile = async () => {
            setLoading(true);
            setError(null);

            try {
                const res = await getTeacherProfile(teacherUrl);
                if (res.success && res.data) {
                    setProfile(res.data);
                } else {
                    setError(res.error || messages.teacherProfile.loadFailed);
                }
            } catch {
                setError(messages.teacherProfile.networkError);
            } finally {
                setLoading(false);
            }
        };

        void loadProfile();
    }, [messages.teacherProfile.loadFailed, messages.teacherProfile.networkError, teacherUrl]);

    // Native <dialog> manages body scroll-lock automatically when shown via showModal().
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (teacherUrl && !dialog.open) {
            dialog.showModal();
        } else if (!teacherUrl && dialog.open) {
            dialog.close();
        }
    }, [teacherUrl]);

    // Reset cached profile after the dialog closes so we don't flash old content.
    useEffect(() => {
        if (teacherUrl) return;
        const t = setTimeout(() => {
            setProfile(null);
            setError(null);
            setLoading(true);
        }, 300);
        return () => clearTimeout(t);
    }, [teacherUrl]);

    return (
        <dialog
            ref={dialogRef}
            className="teacher-profile-dialog"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            <div className="teacher-profile-panel">
                <div className="teacher-profile-handle" aria-hidden />

                <div className="teacher-profile-header">
                    <h2 className="text-lg font-semibold truncate text-fg">
                        {loading ? messages.teacherProfile.loadingShort : (profile?.name || teacherName || messages.teacherProfile.teacherFallback)}
                    </h2>
                    <button
                        onClick={onClose}
                        className="teacher-profile-close"
                        aria-label={messages.common.close}
                    >
                        <X className="w-5 h-5" strokeWidth={2} aria-hidden />
                    </button>
                </div>

                <div className="teacher-profile-content">
                    {loading && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <div
                                className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin"
                                style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                            />
                            <p className="text-sm text-muted-fg">{messages.teacherProfile.loadingProfile}</p>
                        </div>
                    )}

                    {error && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <div className="text-4xl">😔</div>
                            <p className="text-sm text-muted-fg text-center">{error}</p>
                            {teacherUrl && (
                                <a
                                    href={teacherUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="theme-link text-sm mt-2"
                                >
                                    {messages.teacherProfile.openOnSite}
                                </a>
                            )}
                        </div>
                    )}

                    {!loading && !error && profile && (
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                {profile.photoUrl && !photoLoadFailed ? (
                                    <div className="shrink-0 w-24 h-28 rounded-xl overflow-hidden surface-overlay-2">
                                        <Image
                                            src={profile.photoUrl}
                                            alt={profile.name}
                                            width={96}
                                            height={112}
                                            unoptimized
                                            className="w-full h-full object-cover"
                                            onError={() => setPhotoLoadFailed(true)}
                                        />
                                    </div>
                                ) : (
                                    <div className="shrink-0 w-24 h-28 rounded-xl flex items-center justify-center surface-overlay-2">
                                        <User className="w-10 h-10 text-muted-fg" strokeWidth={1.5} aria-hidden />
                                    </div>
                                )}

                                <div className="flex flex-col justify-center gap-1.5 min-w-0">
                                    {profile.position && (
                                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-fg">
                                            <span className="shrink-0">💼</span>
                                            <span className="truncate">{profile.position}</span>
                                        </span>
                                    )}
                                    {profile.degree && (
                                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-fg">
                                            <span className="shrink-0">🎓</span>
                                            <span className="truncate">{profile.degree}</span>
                                        </span>
                                    )}
                                    {profile.department && (
                                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-fg">
                                            <span className="shrink-0">🏛️</span>
                                            <span className="truncate">{profile.department}</span>
                                        </span>
                                    )}
                                    {profile.faculty && (
                                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-fg">
                                            <span className="shrink-0">🏫</span>
                                            <span className="truncate">{profile.faculty}</span>
                                        </span>
                                    )}
                                </div>
                            </div>

                            {(profile.contacts.email || profile.contacts.phone) && (
                                <div className="rounded-xl p-3.5 space-y-2.5 surface-overlay-1">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-fg">{messages.teacherProfile.contacts}</h3>
                                    {profile.contacts.email && (
                                        <a
                                            href={`mailto:${profile.contacts.email}`}
                                            className="theme-link flex items-center gap-2.5 text-sm"
                                        >
                                            <span>📧</span>
                                            <span className="truncate">{profile.contacts.email}</span>
                                        </a>
                                    )}
                                    {profile.contacts.phone && (
                                        <a
                                            href={`tel:${profile.contacts.phone}`}
                                            className="theme-link flex items-center gap-2.5 text-sm"
                                        >
                                            <span>📞</span>
                                            <span>{profile.contacts.phone}</span>
                                        </a>
                                    )}
                                </div>
                            )}

                            {profile.bio && (
                                <div className="space-y-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-fg">{messages.teacherProfile.aboutTeacher}</h3>
                                    <p className="text-sm text-muted-fg leading-relaxed line-clamp-6">
                                        {profile.bio}
                                    </p>
                                </div>
                            )}

                            <TeacherNotesPanel teacherKey={profile.name || teacherName || ''} />

                            <a
                                href={profile.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm text-muted-fg hover:opacity-80 transition-colors surface-overlay-2"
                            >
                                <span>{messages.teacherProfile.openFullProfile}</span>
                                <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </dialog>
    );
}
