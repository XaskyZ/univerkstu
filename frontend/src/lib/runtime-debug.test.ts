import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNotificationCapability, getClientDebugEnvironment } from './runtime-debug';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

interface FakeWindow {
    matchMedia: (q: string) => { matches: boolean };
    Notification?: { permission: 'default' | 'granted' | 'denied' };
}

function stubEnvironment(opts: {
    ua: string;
    notificationSupported: boolean;
    standalone: boolean;
}) {
    const fakeWindow: FakeWindow = {
        matchMedia: (query: string) => ({
            matches: query.includes('standalone') && opts.standalone,
        }),
    };
    if (opts.notificationSupported) {
        const notificationStub = { permission: 'default' as const };
        fakeWindow.Notification = notificationStub;
        // Also expose as a bare global — runtime-debug.ts reads `Notification.permission`
        // as an unqualified identifier, which resolves via the global scope in browsers.
        vi.stubGlobal('Notification', notificationStub);
    }

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('navigator', {
        userAgent: opts.ua,
        standalone: opts.standalone,
        onLine: true,
    });
    vi.stubGlobal('document', { visibilityState: 'visible' });
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('getClientDebugEnvironment', () => {
    it('returns {} when window is undefined (SSR context)', () => {
        // Don't stub window — runs in node-like environment, typeof window === 'undefined' →
        // function early-returns {}. This is what gets called during SSR.
        vi.stubGlobal('window', undefined);
        expect(getClientDebugEnvironment()).toEqual({});
    });

    it('captures the full diagnostic envelope shape when window exists', () => {
        stubEnvironment({ ua: DESKTOP_CHROME_UA, notificationSupported: true, standalone: false });
        const env = getClientDebugEnvironment();
        // Lock in every key that downstream traces expect — adding/removing one would
        // ripple through the admin diagnostics dashboard.
        expect(env).toHaveProperty('ua');
        expect(env).toHaveProperty('isIOS');
        expect(env).toHaveProperty('isSafari');
        expect(env).toHaveProperty('isStandalone');
        expect(env).toHaveProperty('visibilityState');
        expect(env).toHaveProperty('notificationSupported');
        expect(env).toHaveProperty('notificationPermission');
        expect(env).toHaveProperty('serviceWorkerSupported');
        expect(env).toHaveProperty('online');
    });

    it('truncates UA to 200 characters', () => {
        // Defense against ridiculously long UA strings (some bots have multi-KB UAs).
        // Locking the 200-char cap.
        const longUa = 'Mozilla/5.0 ' + 'X'.repeat(500);
        stubEnvironment({ ua: longUa, notificationSupported: true, standalone: false });
        const env = getClientDebugEnvironment();
        expect((env.ua as string).length).toBe(200);
    });

    it('detects isIOS=true for iPhone UA', () => {
        stubEnvironment({ ua: IPHONE_UA, notificationSupported: true, standalone: false });
        const env = getClientDebugEnvironment();
        expect(env.isIOS).toBe(true);
    });

    it('detects isIOS=false for Android UA (even though it has "Mobile Safari")', () => {
        stubEnvironment({ ua: ANDROID_UA, notificationSupported: true, standalone: false });
        const env = getClientDebugEnvironment();
        expect(env.isIOS).toBe(false);
    });

    it('detects isSafari=true ONLY for real Safari (rejects Chrome on Mac which also has "Safari")', () => {
        // Real Safari (iPhone or Mac) has Safari in UA, NO Chrome/CriOS/EdgiOS/FxiOS.
        // Chrome-on-Mac has Safari AND Chrome — should NOT match isSafari.
        stubEnvironment({ ua: IPHONE_UA, notificationSupported: true, standalone: false });
        expect(getClientDebugEnvironment().isSafari).toBe(true);

        stubEnvironment({ ua: DESKTOP_CHROME_UA, notificationSupported: true, standalone: false });
        expect(getClientDebugEnvironment().isSafari).toBe(false);
    });

    it('reports notificationPermission "unsupported" when Notification is missing', () => {
        stubEnvironment({ ua: DESKTOP_CHROME_UA, notificationSupported: false, standalone: false });
        const env = getClientDebugEnvironment();
        expect(env.notificationSupported).toBe(false);
        expect(env.notificationPermission).toBe('unsupported');
    });

    it('reports notificationPermission from the Notification global when supported', () => {
        stubEnvironment({ ua: DESKTOP_CHROME_UA, notificationSupported: true, standalone: false });
        const env = getClientDebugEnvironment();
        expect(env.notificationSupported).toBe(true);
        expect(env.notificationPermission).toBe('default');
    });
});

describe('getNotificationCapability', () => {
    it('returns supported=false / reason="unsupported" when Notification API is missing', () => {
        stubEnvironment({ ua: DESKTOP_CHROME_UA, notificationSupported: false, standalone: false });
        const result = getNotificationCapability();
        expect(result.supported).toBe(false);
        expect(result.reason).toBe('unsupported');
        // environment payload still populated for diagnostic logging
        expect(result.environment.notificationSupported).toBe(false);
    });

    it('returns supported=false / reason="ios_pwa_required" for iPhone NOT in standalone mode', () => {
        // This is THE key invariant: iOS Safari technically has the Notification global
        // but accessing it throws unless the page is installed as a PWA. We must
        // pre-empt the permission UI in that case.
        stubEnvironment({ ua: IPHONE_UA, notificationSupported: true, standalone: false });
        const result = getNotificationCapability();
        expect(result.supported).toBe(false);
        expect(result.reason).toBe('ios_pwa_required');
        expect(result.environment.isIOS).toBe(true);
        expect(result.environment.isStandalone).toBe(false);
    });

    it('returns supported=true for iPhone WITH standalone (installed PWA)', () => {
        // Same iPhone UA but `navigator.standalone === true` OR `matchMedia('(display-mode: standalone)')` matches —
        // either signal flips us into "installed PWA" mode where Notification API works.
        stubEnvironment({ ua: IPHONE_UA, notificationSupported: true, standalone: true });
        const result = getNotificationCapability();
        expect(result.supported).toBe(true);
        expect(result.reason).toBe(null);
    });

    it('returns supported=true for desktop Chrome (no iOS gate, Notification exists)', () => {
        stubEnvironment({ ua: DESKTOP_CHROME_UA, notificationSupported: true, standalone: false });
        const result = getNotificationCapability();
        expect(result.supported).toBe(true);
        expect(result.reason).toBe(null);
    });

    it('returns supported=true for Android Chrome (mobile but not iOS — no PWA gate)', () => {
        // Android Chrome supports Notification API in non-PWA mode. Locking that in:
        // the gate only fires for iOS, not all mobile.
        stubEnvironment({ ua: ANDROID_UA, notificationSupported: true, standalone: false });
        const result = getNotificationCapability();
        expect(result.supported).toBe(true);
        expect(result.reason).toBe(null);
        expect(result.environment.isIOS).toBe(false);
    });

    it('"unsupported" trumps "ios_pwa_required" when both would apply', () => {
        // If somehow we're on iOS AND Notification is missing — fall to "unsupported" first
        // because the gate-chain checks notificationSupported BEFORE the iOS guard.
        stubEnvironment({ ua: IPHONE_UA, notificationSupported: false, standalone: false });
        const result = getNotificationCapability();
        expect(result.reason).toBe('unsupported');
    });
});
