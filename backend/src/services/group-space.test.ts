import { describe, it, expect } from 'vitest';
import {
    normalizeGroupKey,
    normalizeCoordinatorAnnouncementTargetGroups,
    normalizeSearchValue,
    buildUserSearchRegex,
    normalizeOptionalText,
    toDateOrNull,
    buildPermissions,
} from './group-space.js';

describe('normalizeGroupKey', () => {
    it('uppercases', () => {
        expect(normalizeGroupKey('cit-23-1')).toBe('CIT-23-1');
        expect(normalizeGroupKey('abcd')).toBe('ABCD');
    });

    it('collapses internal whitespace', () => {
        expect(normalizeGroupKey('group  with   spaces')).toBe('GROUP WITH SPACES');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeGroupKey('  cit-23  ')).toBe('CIT-23');
        expect(normalizeGroupKey('\tcit-23\n')).toBe('CIT-23');
    });

    it('idempotent: applying twice yields same result', () => {
        const once = normalizeGroupKey('  Cit-23   Foo ');
        expect(normalizeGroupKey(once)).toBe(once);
    });

    it('empty/whitespace-only input → empty string', () => {
        expect(normalizeGroupKey('')).toBe('');
        expect(normalizeGroupKey('   ')).toBe('');
    });

    it('non-ASCII characters survive uppercase (Cyrillic)', () => {
        expect(normalizeGroupKey('ит-23')).toBe('ИТ-23');
    });
});

describe('normalizeCoordinatorAnnouncementTargetGroups', () => {
    it('returns [] on empty input', () => {
        expect(normalizeCoordinatorAnnouncementTargetGroups([])).toEqual([]);
    });

    it('normalizes each entry via normalizeGroupKey', () => {
        expect(normalizeCoordinatorAnnouncementTargetGroups(['cit-23', '  cit-24  '])).toEqual(['CIT-23', 'CIT-24']);
    });

    it('drops empty/whitespace-only entries', () => {
        expect(normalizeCoordinatorAnnouncementTargetGroups(['cit-23', '', '   ', 'cit-24']))
            .toEqual(['CIT-23', 'CIT-24']);
    });

    it('deduplicates after normalization (case + whitespace insensitive)', () => {
        expect(normalizeCoordinatorAnnouncementTargetGroups(['cit-23', 'CIT-23', 'Cit-23'])).toEqual(['CIT-23']);
        expect(normalizeCoordinatorAnnouncementTargetGroups(['cit  23', 'CIT 23'])).toEqual(['CIT 23']);
    });

    it('preserves insertion order of the first occurrence', () => {
        expect(normalizeCoordinatorAnnouncementTargetGroups(['c', 'a', 'b', 'A'])).toEqual(['C', 'A', 'B']);
    });
});

describe('normalizeSearchValue', () => {
    it('returns empty string for null/undefined/empty', () => {
        expect(normalizeSearchValue(null)).toBe('');
        expect(normalizeSearchValue(undefined)).toBe('');
        expect(normalizeSearchValue('')).toBe('');
    });

    it('lowercases', () => {
        expect(normalizeSearchValue('HELLO')).toBe('hello');
        expect(normalizeSearchValue('Иванов')).toBe('иванов');
    });

    it('collapses internal whitespace and trims', () => {
        expect(normalizeSearchValue('  foo   bar\nbaz\t')).toBe('foo bar baz');
    });

    it('idempotent: applying twice yields same result', () => {
        const once = normalizeSearchValue('  HELLO  World  ');
        expect(normalizeSearchValue(once)).toBe(once);
    });
});

describe('buildUserSearchRegex', () => {
    it('returns null on empty/whitespace input', () => {
        expect(buildUserSearchRegex('')).toBe(null);
        expect(buildUserSearchRegex('   ')).toBe(null);
    });

    it('returns a case-insensitive regex on valid input', () => {
        const re = buildUserSearchRegex('foo');
        expect(re).not.toBe(null);
        expect(re!.flags).toContain('i');
        expect(re!.test('FOO')).toBe(true);
        expect(re!.test('foobar')).toBe(true);
    });

    it('ALWAYS escapes regex metacharacters (ReDoS-safe)', () => {
        // The whole point of this function — fire 17 fixed a ReDoS where the old code
        // passed user input straight to `new RegExp()`. Verify that special regex chars
        // are matched as literals, not interpreted as regex syntax.
        const re = buildUserSearchRegex('(a+)+b');
        expect(re).not.toBe(null);
        // The escaped pattern matches the literal sequence "(a+)+b", not an evil regex.
        expect(re!.test('(a+)+b')).toBe(true);
        expect(re!.test('aaab')).toBe(false); // would have been TRUE under unescaped behavior
    });

    it('escapes `.` so it matches a literal dot', () => {
        const re = buildUserSearchRegex('a.b');
        expect(re!.test('a.b')).toBe(true);
        expect(re!.test('axb')).toBe(false);
    });

    it('escapes `[` and `]` so they match literal brackets', () => {
        const re = buildUserSearchRegex('[admin]');
        expect(re!.test('[admin]')).toBe(true);
    });

    it('escapes `\\` so it matches a literal backslash', () => {
        const re = buildUserSearchRegex('a\\b');
        expect(re!.test('a\\b')).toBe(true);
    });

    it('trims input before processing', () => {
        const re = buildUserSearchRegex('  foo  ');
        expect(re!.test('foo')).toBe(true);
        // The trimmed version shouldn't match strings that only contain padding.
        expect(re!.test('   ')).toBe(false);
    });

    it('handles unicode search terms (Cyrillic)', () => {
        const re = buildUserSearchRegex('Иванов');
        expect(re).not.toBe(null);
        expect(re!.test('Иванов И.И.')).toBe(true);
        expect(re!.test('ИВАНОВ')).toBe(true); // case-insensitive
    });
});

