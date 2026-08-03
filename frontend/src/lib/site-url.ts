const FALLBACK_SITE_URL = 'https://univerkstu.app';

export function getCanonicalSiteUrl(): string {
  const rawUrl = (process.env.NEXT_PUBLIC_SITE_URL || FALLBACK_SITE_URL).trim();

  try {
    const parsed = new URL(rawUrl);

    if (parsed.hostname === 'www.univerkstu.app') {
      parsed.hostname = 'univerkstu.app';
    }

    parsed.protocol = 'https:';
    parsed.hash = '';
    parsed.search = '';

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return FALLBACK_SITE_URL;
  }
}

