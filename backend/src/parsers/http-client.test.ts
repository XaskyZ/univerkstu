import { describe, it, expect } from 'vitest';
import { formatCookies, parseCookies, isLoggedIn, encodeFormBody } from './http-client.js';
import type { KSTUCookies } from './http-client.js';

describe('formatCookies', () => {
    // Builds the value for the `Cookie:` request header from a KSTUCookies object.
    // Empty/falsy values are skipped — important because user_login is optional and
    // sending `user_login=` would interfere with KSTU's session resolution.

    it('formats all three cookies when present', () => {
        const cookies: KSTUCookies = {
            '.ASPXAUTH': 'AUTHTOKEN',
            'ASP.NET_SessionId': 'SESSIONID',
            'user_login': 'student@kstu.kz',
        };
        const result = formatCookies(cookies);
        expect(result).toContain('.ASPXAUTH=AUTHTOKEN');
        expect(result).toContain('ASP.NET_SessionId=SESSIONID');
        expect(result).toContain('user_login=student@kstu.kz');
        // Joined with "; "
        expect(result.split('; ')).toHaveLength(3);
    });

    it('skips entries with empty string value', () => {
        const cookies = {
            '.ASPXAUTH': 'AUTHTOKEN',
            'ASP.NET_SessionId': 'SESSIONID',
            'user_login': '',
        } as KSTUCookies;
        const result = formatCookies(cookies);
        expect(result).not.toContain('user_login=');
        expect(result.split('; ')).toHaveLength(2);
    });

    it('skips entries with undefined value (optional user_login omitted)', () => {
        const cookies = {
            '.ASPXAUTH': 'AUTHTOKEN',
            'ASP.NET_SessionId': 'SESSIONID',
        } as KSTUCookies;
        const result = formatCookies(cookies);
        expect(result).not.toContain('user_login');
        expect(result.split('; ')).toHaveLength(2);
    });

    it('preserves special characters in values verbatim', () => {
        const cookies = {
            '.ASPXAUTH': 'A+B/C=D==',
            'ASP.NET_SessionId': 'abc123',
        } as KSTUCookies;
        const result = formatCookies(cookies);
        expect(result).toContain('.ASPXAUTH=A+B/C=D==');
    });
});

describe('parseCookies', () => {
    // Whitelist parser — only extracts the 3 KSTU-relevant cookies from a Set-Cookie
    // header array. Defense in depth: other cookies (XSRF, GA, etc.) MUST NOT leak
    // into the KSTUCookies object.

    it('returns empty object for undefined input', () => {
        expect(parseCookies(undefined)).toEqual({});
    });

    it('returns empty object for empty array', () => {
        expect(parseCookies([])).toEqual({});
    });

    it('extracts .ASPXAUTH cookie', () => {
        const result = parseCookies(['.ASPXAUTH=AUTHTOKEN; path=/; HttpOnly']);
        expect(result['.ASPXAUTH']).toBe('AUTHTOKEN');
    });

    it('extracts ASP.NET_SessionId cookie', () => {
        const result = parseCookies(['ASP.NET_SessionId=SESSIONID; path=/']);
        expect(result['ASP.NET_SessionId']).toBe('SESSIONID');
    });

    it('extracts user_login cookie', () => {
        const result = parseCookies(['user_login=student%40kstu.kz; expires=...; path=/']);
        expect(result['user_login']).toBe('student%40kstu.kz');
    });

    it('extracts multiple cookies from one Set-Cookie array', () => {
        const result = parseCookies([
            '.ASPXAUTH=AUTH1; path=/',
            'ASP.NET_SessionId=SESS1; path=/',
            'user_login=user1; path=/',
        ]);
        expect(result).toEqual({
            '.ASPXAUTH': 'AUTH1',
            'ASP.NET_SessionId': 'SESS1',
            'user_login': 'user1',
        });
    });

    it('IGNORES cookies that are not in the KSTU whitelist (security guard)', () => {
        // Other cookies (XSRF, GA, advertising) must be silently dropped to prevent
        // them from polluting the KSTUCookies object passed to downstream parsers.
        const result = parseCookies([
            '__RequestVerificationToken=XXX; path=/',
            '_ga=GA1.2.123.456; path=/',
            '.ASPXAUTH=AUTH; path=/',
            '__cf_bm=anti_bot; path=/',
        ]);
        expect(result).toEqual({ '.ASPXAUTH': 'AUTH' });
    });

    it('handles cookies with no attributes (no semicolon)', () => {
        const result = parseCookies(['.ASPXAUTH=AUTHTOKEN']);
        expect(result['.ASPXAUTH']).toBe('AUTHTOKEN');
    });

    it('strips trailing attributes after first semicolon', () => {
        const result = parseCookies(['.ASPXAUTH=AUTHTOKEN; path=/; secure; HttpOnly; SameSite=Lax']);
        expect(result['.ASPXAUTH']).toBe('AUTHTOKEN');
    });

    it('skips malformed Set-Cookie entries (no equals sign)', () => {
        const result = parseCookies(['malformed_no_equals_sign']);
        expect(result).toEqual({});
    });

    it('later occurrence of same cookie overwrites earlier (last-write-wins)', () => {
        const result = parseCookies([
            '.ASPXAUTH=FIRST; path=/',
            '.ASPXAUTH=SECOND; path=/',
        ]);
        expect(result['.ASPXAUTH']).toBe('SECOND');
    });
});

