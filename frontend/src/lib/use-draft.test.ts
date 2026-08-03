/**
 * Unit tests for the pure helpers behind `useDraft`. React hooks are skipped
 * here per project convention (`AGENTS.md`: "skip React hooks in unit
 * tests"). The hook itself is exercised through integration with the chat /
 * comments composers; here we lock down the storage contract so the
 * composer wiring stays correct.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_DRAFT_DEBOUNCE_MS,
    DEFAULT_DRAFT_NAMESPACE,
    buildDraftKey,
    clearDraft,
    readDraft,
    writeDraft,
} from './use-draft';
import { getDraftUi } from './drafts-i18n';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let storageRef: MemoryStorage;

beforeEach(() => {
    storageRef = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storageRef });
    vi.stubGlobal('localStorage', storageRef);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('buildDraftKey', () => {
    it('joins prefix and parts with colon', () => {
        expect(buildDraftKey('dm', 'room-42')).toBe('dm:room-42');
        expect(buildDraftKey('comment-reply', 'cmt-1')).toBe('comment-reply:cmt-1');
        expect(buildDraftKey('global', 'chat')).toBe('global:chat');
    });

    it('supports multiple parts', () => {
        expect(buildDraftKey('feed-create', 'group-1', 'extra')).toBe('feed-create:group-1:extra');
    });

    it('trims whitespace from prefix and parts', () => {
        expect(buildDraftKey('  dm  ', '  room  ')).toBe('dm:room');
    });

    it('substitutes a placeholder for empty parts so scopes do not collide', () => {
        expect(buildDraftKey('feed-create', '')).toBe('feed-create:_');
        expect(buildDraftKey('feed-create', '   ')).toBe('feed-create:_');
    });

    it('substitutes a placeholder for an empty prefix', () => {
        expect(buildDraftKey('', 'room-1')).toBe('_:room-1');
    });

    it('returns a stable key with no parts', () => {
        expect(buildDraftKey('global')).toBe('global');
    });
});

describe('readDraft', () => {
    it('returns null when the key is absent', () => {
        expect(readDraft('dm:r1')).toBeNull();
    });

    it('returns the stored value when present', () => {
        storageRef.setItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`, 'hello');
        expect(readDraft('dm:r1')).toBe('hello');
    });

    it('returns null for empty stored values (defensive)', () => {
        storageRef.setItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`, '');
        expect(readDraft('dm:r1')).toBeNull();
    });

    it('honours a custom namespace', () => {
        storageRef.setItem('custom:dm:r1', 'world');
        expect(readDraft('dm:r1', 'custom:')).toBe('world');
        expect(readDraft('dm:r1')).toBeNull();
    });

    it('returns null when window is undefined (SSR)', () => {
        vi.unstubAllGlobals();
        expect(readDraft('dm:r1')).toBeNull();
    });

    it('returns null when storage access throws', () => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem() { throw new Error('blocked'); },
            },
        });
        expect(readDraft('dm:r1')).toBeNull();
    });
});

describe('writeDraft', () => {
    it('writes the value under the default namespace', () => {
        writeDraft('dm:r1', 'hello');
        expect(storageRef.getItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`)).toBe('hello');
    });

    it('honours a custom namespace', () => {
        writeDraft('dm:r1', 'hello', 'custom:');
        expect(storageRef.getItem('custom:dm:r1')).toBe('hello');
    });

    it('clears the key for empty values', () => {
        storageRef.setItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`, 'old');
        writeDraft('dm:r1', '');
        expect(storageRef.getItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`)).toBeNull();
    });

    it('clears the key for whitespace-only values', () => {
        storageRef.setItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`, 'old');
        writeDraft('dm:r1', '   \n  ');
        expect(storageRef.getItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`)).toBeNull();
    });

    it('is a no-op when window is undefined', () => {
        vi.unstubAllGlobals();
        expect(() => writeDraft('dm:r1', 'hello')).not.toThrow();
    });

    it('swallows storage errors silently', () => {
        vi.stubGlobal('window', {
            localStorage: {
                setItem() { throw new Error('quota'); },
                removeItem() { /* noop */ },
            },
        });
        expect(() => writeDraft('dm:r1', 'hello')).not.toThrow();
    });
});

