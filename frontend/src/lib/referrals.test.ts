import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    clearPendingReferralCode,
    getPendingReferralCode,
    normalizeReferralCode,
    setPendingReferralCode,
} from './referrals';

describe('normalizeReferralCode', () => {
    it('returns empty for non-strings', () => {
        expect(normalizeReferralCode(undefined)).toBe('');
        expect(normalizeReferralCode(null)).toBe('');
        expect(normalizeReferralCode(42)).toBe('');
        expect(normalizeReferralCode({ value: 'x' })).toBe('');
    });

    it('uppercases lowercase input', () => {
        expect(normalizeReferralCode('abc123')).toBe('ABC123');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeReferralCode('  abc  ')).toBe('ABC');
    });

    it('drops non-alphanumeric characters', () => {
        expect(normalizeReferralCode('AB-C 12_3!@#')).toBe('ABC123');
    });

    it('drops cyrillic / unicode (keeps only A-Z, 0-9)', () => {
        expect(normalizeReferralCode('ABCабв123')).toBe('ABC123');
        expect(normalizeReferralCode('🎉REF123')).toBe('REF123');
    });

    it('caps result to 16 characters', () => {
        expect(normalizeReferralCode('A'.repeat(50))).toHaveLength(16);
    });

    it('returns empty for inputs that strip down to nothing', () => {
        expect(normalizeReferralCode('---!!!')).toBe('');
        expect(normalizeReferralCode('   ')).toBe('');
    });
});

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

describe('pending referral code storage', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('window', { localStorage: storage });
        vi.stubGlobal('localStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns empty string when nothing stored', () => {
        expect(getPendingReferralCode()).toBe('');
    });

    it('set + get round-trip with normalization', () => {
        const stored = setPendingReferralCode('  ref-code 1  ');
        expect(stored).toBe('REFCODE1');
        expect(getPendingReferralCode()).toBe('REFCODE1');
    });

    it('setPendingReferralCode("") removes the key', () => {
        setPendingReferralCode('ABC');
        expect(getPendingReferralCode()).toBe('ABC');
        setPendingReferralCode('');
        expect(getPendingReferralCode()).toBe('');
    });

    it('setPendingReferralCode with garbage that normalizes to "" also removes', () => {
        setPendingReferralCode('ABC');
        setPendingReferralCode('---!!!'); // normalizes to ''
        expect(getPendingReferralCode()).toBe('');
    });

    it('clearPendingReferralCode removes the key explicitly', () => {
        setPendingReferralCode('ABC');
        clearPendingReferralCode();
        expect(getPendingReferralCode()).toBe('');
    });

    it('getPendingReferralCode re-normalizes stored value (defense against tampered storage)', () => {
        // Simulate someone hand-editing the key with weird content
        storage.setItem('app-referral-pending-v1', '  abc-DEF---xyz😀  ');
        expect(getPendingReferralCode()).toBe('ABCDEFXYZ');
    });
});
