import { describe, it, expect } from 'vitest';
import {
    buildLightboxItems,
    findImageIndex,
    isImageMime,
    type LightboxItem,
} from './lightbox-helpers';
import type { SocialAttachment } from '@/lib/api/social';

function makeAttachment(overrides: Partial<SocialAttachment>): SocialAttachment {
    const base: SocialAttachment = {
        id: 'att-id',
        entityId: 'entity-1',
        fileId: 'file-id',
        mime: null,
        sizeBytes: null,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00Z',
        filename: null,
    };
    // `Object.assign` preserves explicit `undefined` overrides (unlike `??`)
    // so tests can simulate a missing `fileId` via `{ fileId: undefined }`.
    return Object.assign(base, overrides);
}

describe('isImageMime', () => {
    it('returns true for renderable raster image MIME types', () => {
        expect(isImageMime('image/jpeg')).toBe(true);
        expect(isImageMime('image/jpg')).toBe(true);
        expect(isImageMime('image/png')).toBe(true);
        expect(isImageMime('image/gif')).toBe(true);
        expect(isImageMime('image/webp')).toBe(true);
        expect(isImageMime('image/avif')).toBe(true);
    });

    it('is case-insensitive and tolerates surrounding whitespace', () => {
        expect(isImageMime('IMAGE/PNG')).toBe(true);
        expect(isImageMime('  image/JPEG  ')).toBe(true);
    });

    it('returns false for SVG (excluded by design) and non-image MIMEs', () => {
        expect(isImageMime('image/svg+xml')).toBe(false);
        expect(isImageMime('application/pdf')).toBe(false);
        expect(isImageMime('video/mp4')).toBe(false);
        expect(isImageMime('text/plain')).toBe(false);
    });

    it('returns false for missing, empty or invalid MIME values', () => {
        expect(isImageMime(null)).toBe(false);
        expect(isImageMime(undefined)).toBe(false);
        expect(isImageMime('')).toBe(false);
        expect(isImageMime('   ')).toBe(false);
    });
});

describe('buildLightboxItems', () => {
    const API = 'https://api.example.test';

    it('filters out non-image rows and preserves input order for images', () => {
        const input: SocialAttachment[] = [
            makeAttachment({ id: 'a1', fileId: 'f1', mime: 'image/png', sortOrder: 0 }),
            makeAttachment({ id: 'a2', fileId: 'f2', mime: 'application/pdf', sortOrder: 1 }),
            makeAttachment({ id: 'a3', fileId: 'f3', mime: 'image/jpeg', sortOrder: 2 }),
            makeAttachment({ id: 'a4', fileId: 'f4', mime: 'image/svg+xml', sortOrder: 3 }),
            makeAttachment({ id: 'a5', fileId: 'f5', mime: 'image/webp', sortOrder: 4 }),
        ];
        const items = buildLightboxItems(input, API);
        expect(items.map((it) => it.attachmentId)).toEqual(['a1', 'a3', 'a5']);
        expect(items.map((it) => it.fileId)).toEqual(['f1', 'f3', 'f5']);
    });

    it('returns an empty array when there are no images', () => {
        const input: SocialAttachment[] = [
            makeAttachment({ id: 'a1', mime: 'application/pdf', fileId: 'f1' }),
            makeAttachment({ id: 'a2', mime: 'video/mp4', fileId: 'f2' }),
        ];
        expect(buildLightboxItems(input, API)).toEqual([]);
    });

    it('builds a download URL via the file id, URL-encoding the segment', () => {
        const input: SocialAttachment[] = [
            makeAttachment({ id: 'a1', fileId: 'with space/and?weird', mime: 'image/png' }),
        ];
        const [item] = buildLightboxItems(input, API);
        expect(item.downloadUrl).toBe(
            'https://api.example.test/api/v3/files/with%20space%2Fand%3Fweird',
        );
    });

    it('strips a trailing slash from the API base before joining the path', () => {
        const [item] = buildLightboxItems(
            [makeAttachment({ id: 'a1', fileId: 'f1', mime: 'image/png' })],
            'https://api.example.test/',
        );
        expect(item.downloadUrl).toBe('https://api.example.test/api/v3/files/f1');
    });

    it('drops rows whose fileId is missing or empty', () => {
        const input: SocialAttachment[] = [
            makeAttachment({ id: 'a1', fileId: '', mime: 'image/png' }),
            makeAttachment({
                id: 'a2',
                // Force an invalid fileId via cast for the missing branch.
                fileId: undefined as unknown as string,
                mime: 'image/png',
            }),
            makeAttachment({ id: 'a3', fileId: 'real', mime: 'image/png' }),
        ];
        const items = buildLightboxItems(input, API);
        expect(items.map((it) => it.attachmentId)).toEqual(['a3']);
    });

    it('snapshots filename, mime (lowercased) and sizeBytes onto the item', () => {
        const [item] = buildLightboxItems(
            [
                makeAttachment({
                    id: 'a1',
                    fileId: 'f1',
                    mime: 'IMAGE/PNG',
                    filename: 'Lecture.png',
                    sizeBytes: 4096,
                }),
            ],
            API,
        );
        expect(item.filename).toBe('Lecture.png');
        expect(item.mime).toBe('image/png');
        expect(item.sizeBytes).toBe(4096);
    });

    it('falls back to null when filename or sizeBytes are missing', () => {
        const [item] = buildLightboxItems(
            [
                makeAttachment({
                    id: 'a1',
                    fileId: 'f1',
                    mime: 'image/png',
                    filename: null,
                    sizeBytes: null,
                }),
            ],
            API,
        );
        expect(item.filename).toBeNull();
        expect(item.sizeBytes).toBeNull();
    });
});

describe('findImageIndex', () => {
    const items: LightboxItem[] = [
        {
            attachmentId: 'a1',
            fileId: 'f1',
            downloadUrl: '/api/v3/files/f1',
            filename: null,
            mime: 'image/png',
            sizeBytes: null,
        },
        {
            attachmentId: 'a2',
            fileId: 'f2',
            downloadUrl: '/api/v3/files/f2',
            filename: null,
            mime: 'image/png',
            sizeBytes: null,
        },
    ];

    it('returns the matching index when the fileId is present', () => {
        expect(findImageIndex(items, 'f1')).toBe(0);
        expect(findImageIndex(items, 'f2')).toBe(1);
    });

    it('returns -1 when the fileId is not in the list', () => {
        expect(findImageIndex(items, 'missing')).toBe(-1);
    });

    it('returns -1 for empty input id and empty list', () => {
        expect(findImageIndex(items, '')).toBe(-1);
        expect(findImageIndex([], 'f1')).toBe(-1);
    });
});
