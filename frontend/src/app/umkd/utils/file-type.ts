/**
 * UMKD file type classification.
 *
 * Maps a MIME type and/or filename to a small enum that the UI uses for
 * filtering by file kind in the UMKD toolbar. The list is intentionally
 * narrow — chips in the toolbar mirror these exact buckets.
 *
 * MIME is the primary signal; the filename extension is a fallback because
 * the backend sometimes serves files without a precise MIME (or with a
 * generic `application/octet-stream`).
 */

export type UmkdFileType = 'pdf' | 'doc' | 'ppt' | 'excel' | 'archive' | 'other';

const MIME_MAP: Record<string, UmkdFileType> = {
    'application/pdf': 'pdf',

    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',

    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt',

    'application/vnd.ms-excel': 'excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',

    'application/zip': 'archive',
    'application/x-rar-compressed': 'archive',
    'application/x-rar': 'archive',
    'application/x-7z-compressed': 'archive',
    'application/x-tar': 'archive',
    'application/gzip': 'archive',
};

const EXT_MAP: Record<string, UmkdFileType> = {
    pdf: 'pdf',

    doc: 'doc',
    docx: 'doc',
    rtf: 'doc',
    odt: 'doc',

    ppt: 'ppt',
    pptx: 'ppt',
    odp: 'ppt',

    xls: 'excel',
    xlsx: 'excel',
    csv: 'excel',
    ods: 'excel',

    zip: 'archive',
    rar: 'archive',
    '7z': 'archive',
    tar: 'archive',
    gz: 'archive',
    tgz: 'archive',
};

function extractExtension(filename: string | undefined | null): string | null {
    if (!filename) return null;
    // Strip query string / fragment if a URL was passed by mistake.
    const cleaned = filename.split(/[?#]/, 1)[0]?.trim();
    if (!cleaned) return null;
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot < 0 || lastDot === cleaned.length - 1) return null;
    return cleaned.slice(lastDot + 1).toLowerCase();
}

/**
 * Classify a UMKD file by its MIME type and/or filename. Returns the matching
 * bucket, or `'other'` when neither signal matches.
 */
export function classifyMime(mime?: string, filename?: string): UmkdFileType {
    const trimmedMime = typeof mime === 'string' ? mime.trim().toLowerCase() : '';
    if (trimmedMime && MIME_MAP[trimmedMime]) {
        return MIME_MAP[trimmedMime];
    }

    const ext = extractExtension(filename);
    if (ext && EXT_MAP[ext]) {
        return EXT_MAP[ext];
    }

    return 'other';
}
