/**
 * Tiny formatters for the secondary UMKD file metadata (downloads counter +
 * uploaded date) surfaced by the UMKD parser. Kept here as a local helper so
 * the same logic can be reused by `UMKDFileList` and any future row variant.
 *
 * Both return `null` when there's nothing meaningful to show — the caller
 * decides whether to render a chip / separator.
 */
type Lang = 'ru' | 'kz' | 'en';

const MONTH_NAMES: Record<Lang, readonly string[]> = {
    ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    kz: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export interface UmkdSecondaryMetaLabel {
    /** Short label suitable for inline chips next to file size. */
    label: string;
    /** Full text suitable for the native tooltip on hover. */
    title: string;
}

function parseDownloadsCount(raw: unknown): number | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // KSTU cells sometimes contain trailing text. Pull the first int.
    const match = trimmed.match(/-?\d+/);
    if (!match) return null;
    const n = Number(match[0]);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

export function formatUmkdDownloads(
    raw: string | null | undefined,
    _language: Lang,
): UmkdSecondaryMetaLabel | null {
    void _language; // currently no localization needed — the glyph is universal
    const count = parseDownloadsCount(raw ?? null);
    if (count === null) return null;
    return {
        label: `↓ ${count}`,
        title: `↓ ${count}`,
    };
}

/**
 * Accepts the raw KSTU "uploaded" cell. Common shapes:
 *   - "15.09.2024"
 *   - "15.09.2024 14:30"
 *   - "15.09.24"
 *   - "" / undefined
 *
 * Returns a short localized label (e.g. "15 сен 2024") and the raw original
 * as the tooltip. Returns null when the input is empty or unparseable.
 */
export function formatUmkdUploadedDate(
    raw: string | null | undefined,
    language: Lang,
): UmkdSecondaryMetaLabel | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (!match) {
        // Unrecognized — show raw, but truncated.
        const short = trimmed.length > 16 ? `${trimmed.slice(0, 15)}…` : trimmed;
        return { label: short, title: trimmed };
    }

    const day = Number(match[1]);
    const monthIdx = Number(match[2]) - 1;
    let yearRaw = Number(match[3]);
    if (match[3].length === 2) yearRaw = 2000 + yearRaw;

    if (!Number.isFinite(day) || day < 1 || day > 31) {
        return { label: trimmed, title: trimmed };
    }
    if (monthIdx < 0 || monthIdx > 11) {
        return { label: trimmed, title: trimmed };
    }

    const monthLabel = MONTH_NAMES[language][monthIdx];
    const label = `${day} ${monthLabel} ${yearRaw}`;
    return { label, title: trimmed };
}
