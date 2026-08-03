'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import AttachmentsList from '@/components/AttachmentsList';
import {
    BOARD_CATEGORIES,
    BOARD_LOST_FOUND_TYPES,
    createBoardAnnouncement,
    getBoardAnnouncement,
    updateBoardAnnouncement,
    type BoardAnnouncement,
    type BoardCategory,
    type BoardDealType,
    type BoardLostFoundType,
} from '@/lib/api/board';
import { uploadAndAttachFile, validateAttachmentFile } from '@/app/group/utils/social-attachment-upload';
import { categoryColor, categoryLabel } from '../categories';

const TITLE_MAX = 200;
const BODY_MAX = 5000;
const MAX_PHOTOS = 5;
const CATEGORY_DEAL_TYPE: Record<BoardCategory, BoardDealType> = {
    sale: 'product',
    buy: 'product',
    service: 'service',
    event: 'other',
    lost_found: 'other',
    help: 'service',
    other: 'other',
};
const LOST_FOUND_LABEL: Record<BoardLostFoundType, string> = {
    lost: 'Потерял',
    found: 'Нашёл',
};

function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
    return (
        <label className="board-field-label">
            <span>{children}</span>
            <span className={required ? 'board-field-mark board-field-mark-required' : 'board-field-mark'}>
                {required ? 'обязательно' : 'опционально'}
            </span>
        </label>
    );
}

interface AnnouncementComposerProps {
    open: boolean;
    mode: 'create' | 'edit';
    initial: BoardAnnouncement | null;
    onClose: () => void;
    onSaved: (announcement: BoardAnnouncement) => void;
}

