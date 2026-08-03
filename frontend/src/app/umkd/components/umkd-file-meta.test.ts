import { describe, it, expect } from 'vitest';
import { formatUmkdDownloads, formatUmkdUploadedDate } from './umkd-file-meta';

describe('formatUmkdDownloads', () => {
    it('returns null for empty/non-numeric values', () => {
        expect(formatUmkdDownloads(null, 'ru')).toBeNull();
        expect(formatUmkdDownloads(undefined, 'ru')).toBeNull();
        expect(formatUmkdDownloads('', 'ru')).toBeNull();
        expect(formatUmkdDownloads('   ', 'ru')).toBeNull();
        expect(formatUmkdDownloads('abc', 'ru')).toBeNull();
    });

    it('formats integer download counts with an arrow glyph', () => {
        expect(formatUmkdDownloads('0', 'ru')?.label).toBe('↓ 0');
        expect(formatUmkdDownloads('5', 'ru')?.label).toBe('↓ 5');
        expect(formatUmkdDownloads('1234', 'en')?.label).toBe('↓ 1234');
    });

    it('extracts the first integer when value has noise around it', () => {
        expect(formatUmkdDownloads('42 раз', 'ru')?.label).toBe('↓ 42');
        expect(formatUmkdDownloads('скачано: 7', 'ru')?.label).toBe('↓ 7');
    });

    it('rejects negative counts', () => {
        // The regex picks up the "-3", but the validator rejects sub-zero values.
        // A surface-level negative count is meaningless for downloads.
        expect(formatUmkdDownloads('-3', 'ru')).toBeNull();
    });
});

describe('formatUmkdUploadedDate', () => {
    it('returns null for empty values', () => {
        expect(formatUmkdUploadedDate(null, 'ru')).toBeNull();
        expect(formatUmkdUploadedDate(undefined, 'ru')).toBeNull();
        expect(formatUmkdUploadedDate('', 'ru')).toBeNull();
        expect(formatUmkdUploadedDate('   ', 'ru')).toBeNull();
    });

    it('formats dd.mm.yyyy with localized short month', () => {
        expect(formatUmkdUploadedDate('15.09.2024', 'ru')?.label).toBe('15 сен 2024');
        expect(formatUmkdUploadedDate('15.09.2024', 'en')?.label).toBe('15 Sep 2024');
        expect(formatUmkdUploadedDate('15.09.2024', 'kz')?.label).toBe('15 қыр 2024');
    });

    it('keeps the original string as tooltip title', () => {
        expect(formatUmkdUploadedDate('15.09.2024 14:30', 'ru')?.title).toBe('15.09.2024 14:30');
    });

    it('expands two-digit year to 20xx', () => {
        expect(formatUmkdUploadedDate('15.09.24', 'ru')?.label).toBe('15 сен 2024');
    });

    it('falls back to raw text for unrecognized shapes', () => {
        const result = formatUmkdUploadedDate('недавно', 'ru');
        expect(result).not.toBeNull();
        expect(result?.title).toBe('недавно');
    });
});