describe('isLoggedIn', () => {
    // Heuristic: returns false if any of three login-page markers appear in the HTML.
    // Used by the auth-refresh code path to decide whether a re-login is needed.
    // A regression that flips this to "always true" would cause silent auth failures
    // (parsers would proceed against logged-out HTML and produce empty data).

    it('returns true for HTML that has none of the three login markers', () => {
        expect(isLoggedIn('<html><body>Расписание занятий</body></html>')).toBe(true);
        expect(isLoggedIn('')).toBe(true); // technically: no markers means "logged in"
    });

    it('returns false when "login_form" appears anywhere', () => {
        expect(isLoggedIn('<form id="login_form">...</form>')).toBe(false);
        expect(isLoggedIn('<div class="login_form-container">...</div>')).toBe(false);
    });

    it('returns false when login action URL appears', () => {
        expect(isLoggedIn('<form action="/user/login">...</form>')).toBe(false);
    });

    it('returns false when Russian login title appears', () => {
        expect(isLoggedIn('<h1>Вход в систему</h1>')).toBe(false);
        // Any context — the substring check is the whole heuristic.
        expect(isLoggedIn('<title>Вход в систему - KSTU</title>')).toBe(false);
    });

    it('returns false when any single marker is present (logical OR)', () => {
        // Each marker independently flips the result to false. Documents that all
        // three are independent signals; any one is sufficient to flag "logged out".
        expect(isLoggedIn('only login_form')).toBe(false);
        expect(isLoggedIn('only action="/user/login"')).toBe(false);
        expect(isLoggedIn('only Вход в систему')).toBe(false);
    });

    it('substring match — partial overlap counts', () => {
        // Documents that the check is naive .includes. Could false-positive on
        // pages that legitimately discuss authentication flows (e.g., a help page
        // mentioning "Вход в систему"). Trade-off accepted: false-positives just
        // trigger a re-login, which is a minor inconvenience, not a security issue.
        expect(isLoggedIn('Чтобы выполнить Вход в систему, нажмите кнопку.')).toBe(false);
    });

    it('is case-sensitive on Cyrillic marker', () => {
        // Documents the current contract — Cyrillic uppercase variant is NOT matched.
        // KSTU consistently uses the canonical "Вход в систему" form.
        expect(isLoggedIn('ВХОД В СИСТЕМУ')).toBe(true); // would slip past, but KSTU never produces this
    });
});

describe('encodeFormBody', () => {
    // Сериализатор тела для POST /user/pass/. Контракт фиксирован: ключи и значения
    // url-encoded, разделитель `&`. KSTU принимает только `application/x-www-form-urlencoded`.

    it('builds the exact set of fields KSTU expects for password change', () => {
        const body = encodeFormBody({
            pass1: 'newSecret',
            pass2: 'newSecret',
            oldpass: 'oldSecret',
            makechangepass: '1',
        });
        // All four required fields are present.
        expect(body).toContain('pass1=newSecret');
        expect(body).toContain('pass2=newSecret');
        expect(body).toContain('oldpass=oldSecret');
        expect(body).toContain('makechangepass=1');
        // Exactly 4 segments joined by `&` — no extra/missing fields.
        expect(body.split('&')).toHaveLength(4);
    });

    it('url-encodes special characters in values', () => {
        const body = encodeFormBody({
            pass1: 'a&b=c d',
        });
        // `&`, `=`, space must be escaped so the body parses correctly on KSTU side.
        expect(body).toBe('pass1=a%26b%3Dc%20d');
    });

    it('url-encodes special characters in keys', () => {
        const body = encodeFormBody({ 'weird key': 'v' });
        expect(body).toBe('weird%20key=v');
    });

    it('returns empty string for empty input', () => {
        expect(encodeFormBody({})).toBe('');
    });

    it('preserves field order from input iteration', () => {
        // Documents that order follows Object.entries — important because tests/snapshots
        // depend on it being deterministic.
        const body = encodeFormBody({ a: '1', b: '2', c: '3' });
        expect(body).toBe('a=1&b=2&c=3');
    });
});