export function AnnouncementComposer({ open, mode, initial, onClose, onSaved }: AnnouncementComposerProps) {
    const { messages } = useLanguage();
    const { userId } = useAuth();
    const ui = messages.board;

    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [category, setCategory] = useState<BoardCategory>('other');
    const [dealType, setDealType] = useState<BoardDealType>('product');
    const [price, setPrice] = useState('');
    const [condition, setCondition] = useState('');
    const [location, setLocation] = useState('');
    const [serviceFormat, setServiceFormat] = useState('');
    const [eventAt, setEventAt] = useState('');
    const [lostFoundType, setLostFoundType] = useState<BoardLostFoundType>('lost');
    const [contactTelegram, setContactTelegram] = useState('');
    const [contactInstagram, setContactInstagram] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
    useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

    const [seedKey, setSeedKey] = useState<string | null>(null);
    const currentKey = open ? `${mode}:${initial?.entity.id ?? 'new'}` : null;
    if (currentKey !== seedKey) {
        setSeedKey(currentKey);
        if (open) {
            setTitle(initial?.entity.payload.title ?? '');
            setBody(initial?.entity.payload.body ?? '');
            const initialCategory = initial?.entity.payload.category;
            const resolvedCategory = BOARD_CATEGORIES.includes(initialCategory as BoardCategory)
                ? (initialCategory as BoardCategory)
                : 'other';
            setCategory(
                resolvedCategory,
            );
            setPrice(initial?.entity.payload.price ?? '');
            setCondition(initial?.entity.payload.condition ?? '');
            setLocation(initial?.entity.payload.location ?? '');
            setDealType(CATEGORY_DEAL_TYPE[resolvedCategory]);
            setServiceFormat(initial?.entity.payload.serviceFormat ?? '');
            setEventAt(initial?.entity.payload.eventAt?.slice(0, 10) ?? '');
            setLostFoundType(
                BOARD_LOST_FOUND_TYPES.includes(initial?.entity.payload.lostFoundType as BoardLostFoundType)
                    ? (initial?.entity.payload.lostFoundType as BoardLostFoundType)
                    : 'lost',
            );
            setContactTelegram(initial?.entity.payload.contactTelegram ?? '');
            setContactInstagram(initial?.entity.payload.contactInstagram ?? '');
            setContactPhone(initial?.entity.payload.contactPhone ?? '');
            setExpiresAt(initial?.entity.payload.expiresAt?.slice(0, 10) ?? '');
            setFiles([]);
            setSubmitting(false);
        }
    }

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const handlePickFiles = (selected: FileList | null) => {
        if (!selected) return;
        const accepted: File[] = [];
        for (const file of Array.from(selected)) {
            const check = validateAttachmentFile(file);
            if (!check.ok) {
                toast.error(ui.photoTooLarge);
                continue;
            }
            accepted.push(file);
        }
        if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted].slice(0, MAX_PHOTOS));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

    if (!open) return null;

    const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        const details = {
            price: dealType === 'product' || dealType === 'service' ? price.trim() || undefined : undefined,
            condition: dealType === 'product' ? condition.trim() || undefined : undefined,
            location: location.trim() || undefined,
            serviceFormat: dealType === 'service' ? serviceFormat.trim() || undefined : undefined,
            eventAt: category === 'event' || category === 'lost_found' ? eventAt ? new Date(`${eventAt}T00:00:00`).toISOString() : undefined : undefined,
            lostFoundType: category === 'lost_found' ? lostFoundType : undefined,
            contactTelegram: contactTelegram.trim() || undefined,
            contactInstagram: contactInstagram.trim() || undefined,
            contactPhone: contactPhone.trim() || undefined,
            expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
        };

        if (mode === 'edit' && initial) {
            const result = await updateBoardAnnouncement(initial.entity.id, {
                title: title.trim(),
                body: body.trim(),
                category,
                dealType,
                ...details,
            });
            setSubmitting(false);
            if (result.success && result.data) {
                toast.success(ui.updated);
                onSaved(result.data.announcement);
                onClose();
            } else {
                toast.error(result.error || ui.createFailed);
            }
            return;
        }

        const result = await createBoardAnnouncement({ title: title.trim(), body: body.trim(), category, dealType, ...details });
        if (!result.success || !result.data) {
            setSubmitting(false);
            toast.error(result.error || ui.createFailed);
            return;
        }
        let saved = result.data.announcement;
        if (files.length > 0) {
            for (const file of files) {
                try {
                    await uploadAndAttachFile(saved.entity.id, file);
                } catch {
                    // best-effort — the post still stands if a photo fails.
                }
            }
            const refetched = await getBoardAnnouncement(saved.entity.id);
            if (refetched.success && refetched.data) saved = refetched.data.announcement;
        }
        setSubmitting(false);
        toast.success(ui.created);
        onSaved(saved);
        onClose();
    };

    return (
        <div
            className="board-modal-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget && !submitting) onClose();
            }}
            role="presentation"
        >
            <div role="dialog" aria-modal="true" aria-label={mode === 'edit' ? ui.composerEditTitle : ui.composerTitle} className="board-modal">
                <div className="board-modal-header">
                    <span className="board-modal-title">{mode === 'edit' ? ui.composerEditTitle : ui.composerTitle}</span>
                    <button type="button" className="board-modal-close" onClick={onClose} aria-label={ui.cancel}>
                        <X size={20} strokeWidth={2} aria-hidden />
                    </button>
                </div>

                <div className="board-field">
                    <FieldLabel required>{ui.fieldTitle}</FieldLabel>
                    <input
                        type="text"
                        className="board-input"
                        value={title}
                        maxLength={TITLE_MAX}
                        placeholder={ui.fieldTitlePlaceholder}
                        onChange={(event) => setTitle(event.target.value)}
                    />
                </div>

                <div className="board-field">
                    <FieldLabel required>{ui.fieldCategory}</FieldLabel>
                    <div className="board-cat-choose">
                        {BOARD_CATEGORIES.map((key) => (
                            <button
                                key={key}
                                type="button"
                                className="board-cat-choice"
                                data-active={key === category ? 'true' : 'false'}
                                style={{ '--cat': categoryColor(key) } as React.CSSProperties}
                                onClick={() => {
                                    setCategory(key);
                                    setDealType(CATEGORY_DEAL_TYPE[key]);
                                }}
                                aria-pressed={key === category}
                            >
                                {categoryLabel(messages, key)}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="board-field">
                    <FieldLabel required>{ui.fieldBody}</FieldLabel>
                    <textarea
                        className="board-textarea"
                        rows={5}
                        value={body}
                        maxLength={BODY_MAX}
                        placeholder={ui.fieldBodyPlaceholder}
                        onChange={(event) => setBody(event.target.value)}
                    />
                </div>

                {dealType === 'product' ? (
                <div className="board-field-grid">
                    <div className="board-field">
                        <FieldLabel>Цена</FieldLabel>
                        <input
                            type="text"
                            className="board-input"
                            value={price}
                            maxLength={80}
                            placeholder="Например: 5000 ₸ или бесплатно"
                            onChange={(event) => setPrice(event.target.value)}
                        />
                    </div>
                    <div className="board-field">
                        <FieldLabel>Состояние</FieldLabel>
                        <input
                            type="text"
                            className="board-input"
                            value={condition}
                            maxLength={80}
                            placeholder="Новое, б/у, срочно"
                            onChange={(event) => setCondition(event.target.value)}
                        />
                    </div>
                    <div className="board-field">
                        <FieldLabel>Локация</FieldLabel>
                        <input
                            type="text"
                            className="board-input"
                            value={location}
                            maxLength={120}
                            placeholder="Корпус, аудитория, город"
                            onChange={(event) => setLocation(event.target.value)}
                        />
                    </div>
                    <div className="board-field">
                        <FieldLabel>Актуально до</FieldLabel>
                        <input
                            type="date"
                            className="board-input"
                            value={expiresAt}
                            onChange={(event) => setExpiresAt(event.target.value)}
                        />
                    </div>
                </div>
                ) : null}

                {dealType === 'service' ? (
                    <div className="board-field-grid">
                        <div className="board-field">
                            <FieldLabel>Стоимость услуги</FieldLabel>
                            <input
                                type="text"
                                className="board-input"
                                value={price}
                                maxLength={80}
                                placeholder="Например: 2000 ₸ / час или бесплатно"
                                onChange={(event) => setPrice(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Формат услуги</FieldLabel>
                            <input
                                type="text"
                                className="board-input"
                                value={serviceFormat}
                                maxLength={120}
                                placeholder="Онлайн, очно, после пар"
                                onChange={(event) => setServiceFormat(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Где доступно</FieldLabel>
                            <input
                                type="text"
                                className="board-input"
                                value={location}
                                maxLength={120}
                                placeholder="Кампус, город или онлайн"
                                onChange={(event) => setLocation(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Актуально до</FieldLabel>
                            <input
                                type="date"
                                className="board-input"
                                value={expiresAt}
                                onChange={(event) => setExpiresAt(event.target.value)}
                            />
                        </div>
                    </div>
                ) : null}

                {category === 'event' ? (
                    <div className="board-field-grid">
                        <div className="board-field">
                            <FieldLabel>Дата мероприятия</FieldLabel>
                            <input
                                type="date"
                                className="board-input"
                                value={eventAt}
                                onChange={(event) => setEventAt(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Место проведения</FieldLabel>
                            <input
                                type="text"
                                className="board-input"
                                value={location}
                                maxLength={120}
                                placeholder="Корпус, аудитория, онлайн"
                                onChange={(event) => setLocation(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Актуально до</FieldLabel>
                            <input
                                type="date"
                                className="board-input"
                                value={expiresAt}
                                onChange={(event) => setExpiresAt(event.target.value)}
                            />
                        </div>
                    </div>
                ) : null}

                {category === 'lost_found' ? (
                    <div className="board-field-grid">
                        <div className="board-field">
                            <FieldLabel>Что случилось</FieldLabel>
                            <div className="board-cat-choose">
                                {BOARD_LOST_FOUND_TYPES.map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        className="board-cat-choice"
                                        data-active={lostFoundType === key ? 'true' : 'false'}
                                        onClick={() => setLostFoundType(key)}
                                        aria-pressed={lostFoundType === key}
                                    >
                                        {LOST_FOUND_LABEL[key]}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="board-field">
                            <FieldLabel>Где потеряно или найдено</FieldLabel>
                            <input
                                type="text"
                                className="board-input"
                                value={location}
                                maxLength={120}
                                placeholder="Корпус, аудитория, место"
                                onChange={(event) => setLocation(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Когда</FieldLabel>
                            <input
                                type="date"
                                className="board-input"
                                value={eventAt}
                                onChange={(event) => setEventAt(event.target.value)}
                            />
                        </div>
                    </div>
                ) : null}

                {dealType === 'other' && category !== 'event' && category !== 'lost_found' ? (
                    <div className="board-field-grid">
                        <div className="board-field">
                            <FieldLabel>Локация</FieldLabel>
                            <input
                                type="text"
                                className="board-input"
                                value={location}
                                maxLength={120}
                                placeholder="Корпус, аудитория, город"
                                onChange={(event) => setLocation(event.target.value)}
                            />
                        </div>
                        <div className="board-field">
                            <FieldLabel>Актуально до</FieldLabel>
                            <input
                                type="date"
                                className="board-input"
                                value={expiresAt}
                                onChange={(event) => setExpiresAt(event.target.value)}
                            />
                        </div>
                    </div>
                ) : null}

                <div className="board-field-grid">
                    <div className="board-field">
                        <FieldLabel>Telegram</FieldLabel>
                        <input
                            type="text"
                            className="board-input"
                            value={contactTelegram}
                            maxLength={120}
                            placeholder="@username"
                            onChange={(event) => setContactTelegram(event.target.value)}
                        />
                    </div>
                    <div className="board-field">
                        <FieldLabel>Instagram</FieldLabel>
                        <input
                            type="text"
                            className="board-input"
                            value={contactInstagram}
                            maxLength={120}
                            placeholder="@username"
                            onChange={(event) => setContactInstagram(event.target.value)}
                        />
                    </div>
                    <div className="board-field">
                        <FieldLabel>Телефон</FieldLabel>
                        <input
                            type="text"
                            className="board-input"
                            value={contactPhone}
                            maxLength={60}
                            placeholder="+7 ..."
                            onChange={(event) => setContactPhone(event.target.value)}
                        />
                    </div>
                </div>

                {mode === 'create' ? (
                    <div className="board-field">
                        <FieldLabel>{ui.fieldPhotos}</FieldLabel>
                        <div className="board-photos">
                            {previews.map((url, index) => (
                                <div key={url} className="board-photo">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt="" />
                                    <button type="button" className="board-photo-remove" onClick={() => removeFile(index)} aria-label={ui.cancel}>
                                        <X size={12} strokeWidth={2.5} aria-hidden />
                                    </button>
                                </div>
                            ))}
                            {files.length < MAX_PHOTOS ? (
                                <button type="button" className="board-photo-add" onClick={() => fileInputRef.current?.click()} aria-label={ui.addPhoto} title={ui.addPhoto}>
                                    <ImagePlus size={22} strokeWidth={2} aria-hidden />
                                </button>
                            ) : null}
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => handlePickFiles(event.target.files)} />
                    </div>
                ) : initial ? (
                    <div className="board-field">
                        <FieldLabel>{ui.fieldPhotos}</FieldLabel>
                        <AttachmentsList entityId={initial.entity.id} currentUserId={userId ?? ''} enableEdit />
                    </div>
                ) : null}

                <div className="board-modal-actions">
                    <button type="button" className="board-modal-cancel" onClick={onClose} disabled={submitting}>
                        {ui.cancel}
                    </button>
                    <button type="button" className="board-primary-btn" style={{ marginTop: 0 }} onClick={() => void handleSubmit()} disabled={!canSubmit}>
                        {submitting ? ui.submitting : mode === 'edit' ? ui.submitEdit : ui.submit}
                    </button>
                </div>
            </div>
        </div>
    );
}
