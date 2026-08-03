import { describe, it, expect } from 'vitest';
import CryptoJS from 'crypto-js';
import { encrypt, decrypt } from './crypto.js';

describe('encrypt / decrypt round-trip', () => {
    it('encrypts and decrypts a basic string', () => {
        const plaintext = 'hello world';
        const ciphertext = encrypt(plaintext);
        expect(ciphertext).not.toBe(plaintext);
        expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('handles unicode (cyrillic, kazakh, emoji)', () => {
        const plaintext = 'Сулейменов Абылай — қайырлы күн 🌞';
        expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });

    it('handles password-like strings with special characters', () => {
        const plaintext = 'P@$$w0rd!#%&*()_+=-{}[]<>?,./';
        expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });

    it('handles short and long inputs', () => {
        expect(decrypt(encrypt('a'))).toBe('a');
        const longInput = 'x'.repeat(10_000);
        expect(decrypt(encrypt(longInput))).toBe(longInput);
    });

    it('handles empty string', () => {
        expect(decrypt(encrypt(''))).toBe('');
    });

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
        const plaintext = 'repeat-me';
        const a = encrypt(plaintext);
        const b = encrypt(plaintext);
        expect(a).not.toBe(b);
        // both still decrypt to the same plaintext
        expect(decrypt(a)).toBe(plaintext);
        expect(decrypt(b)).toBe(plaintext);
    });
});

describe('encrypt output format', () => {
    it('outputs "iv:ciphertext" with hex segments', () => {
        const out = encrypt('test');
        const parts = out.split(':');
        expect(parts.length).toBe(2);
        // IV is 16 bytes → 32 hex chars
        expect(parts[0]).toHaveLength(32);
        expect(parts[0]).toMatch(/^[0-9a-f]+$/);
        // Ciphertext segment is non-empty hex
        expect(parts[1]).toMatch(/^[0-9a-f]+$/);
        expect(parts[1].length).toBeGreaterThan(0);
    });
});

describe('decrypt legacy format', () => {
    it('falls back to CryptoJS for non-colon (base64) ciphertext', () => {
        // The crypto module pulls ENCRYPTION_KEY at import time. In tests, this is the
        // fallback dev key '0123456789abcdef0123456789abcdef' (no env var set).
        const FALLBACK_KEY = '0123456789abcdef0123456789abcdef';
        const plaintext = 'legacy-payload';
        const legacyEncoded = CryptoJS.AES.encrypt(plaintext, FALLBACK_KEY).toString();
        // Sanity: legacy format does not include ':'
        expect(legacyEncoded.includes(':')).toBe(false);
        expect(decrypt(legacyEncoded)).toBe(plaintext);
    });
});

// Note: `decrypt()` of garbage input is intentionally undefined behavior.
// Native path throws an Error, fallback path goes through CryptoJS which may
// throw or return junk depending on payload shape. Callers are expected to
// pass values produced by our own `encrypt()` (or legacy base64 from CryptoJS).
// We don't test that contract — see services/users.ts for how decrypt is wrapped.
