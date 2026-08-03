import { describe, it, expect, beforeEach, vi } from 'vitest';

// The fetch path is network + DB coupled. Stub axios / DNS / Postgres so the
// redirect-validation tests below run offline and deterministically. The pure
// helper suites in this file don't touch any of the three.
vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));
vi.mock('node:dns', () => ({
    promises: { lookup: vi.fn() },
}));
vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async () => null),
}));

import axios from 'axios';
import { promises as dnsPromises } from 'node:dns';
import {
    extractFirstUrl,
    fetchPreview,
    hashUrl,
    isPrivateOrLoopbackIp,
    normalizeUrl,
    parseOpenGraph,
    resolveRedirectTarget,
    sanitizeImageUrl,
} from './link-previews.js';

describe('normalizeUrl', () => {
    it('returns null for empty / whitespace-only input', () => {
        expect(normalizeUrl('')).toBeNull();
        expect(normalizeUrl('   ')).toBeNull();
    });

    it('returns null for unparseable strings', () => {
        expect(normalizeUrl('not a url')).toBeNull();
        expect(normalizeUrl('//missing-scheme.example/path')).toBeNull();
    });

    it('rejects non-http(s) schemes', () => {
        expect(normalizeUrl('javascript:alert(1)')).toBeNull();
        expect(normalizeUrl('file:///etc/passwd')).toBeNull();
        expect(normalizeUrl('ftp://example.com/foo')).toBeNull();
    });

    it('lowercases the host', () => {
        expect(normalizeUrl('https://Example.COM/Foo')).toBe('https://example.com/Foo');
    });

    it('strips the URL fragment', () => {
        expect(normalizeUrl('https://example.com/post#heading')).toBe('https://example.com/post');
    });

    it('strips the trailing slash on root-path URLs', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    });

    it('preserves the trailing slash on non-root paths', () => {
        expect(normalizeUrl('https://example.com/blog/')).toBe('https://example.com/blog/');
    });

    it('trims leading/trailing whitespace before parsing', () => {
        expect(normalizeUrl('   https://Example.com/   ')).toBe('https://example.com');
    });
});

describe('extractFirstUrl', () => {
    it('returns null when no URL is present', () => {
        expect(extractFirstUrl('no link here')).toBeNull();
        expect(extractFirstUrl('')).toBeNull();
    });

    it('extracts a simple https URL', () => {
        expect(extractFirstUrl('see https://example.com here')).toBe('https://example.com');
    });

    it('extracts only the first URL when multiple are present', () => {
        expect(extractFirstUrl('https://a.com and https://b.com')).toBe('https://a.com');
    });

    it('strips trailing punctuation', () => {
        expect(extractFirstUrl('see https://example.com.')).toBe('https://example.com');
        expect(extractFirstUrl('see https://example.com/path,')).toBe('https://example.com/path');
        expect(extractFirstUrl('(https://example.com)')).toBe('https://example.com');
    });

    it('returns http URLs too, not only https', () => {
        expect(extractFirstUrl('go to http://example.com now')).toBe('http://example.com');
    });

    it('handles URLs with query strings + paths', () => {
        expect(extractFirstUrl('check https://example.com/a/b?x=1&y=2')).toBe(
            'https://example.com/a/b?x=1&y=2',
        );
    });

    it('ignores non-http schemes', () => {
        expect(extractFirstUrl('ftp://example.com')).toBeNull();
    });
});

describe('hashUrl', () => {
    it('returns a stable sha256 hex digest', () => {
        const a = hashUrl('https://example.com');
        const b = hashUrl('https://example.com');
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different URLs', () => {
        expect(hashUrl('https://a.com')).not.toBe(hashUrl('https://b.com'));
    });
});

