import { describe, it, expect } from 'vitest';
import { ru } from './ru';
import { kz } from './kz';
import { en } from './en';

/**
 * Walks `obj` recursively and returns the set of all leaf paths.
 * Each path is the dotted chain from root to leaf, e.g. `bottomNav.grades`.
 *
 * Treats function-valued entries (like `notifError(details?: string) => string`)
 * as leaf nodes too — their *presence* is what matters for parity.
 */
function collectLeafPaths(obj: unknown, prefix = ''): Set<string> {
    const paths = new Set<string>();
    if (obj === null || obj === undefined) return paths;

    if (typeof obj !== 'object' || Array.isArray(obj) || typeof obj === 'function') {
        if (prefix) paths.add(prefix);
        return paths;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (
            value === null
            || value === undefined
            || typeof value !== 'object'
            || Array.isArray(value)
            || typeof value === 'function'
        ) {
            paths.add(path);
        } else {
            for (const inner of collectLeafPaths(value, path)) paths.add(inner);
        }
    }

    return paths;
}

describe('locale parity (ru / kz / en)', () => {
    const ruPaths = collectLeafPaths(ru);
    const kzPaths = collectLeafPaths(kz);
    const enPaths = collectLeafPaths(en);

    it('all three locales have the same leaf-path set', () => {
        // Missing-in-X arrays explicitly list the gaps for clear failure output —
        // way more useful than `Set` diffing inline.
        const inRuNotKz = [...ruPaths].filter((p) => !kzPaths.has(p)).sort();
        const inRuNotEn = [...ruPaths].filter((p) => !enPaths.has(p)).sort();
        const inKzNotRu = [...kzPaths].filter((p) => !ruPaths.has(p)).sort();
        const inEnNotRu = [...enPaths].filter((p) => !ruPaths.has(p)).sort();

        expect(inRuNotKz, 'paths in ru but missing in kz').toEqual([]);
        expect(inRuNotEn, 'paths in ru but missing in en').toEqual([]);
        expect(inKzNotRu, 'paths in kz but missing in ru').toEqual([]);
        expect(inEnNotRu, 'paths in en but missing in ru').toEqual([]);
    });

    it('every locale has > 200 leaf paths (sanity bound on size)', () => {
        // If someone accidentally truncates a locale to a stub, this catches it.
        expect(ruPaths.size).toBeGreaterThan(200);
        expect(kzPaths.size).toBeGreaterThan(200);
        expect(enPaths.size).toBeGreaterThan(200);
    });

    it('bottomNav has all 6 expected entries in every language', () => {
        const expected = ['grades', 'umkd', 'schedule', 'session', 'profile', 'more'];
        for (const lang of [ru, kz, en]) {
            const nav = lang.bottomNav as Record<string, string>;
            for (const key of expected) {
                expect(nav[key], `bottomNav.${key} missing`).toBeTruthy();
            }
        }
    });

    it('strings at the same path are NOT identical across all 3 languages (catches copy-paste)', () => {
        // Sample a handful of well-known user-visible strings. If RU/KZ/EN all return
        // the same literal, someone probably copy-pasted without translating.
        // Each entry is a dotted path resolved against each locale tree.
        const samplePaths = [
            'bottomNav.grades',
            'bottomNav.schedule',
            'settings.main.title',
            'settings.groups.account',
        ] as const;

        function resolve(obj: unknown, path: string): string {
            return path.split('.').reduce<unknown>((acc, key) => {
                if (acc && typeof acc === 'object') {
                    return (acc as Record<string, unknown>)[key];
                }
                return undefined;
            }, obj) as string;
        }

        for (const path of samplePaths) {
            const ruValue = resolve(ru, path);
            const enValue = resolve(en, path);
            expect(ruValue, `${path} missing in ru`).toBeTruthy();
            expect(enValue, `${path} missing in en`).toBeTruthy();
            // RU vs EN — at minimum these two must differ.
            expect(ruValue, `${path} not translated between ru and en`).not.toBe(enValue);
        }
    });
});
