/**
 * Local i18n factory for the universal AttachmentsList component. Same
 * `get*Ui(language)` pattern as `comments-thread-i18n.ts` / `reactions-i18n.ts`.
 *
 * Pure function — no React, no localStorage, no DOM. Tests only need to
 * exercise locale parity.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface AttachmentsListUi {
    /** Section header. */
    heading: string;
    /** Loading copy. */
    loading: string;
    /** Empty-state copy (no attachments yet). */
    empty: string;
    /** Error copy when the initial fetch fails. */
    loadFailed: string;
    /** Label for the "Attach file" button. */
    attachButton: string;
    /** Aria-label for the file input. */
    fileInputLabel: string;
    /** Tooltip / aria-label for the per-row download button. */
    downloadLabel: string;
    /** Tooltip / aria-label for the per-row delete button. */
    deleteLabel: string;
    /** Inline status shown while a file is uploading. */
    uploading: string;
    /** Error copy when an upload/attach fails (generic). */
    uploadFailed: string;
    /** Error copy when the chosen file exceeds the size cap. */
    fileTooLarge: string;
    /** Error copy when the chosen file's MIME is rejected. */
    invalidMime: string;
    /** Format a byte count as a human-readable size. */
    formatSize: (bytes: number) => string;
}

function humanFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIdx = 0;
    while (value >= 1024 && unitIdx < units.length - 1) {
        value /= 1024;
        unitIdx += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIdx]}`;
}

/**
 * Pure helper: collapse a MIME type into a short, language-neutral label that
 * the UI can display when the upload filename is unknown. Returns "File" when
 * the MIME is missing or unrecognised so the chip never shows a raw
 * "application/pdf" surrogate.
 *
 * Examples:
 *   formatMimeFallback('application/pdf')              → 'PDF'
 *   formatMimeFallback('image/jpeg')                   → 'Image'
 *   formatMimeFallback('image/png')                    → 'Image'
 *   formatMimeFallback('video/mp4')                    → 'Video'
 *   formatMimeFallback('audio/mpeg')                   → 'Audio'
 *   formatMimeFallback('text/plain')                   → 'Text'
 *   formatMimeFallback('application/zip')              → 'Archive'
 *   formatMimeFallback('application/msword')           → 'Document'
 *   formatMimeFallback('application/vnd.ms-excel')     → 'Spreadsheet'
 *   formatMimeFallback('application/vnd.ms-powerpoint')→ 'Presentation'
 *   formatMimeFallback(null)                           → 'File'
 *   formatMimeFallback('')                             → 'File'
 *   formatMimeFallback('application/octet-stream')     → 'File'
 */
export function formatMimeFallback(mime: string | null | undefined): string {
    if (typeof mime !== 'string') return 'File';
    const value = mime.trim().toLowerCase();
    if (!value) return 'File';

    if (value === 'application/pdf') return 'PDF';
    if (value.startsWith('image/')) return 'Image';
    if (value.startsWith('video/')) return 'Video';
    if (value.startsWith('audio/')) return 'Audio';
    if (value === 'text/plain' || value === 'text/csv') return 'Text';
    if (value === 'application/zip'
        || value === 'application/x-rar-compressed'
        || value === 'application/x-7z-compressed'
        || value === 'application/x-tar'
        || value === 'application/gzip') {
        return 'Archive';
    }
    if (value === 'application/msword'
        || value.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml')) {
        return 'Document';
    }
    if (value === 'application/vnd.ms-excel'
        || value.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml')) {
        return 'Spreadsheet';
    }
    if (value === 'application/vnd.ms-powerpoint'
        || value.startsWith('application/vnd.openxmlformats-officedocument.presentationml')) {
        return 'Presentation';
    }

    return 'File';
}

export function getAttachmentsUi(language: Lang): AttachmentsListUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        heading: isRu ? 'Вложения' : isKz ? 'Тіркемелер' : 'Attachments',
        loading: isRu ? 'Загрузка вложений…' : isKz ? 'Тіркемелер жүктелуде…' : 'Loading attachments…',
        empty: isRu ? 'Пока нет вложений.' : isKz ? 'Әзірге тіркеме жоқ.' : 'No attachments yet.',
        loadFailed: isRu
            ? 'Не удалось загрузить вложения'
            : isKz
                ? 'Тіркемелерді жүктеу мүмкін болмады'
                : 'Failed to load attachments',
        attachButton: isRu ? 'Прикрепить файл' : isKz ? 'Файл тіркеу' : 'Attach file',
        fileInputLabel: isRu ? 'Выбрать файл' : isKz ? 'Файл таңдау' : 'Choose file',
        downloadLabel: isRu ? 'Скачать' : isKz ? 'Жүктеп алу' : 'Download',
        deleteLabel: isRu ? 'Удалить вложение' : isKz ? 'Тіркемені жою' : 'Remove attachment',
        uploading: isRu ? 'Загрузка…' : isKz ? 'Жүктелуде…' : 'Uploading…',
        uploadFailed: isRu
            ? 'Не удалось загрузить файл'
            : isKz
                ? 'Файл жүктелмеді'
                : 'Failed to upload the file',
        fileTooLarge: isRu
            ? 'Файл слишком большой (максимум 25 МБ)'
            : isKz
                ? 'Файл тым үлкен (максимум 25 МБ)'
                : 'File is too large (maximum 25 MB)',
        invalidMime: isRu
            ? 'Этот тип файла не поддерживается'
            : isKz
                ? 'Бұл файл түрі қолдау көрсетілмейді'
                : 'This file type is not supported',
        formatSize: humanFileSize,
    };
}
