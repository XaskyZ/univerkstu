import { describe, it, expect } from 'vitest';
import { formatMimeFallback, getAttachmentsUi } from './attachments-list-i18n';

describe('getAttachmentsUi', () => {
    it('returns Russian strings for "ru"', () => {
        const ui = getAttachmentsUi('ru');
        expect(ui.heading).toBe('Вложения');
        expect(ui.empty).toBe('Пока нет вложений.');
        expect(ui.attachButton).toBe('Прикрепить файл');
        expect(ui.deleteLabel).toBe('Удалить вложение');
        expect(ui.fileTooLarge).toContain('25 МБ');
        expect(ui.formatSize(0)).toBe('0 B');
        expect(ui.formatSize(1023)).toBe('1023 B');
        expect(ui.formatSize(2048)).toBe('2.0 KB');
        expect(ui.formatSize(20 * 1024 * 1024)).toBe('20 MB');
    });

    it('returns Kazakh strings for "kz"', () => {
        const ui = getAttachmentsUi('kz');
        expect(ui.heading).toBe('Тіркемелер');
        expect(ui.empty).toBe('Әзірге тіркеме жоқ.');
        expect(ui.attachButton).toBe('Файл тіркеу');
        expect(ui.deleteLabel).toBe('Тіркемені жою');
        expect(ui.invalidMime).toBe('Бұл файл түрі қолдау көрсетілмейді');
    });

    it('returns English strings for "en"', () => {
        const ui = getAttachmentsUi('en');
        expect(ui.heading).toBe('Attachments');
        expect(ui.empty).toBe('No attachments yet.');
        expect(ui.attachButton).toBe('Attach file');
        expect(ui.deleteLabel).toBe('Remove attachment');
        expect(ui.fileTooLarge).toContain('25 MB');
        expect(ui.formatSize(512)).toBe('512 B');
        expect(ui.formatSize(1500)).toBe('1.5 KB');
    });
});

describe('formatMimeFallback', () => {
    it('collapses application/pdf to "PDF"', () => {
        expect(formatMimeFallback('application/pdf')).toBe('PDF');
    });

    it('collapses every image/* MIME to "Image"', () => {
        expect(formatMimeFallback('image/jpeg')).toBe('Image');
        expect(formatMimeFallback('image/png')).toBe('Image');
        expect(formatMimeFallback('image/webp')).toBe('Image');
        expect(formatMimeFallback('image/gif')).toBe('Image');
        expect(formatMimeFallback('image/svg+xml')).toBe('Image');
    });

    it('collapses video/* and audio/* MIME families', () => {
        expect(formatMimeFallback('video/mp4')).toBe('Video');
        expect(formatMimeFallback('video/quicktime')).toBe('Video');
        expect(formatMimeFallback('audio/mpeg')).toBe('Audio');
        expect(formatMimeFallback('audio/ogg')).toBe('Audio');
    });

    it('maps text/plain and text/csv to "Text"', () => {
        expect(formatMimeFallback('text/plain')).toBe('Text');
        expect(formatMimeFallback('text/csv')).toBe('Text');
    });

    it('maps common archive MIME types to "Archive"', () => {
        expect(formatMimeFallback('application/zip')).toBe('Archive');
        expect(formatMimeFallback('application/x-rar-compressed')).toBe('Archive');
        expect(formatMimeFallback('application/x-7z-compressed')).toBe('Archive');
        expect(formatMimeFallback('application/gzip')).toBe('Archive');
    });

    it('maps Word/Excel/PowerPoint MIMEs to friendly category labels', () => {
        expect(formatMimeFallback('application/msword')).toBe('Document');
        expect(
            formatMimeFallback('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        ).toBe('Document');
        expect(formatMimeFallback('application/vnd.ms-excel')).toBe('Spreadsheet');
        expect(
            formatMimeFallback('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        ).toBe('Spreadsheet');
        expect(formatMimeFallback('application/vnd.ms-powerpoint')).toBe('Presentation');
        expect(
            formatMimeFallback('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
        ).toBe('Presentation');
    });

    it('returns "File" for missing, empty or unknown MIME values', () => {
        expect(formatMimeFallback(null)).toBe('File');
        expect(formatMimeFallback(undefined)).toBe('File');
        expect(formatMimeFallback('')).toBe('File');
        expect(formatMimeFallback('   ')).toBe('File');
        expect(formatMimeFallback('application/octet-stream')).toBe('File');
        expect(formatMimeFallback('application/x-unknown-binary')).toBe('File');
    });

    it('is case-insensitive on the MIME input', () => {
        expect(formatMimeFallback('Application/PDF')).toBe('PDF');
        expect(formatMimeFallback('IMAGE/PNG')).toBe('Image');
    });
});