describe('clearDraft', () => {
    it('removes a stored draft', () => {
        storageRef.setItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`, 'hello');
        clearDraft('dm:r1');
        expect(storageRef.getItem(`${DEFAULT_DRAFT_NAMESPACE}dm:r1`)).toBeNull();
    });

    it('is a no-op when the key is absent', () => {
        expect(() => clearDraft('missing')).not.toThrow();
    });

    it('honours a custom namespace', () => {
        storageRef.setItem('custom:dm:r1', 'hello');
        clearDraft('dm:r1', 'custom:');
        expect(storageRef.getItem('custom:dm:r1')).toBeNull();
    });

    it('is a no-op when window is undefined', () => {
        vi.unstubAllGlobals();
        expect(() => clearDraft('dm:r1')).not.toThrow();
    });

    it('swallows storage errors silently', () => {
        vi.stubGlobal('window', {
            localStorage: {
                removeItem() { throw new Error('blocked'); },
            },
        });
        expect(() => clearDraft('dm:r1')).not.toThrow();
    });
});

describe('round-trip', () => {
    it('write -> read returns the exact value', () => {
        writeDraft('comment-top:e1', 'Privet, mir!');
        expect(readDraft('comment-top:e1')).toBe('Privet, mir!');
    });

    it('write -> clear -> read returns null', () => {
        writeDraft('comment-top:e1', 'Privet, mir!');
        clearDraft('comment-top:e1');
        expect(readDraft('comment-top:e1')).toBeNull();
    });

    it('write multibyte unicode is preserved', () => {
        writeDraft('comment-top:e1', 'Привет, мир! 🌍 السلام');
        expect(readDraft('comment-top:e1')).toBe('Привет, мир! 🌍 السلام');
    });

    it('writes under different keys do not interfere', () => {
        writeDraft('dm:r1', 'A');
        writeDraft('dm:r2', 'B');
        expect(readDraft('dm:r1')).toBe('A');
        expect(readDraft('dm:r2')).toBe('B');
    });

    it('namespaces isolate drafts from each other', () => {
        writeDraft('dm:r1', 'one', 'ns-a:');
        writeDraft('dm:r1', 'two', 'ns-b:');
        expect(readDraft('dm:r1', 'ns-a:')).toBe('one');
        expect(readDraft('dm:r1', 'ns-b:')).toBe('two');
    });

    it('overwrites an existing draft for the same key', () => {
        writeDraft('dm:r1', 'first');
        writeDraft('dm:r1', 'second');
        expect(readDraft('dm:r1')).toBe('second');
    });
});

describe('constants', () => {
    it('exposes a stable default namespace', () => {
        expect(DEFAULT_DRAFT_NAMESPACE).toBe('social-draft:');
    });

    it('exposes a sane default debounce window', () => {
        expect(DEFAULT_DRAFT_DEBOUNCE_MS).toBeGreaterThan(0);
        expect(DEFAULT_DRAFT_DEBOUNCE_MS).toBeLessThanOrEqual(2_000);
    });
});

describe('getDraftUi', () => {
    it('returns the hint string for every supported language', () => {
        for (const lang of ['ru', 'kz', 'en'] as const) {
            const ui = getDraftUi(lang);
            expect(typeof ui.draftRestoredHint).toBe('string');
            expect(ui.draftRestoredHint.length).toBeGreaterThan(0);
        }
    });

    it('strings differ between ru / kz / en (no accidental fallthrough)', () => {
        const ru = getDraftUi('ru').draftRestoredHint;
        const kz = getDraftUi('kz').draftRestoredHint;
        const en = getDraftUi('en').draftRestoredHint;
        expect(ru).not.toBe(en);
        expect(ru).not.toBe(kz);
        expect(kz).not.toBe(en);
    });
});
