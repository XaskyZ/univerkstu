function cleanSocialHandle(input: string | null | undefined, service: 'telegram' | 'instagram'): string | null {
    const trimmed = input?.trim();
    if (!trimmed) return null;
    const hostPatterns = service === 'telegram'
        ? ['t.me', 'telegram.me', 'telegram.dog']
        : ['instagram.com'];
    try {
        const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^@/, '')}`;
        const url = new URL(candidate);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        if (hostPatterns.includes(host)) {
            return url.pathname.split('/').filter(Boolean)[0] ?? null;
        }
    } catch {
        // Fall through to plain handle normalization.
    }
    const withoutPrefix = trimmed
        .replace(/^@/, '')
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/^(t\.me|telegram\.me|telegram\.dog|instagram\.com)\//i, '');
    return withoutPrefix.split(/[/?#]/)[0]?.trim() || null;
}

export function buildTelegramHref(input: string | null | undefined): string | null {
    const handle = cleanSocialHandle(input, 'telegram');
    return handle ? `https://t.me/${encodeURIComponent(handle)}` : null;
}

export function buildInstagramHref(input: string | null | undefined): string | null {
    const handle = cleanSocialHandle(input, 'instagram');
    return handle ? `https://instagram.com/${encodeURIComponent(handle)}` : null;
}

export function buildPhoneHref(input: string | null | undefined): string | null {
    const normalized = input?.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '') ?? '';
    return normalized ? `tel:${normalized}` : null;
}
