import { describe, it, expect } from 'vitest';
import { toPgSessionDoc } from './platonus.js';

describe('toPgSessionDoc', () => {
    // Row→typed-PlatonusSessionDoc mapper. Wraps timestamps as Date instances
    // and converts the null-or-string `cookie_string` column to `undefined`
    // when null (so callers can use `||` falsy checks). The mapper is the only
    // boundary between Postgres rows and the in-memory session cache — a
    // regression silently corrupts every active Platonus session.

    const makeRow = (overrides: Partial<Parameters<typeof toPgSessionDoc>[0]> = {}) => ({
        user_id: 'user123',
        platonus_login: 'login_name',
        password_encrypted: 'iv:ct',
        token: 'tok_abc',
        sid: 'sid_xyz',
        cookie_string: 'plt_sid=sid_xyz; XSRF-TOKEN=abc',
        person_id: 'p987',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: new Date('2026-02-01T00:00:00.000Z'),
        ...overrides,
    });

    it('maps a complete row correctly', () => {
        const result = toPgSessionDoc(makeRow());
        expect(result.userId).toBe('user123');
        expect(result.platonusLogin).toBe('login_name');
        expect(result.passwordEncrypted).toBe('iv:ct');
        expect(result.token).toBe('tok_abc');
        expect(result.sid).toBe('sid_xyz');
        expect(result.cookieString).toBe('plt_sid=sid_xyz; XSRF-TOKEN=abc');
        expect(result.personID).toBe('p987');
        expect(result.createdAt).toBeInstanceOf(Date);
        expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('null cookie_string → undefined cookieString (NOT empty string)', () => {
        // Important: parsers use `||` checks like `session.cookieString || \`plt_sid=...\``
        // to fall back to a built cookie string. If null leaked through as "null"
        // string or as empty string, the fallback wouldn't fire and HTTP requests
        // would send a malformed Cookie header.
        const result = toPgSessionDoc(makeRow({ cookie_string: null }));
        expect(result.cookieString).toBe(undefined);
    });

    it('empty cookie_string ("") also → undefined cookieString', () => {
        // The `row.cookie_string || undefined` converts both "" and null to undefined.
        // Defensive — KSTU's API can return empty cookies in some edge cases.
        const result = toPgSessionDoc(makeRow({ cookie_string: '' }));
        expect(result.cookieString).toBe(undefined);
    });

    it('wraps created_at and expires_at as Date instances', () => {
        const createdAt = new Date('2026-05-13T10:00:00.000Z');
        const expiresAt = new Date('2026-05-13T22:00:00.000Z');
        const result = toPgSessionDoc(makeRow({ created_at: createdAt, expires_at: expiresAt }));
        expect(result.createdAt.toISOString()).toBe(createdAt.toISOString());
        expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    });

    it('preserves snake_case→camelCase mapping for all fields', () => {
        // Locks in the field renames: user_id→userId, platonus_login→platonusLogin,
        // password_encrypted→passwordEncrypted, person_id→personID (note: NOT
        // personId — Platonus uses uppercase D in the API JSON, and we preserve it).
        // A regression renaming personID → personId would silently fail to match
        // existing in-memory session caches.
        const result = toPgSessionDoc(makeRow({ person_id: 'P987-test' }));
        expect(result.personID).toBe('P987-test');
        // No personId field — only personID.
        expect((result as unknown as { personId?: string }).personId).toBe(undefined);
    });
});