describe('isPrivateOrLoopbackIp', () => {
    it('rejects empty / non-IP strings', () => {
        expect(isPrivateOrLoopbackIp('')).toBe(true);
        expect(isPrivateOrLoopbackIp('not.an.ip')).toBe(true);
    });

    it('detects IPv4 loopback', () => {
        expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('127.255.0.1')).toBe(true);
    });

    it('detects RFC1918 private ranges', () => {
        expect(isPrivateOrLoopbackIp('10.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('172.16.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('172.31.255.255')).toBe(true);
        expect(isPrivateOrLoopbackIp('192.168.1.1')).toBe(true);
    });

    it('detects link-local (169.254/16)', () => {
        expect(isPrivateOrLoopbackIp('169.254.1.1')).toBe(true);
    });

    it('detects 0.0.0.0/8 and multicast/reserved', () => {
        expect(isPrivateOrLoopbackIp('0.0.0.0')).toBe(true);
        expect(isPrivateOrLoopbackIp('224.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('255.255.255.255')).toBe(true);
    });

    it('allows public IPv4 addresses', () => {
        expect(isPrivateOrLoopbackIp('8.8.8.8')).toBe(false);
        expect(isPrivateOrLoopbackIp('1.1.1.1')).toBe(false);
        expect(isPrivateOrLoopbackIp('172.32.0.1')).toBe(false);
    });

    it('detects IPv6 loopback / unspecified', () => {
        expect(isPrivateOrLoopbackIp('::1')).toBe(true);
        expect(isPrivateOrLoopbackIp('::')).toBe(true);
    });

    it('detects IPv6 ULA + link-local + multicast', () => {
        expect(isPrivateOrLoopbackIp('fc00::1')).toBe(true);
        expect(isPrivateOrLoopbackIp('fd12::1')).toBe(true);
        expect(isPrivateOrLoopbackIp('fe80::1')).toBe(true);
        expect(isPrivateOrLoopbackIp('ff02::1')).toBe(true);
    });

    it('detects IPv4-mapped IPv6 representations of private IPs', () => {
        expect(isPrivateOrLoopbackIp('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('::ffff:192.168.0.1')).toBe(true);
    });

    it('allows public IPv6 addresses', () => {
        expect(isPrivateOrLoopbackIp('2606:4700:4700::1111')).toBe(false);
        expect(isPrivateOrLoopbackIp('2001:4860:4860::8888')).toBe(false);
    });
});

describe('parseOpenGraph', () => {
    it('returns an empty object for empty / non-string input', () => {
        expect(parseOpenGraph('')).toEqual({});
    });

    it('extracts og:title / og:description / og:image / og:site_name', () => {
        const html = `<head>
            <meta property="og:title" content="Title Here">
            <meta property="og:description" content="A description.">
            <meta property="og:image" content="https://example.com/img.png">
            <meta property="og:site_name" content="Example">
        </head>`;
        const meta = parseOpenGraph(html);
        expect(meta.title).toBe('Title Here');
        expect(meta.description).toBe('A description.');
        expect(meta.imageUrl).toBe('https://example.com/img.png');
        expect(meta.siteName).toBe('Example');
    });

    it('accepts name= form alongside property=', () => {
        const html = `<head><meta name="og:title" content="Alt">`;
        expect(parseOpenGraph(html).title).toBe('Alt');
    });

    it('falls back to <title> when og:title is absent', () => {
        const html = `<head><title>Fallback Title</title></head>`;
        expect(parseOpenGraph(html).title).toBe('Fallback Title');
    });

    it('falls back to meta description', () => {
        const html = `<head><meta name="description" content="Plain meta desc"></head>`;
        expect(parseOpenGraph(html).description).toBe('Plain meta desc');
    });

    it('prefers og:description over plain meta description', () => {
        const html = `<head>
            <meta property="og:description" content="OG wins">
            <meta name="description" content="Loses">
        </head>`;
        expect(parseOpenGraph(html).description).toBe('OG wins');
    });

    it('decodes basic HTML entities in attribute values', () => {
        const html = `<head><meta property="og:title" content="Hello &amp; goodbye"></head>`;
        expect(parseOpenGraph(html).title).toBe('Hello & goodbye');
    });

    it('caps overly long titles', () => {
        const long = 'x'.repeat(1000);
        const html = `<head><meta property="og:title" content="${long}"></head>`;
        const meta = parseOpenGraph(html);
        expect(meta.title?.length).toBeLessThanOrEqual(300);
    });

    it('returns empty when no metadata can be extracted', () => {
        const html = `<head><meta name="viewport" content="width=device-width"></head>`;
        const meta = parseOpenGraph(html);
        expect(meta.title).toBeUndefined();
        expect(meta.description).toBeUndefined();
    });

    it('accepts twitter:* fallbacks when og:* is missing', () => {
        const html = `<head>
            <meta name="twitter:title" content="Tweet Title">
            <meta name="twitter:image" content="https://example.com/t.png">
        </head>`;
        const meta = parseOpenGraph(html);
        expect(meta.title).toBe('Tweet Title');
        expect(meta.imageUrl).toBe('https://example.com/t.png');
    });
});

describe('sanitizeImageUrl', () => {
    // og:image is forwarded to the client and rendered as an <img src>, so it
    // gets the same http(s)-only allowlist normalizeUrl applies to og:url.

    it('keeps absolute http/https URLs verbatim', () => {
        expect(sanitizeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
        expect(sanitizeImageUrl('http://example.com/a.png')).toBe('http://example.com/a.png');
    });

    it('trims surrounding whitespace before validating', () => {
        expect(sanitizeImageUrl('  https://example.com/a.png  ')).toBe('https://example.com/a.png');
    });

    it('drops non-http(s) schemes', () => {
        expect(sanitizeImageUrl('javascript:alert(1)')).toBeNull();
        expect(sanitizeImageUrl('data:image/png;base64,AAAA')).toBeNull();
        expect(sanitizeImageUrl('file:///etc/passwd')).toBeNull();
    });

    it('drops relative and protocol-relative references (no base URL to resolve against)', () => {
        expect(sanitizeImageUrl('/img/a.png')).toBeNull();
        expect(sanitizeImageUrl('//cdn.example.com/a.png')).toBeNull();
    });

    it('drops empty / non-string input', () => {
        expect(sanitizeImageUrl('')).toBeNull();
        expect(sanitizeImageUrl('   ')).toBeNull();
        expect(sanitizeImageUrl(null)).toBeNull();
        expect(sanitizeImageUrl(undefined)).toBeNull();
    });

    it('parseOpenGraph drops a javascript: og:image instead of forwarding it', () => {
        const html = `<head>
            <meta property="og:title" content="T">
            <meta property="og:image" content="javascript:alert(1)">
        </head>`;
        const meta = parseOpenGraph(html);
        expect(meta.title).toBe('T');
        expect(meta.imageUrl).toBeNull();
    });
});

describe('resolveRedirectTarget', () => {
    it('resolves an absolute Location header', () => {
        expect(resolveRedirectTarget('https://b.example/x', 'https://a.example/start'))
            .toBe('https://b.example/x');
    });

    it('resolves a relative Location against the current URL', () => {
        expect(resolveRedirectTarget('/next', 'https://a.example/deep/start'))
            .toBe('https://a.example/next');
    });

    it('returns null for a missing / unusable Location', () => {
        expect(resolveRedirectTarget(undefined, 'https://a.example/')).toBeNull();
        expect(resolveRedirectTarget('', 'https://a.example/')).toBeNull();
        expect(resolveRedirectTarget(42, 'https://a.example/')).toBeNull();
    });
});

describe('fetchPreview — redirect hops are re-validated', () => {
    // The SSRF gate used to run only on the URL the user submitted; axios then
    // followed up to 3 redirects internally, so hops 2..4 were never checked.
    // A public host answering `302 Location: http://169.254.169.254/...` reached
    // internal infrastructure. Every hop now re-runs the scheme + DNS + IP gate.

    const PUBLIC_IP = '93.184.216.34';
    const axiosGet = vi.mocked(axios.get);
    const dnsLookup = dnsPromises.lookup as unknown as {
        mockReset: () => void;
        mockResolvedValue: (value: unknown) => void;
        mockResolvedValueOnce: (value: unknown) => void;
    };

    function htmlResponse(body: string) {
        return {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            data: body,
        };
    }

    function redirectResponse(location: string) {
        return { status: 302, headers: { location }, data: '' };
    }

    beforeEach(() => {
        axiosGet.mockReset();
        dnsLookup.mockReset();
        // Every hostname resolves to a public address unless a test says otherwise.
        dnsLookup.mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
    });

    it('blocks a redirect to a link-local (cloud metadata) address', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('http://169.254.169.254/latest/meta-data/'));

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('blocked');
        // Only the first hop was ever issued; the metadata address was never dialed.
        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(axiosGet.mock.calls[0][0]).toBe('https://public.example/start');
    });

    it('blocks a redirect to a loopback address', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('http://127.0.0.1:6379/'));

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('blocked');
        expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    it('blocks a redirect to a private RFC1918 address', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('http://10.0.0.5/admin'));

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('blocked');
    });

    it('blocks a redirect to a hostname that resolves into a private range', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('https://internal.example/x'));
        dnsLookup.mockResolvedValueOnce([{ address: PUBLIC_IP, family: 4 }]);
        dnsLookup.mockResolvedValueOnce([{ address: '192.168.1.10', family: 4 }]);

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('blocked');
        expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    it('blocks a redirect that switches to a non-http(s) scheme', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('file:///etc/passwd'));

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('blocked');
    });

    it('never hands redirect-following to axios (maxRedirects is 0 on every hop)', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('https://other.example/next'));
        axiosGet.mockResolvedValueOnce(htmlResponse('<head><title>Landed</title></head>'));

        await fetchPreview('https://public.example/start');

        for (const call of axiosGet.mock.calls) {
            expect((call[1] as { maxRedirects: number }).maxRedirects).toBe(0);
        }
    });

    it('pins the validated IP into the connection agents (closes the DNS-rebind window)', async () => {
        axiosGet.mockResolvedValueOnce(htmlResponse('<head><title>T</title></head>'));

        await fetchPreview('https://public.example/start');

        const config = axiosGet.mock.calls[0][1] as { httpAgent?: unknown; httpsAgent?: unknown };
        expect(config.httpAgent).toBeDefined();
        expect(config.httpsAgent).toBeDefined();
    });

    it('follows a redirect to another public host and parses the final document', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('https://other.example/final'));
        axiosGet.mockResolvedValueOnce(htmlResponse(
            '<head><meta property="og:title" content="Final Page"></head>',
        ));

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('ok');
        expect(preview.title).toBe('Final Page');
        expect(axiosGet).toHaveBeenCalledTimes(2);
        expect(axiosGet.mock.calls[1][0]).toBe('https://other.example/final');
    });

    it('resolves a relative Location against the hop that produced it', async () => {
        axiosGet.mockResolvedValueOnce(redirectResponse('/moved'));
        axiosGet.mockResolvedValueOnce(htmlResponse('<head><title>Moved</title></head>'));

        const preview = await fetchPreview('https://public.example/deep/start');

        expect(preview.status).toBe('ok');
        expect(axiosGet.mock.calls[1][0]).toBe('https://public.example/moved');
    });

    it('gives up once the redirect budget is spent (4 requests max, then failed)', async () => {
        axiosGet.mockResolvedValue(redirectResponse('https://public.example/loop'));

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('failed');
        expect(axiosGet).toHaveBeenCalledTimes(4); // initial + LINK_PREVIEW_MAX_REDIRECTS
    });

    it('a 3xx with no Location header is a failure, not a hang', async () => {
        axiosGet.mockResolvedValueOnce({ status: 302, headers: {}, data: '' });

        const preview = await fetchPreview('https://public.example/start');

        expect(preview.status).toBe('failed');
    });

    it('still blocks the very first hop when the submitted host is private', async () => {
        const preview = await fetchPreview('http://127.0.0.1/admin');

        expect(preview.status).toBe('blocked');
        expect(axiosGet).not.toHaveBeenCalled();
    });
});