describe('normalizeOptionalText', () => {
    it('returns null for non-string inputs', () => {
        expect(normalizeOptionalText(null)).toBe(null);
        expect(normalizeOptionalText(undefined)).toBe(null);
        expect(normalizeOptionalText(42)).toBe(null);
        expect(normalizeOptionalText({})).toBe(null);
        expect(normalizeOptionalText([])).toBe(null);
        expect(normalizeOptionalText(true)).toBe(null);
    });

    it('returns null for empty/whitespace-only strings', () => {
        expect(normalizeOptionalText('')).toBe(null);
        expect(normalizeOptionalText('   ')).toBe(null);
        expect(normalizeOptionalText('\n\t  ')).toBe(null);
    });

    it('returns trimmed value for non-empty strings', () => {
        expect(normalizeOptionalText('hello')).toBe('hello');
        expect(normalizeOptionalText('  hello  ')).toBe('hello');
    });

    it('preserves internal whitespace', () => {
        expect(normalizeOptionalText('  hello world  ')).toBe('hello world');
    });

    it('preserves Cyrillic and emoji', () => {
        expect(normalizeOptionalText('  Привет 🎉  ')).toBe('Привет 🎉');
    });
});

describe('toDateOrNull', () => {
    it('returns null for falsy inputs', () => {
        expect(toDateOrNull(null)).toBe(null);
        expect(toDateOrNull(undefined)).toBe(null);
        expect(toDateOrNull('')).toBe(null);
        expect(toDateOrNull(0)).toBe(null);
        expect(toDateOrNull(false)).toBe(null);
    });

    it('passes through Date instances', () => {
        const d = new Date('2026-05-13T10:00:00Z');
        const result = toDateOrNull(d);
        expect(result).toBe(d);
    });

    it('parses ISO date strings', () => {
        const result = toDateOrNull('2026-05-13T10:00:00Z');
        expect(result).toBeInstanceOf(Date);
        expect(result!.getUTCFullYear()).toBe(2026);
        expect(result!.getUTCMonth()).toBe(4); // May = month 4
        expect(result!.getUTCDate()).toBe(13);
    });

    it('numeric input does NOT parse via String() coercion (returns null)', () => {
        // The function calls `new Date(String(value))` for non-Date input. `new Date("1700000000000")`
        // is a date STRING parse, not a ms-since-epoch number, and fails. So passing a number
        // doesn't work — caller must pass Date or ISO string.
        const ms = Date.now();
        expect(toDateOrNull(ms)).toBe(null);
    });

    it('returns null for unparseable strings', () => {
        expect(toDateOrNull('not a date')).toBe(null);
        expect(toDateOrNull('garbage')).toBe(null);
    });

    it('returns null for invalid Date instances', () => {
        const invalid = new Date('not a date');
        expect(toDateOrNull(invalid)).toBe(null);
    });
});

describe('buildPermissions', () => {
    it('empty roles → no permissions', () => {
        const p = buildPermissions([]);
        expect(p.canManageContent).toBe(false);
        expect(p.canManageMembers).toBe(false);
        expect(p.canManageHelpers).toBe(false);
        expect(p.canAssignStarosta).toBe(false);
        expect(p.canViewAudit).toBe(false);
    });

    it('coordinator has every permission', () => {
        const p = buildPermissions(['coordinator']);
        expect(p.canManageContent).toBe(true);
        expect(p.canManageMembers).toBe(true);
        expect(p.canManageHelpers).toBe(true);
        expect(p.canAssignStarosta).toBe(true);
        expect(p.canViewAudit).toBe(true);
    });

    it('curator has every permission (parity with coordinator)', () => {
        const p = buildPermissions(['curator']);
        expect(p.canManageContent).toBe(true);
        expect(p.canManageMembers).toBe(true);
        expect(p.canManageHelpers).toBe(true);
        expect(p.canAssignStarosta).toBe(true);
        expect(p.canViewAudit).toBe(true);
    });

    it('starosta can manage content/members/helpers + view audit, but cannot assign starosta', () => {
        const p = buildPermissions(['starosta']);
        expect(p.canManageContent).toBe(true);
        expect(p.canManageMembers).toBe(true);
        expect(p.canManageHelpers).toBe(true);
        expect(p.canAssignStarosta).toBe(false);
        expect(p.canViewAudit).toBe(true);
    });

    it('helper can manage content/members only — no helpers/starosta-assign/audit', () => {
        const p = buildPermissions(['helper']);
        expect(p.canManageContent).toBe(true);
        expect(p.canManageMembers).toBe(true);
        expect(p.canManageHelpers).toBe(false);
        expect(p.canAssignStarosta).toBe(false);
        expect(p.canViewAudit).toBe(false);
    });

    it('combined roles → union of permissions', () => {
        // helper + starosta in different scopes → effectively starosta-level
        const p = buildPermissions(['helper', 'starosta']);
        expect(p.canManageHelpers).toBe(true); // from starosta
        expect(p.canViewAudit).toBe(true);     // from starosta
        expect(p.canAssignStarosta).toBe(false); // neither role grants
    });

    it('unknown roles do not grant anything', () => {
        const p = buildPermissions(['admin' as unknown as 'coordinator']);
        expect(p.canManageContent).toBe(false);
        expect(p.canAssignStarosta).toBe(false);
    });
});
