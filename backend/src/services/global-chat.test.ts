import { describe, it, expect } from 'vitest';
import {
    getGlobalChatMessageMaxLength,
    normalizeSingleLineText,
    clampMuteDurationMinutes,
    normalizeMultiLineText,
    clampMessageLimit,
} from './global-chat.js';

describe('getGlobalChatMessageMaxLength', () => {
    it('returns the module constant 2000', () => {
        // Mirrors MAX_MESSAGE_LENGTH = 2000 in source. Guards against accidental drift
        // that would desync route schema caps from service-level enforcement.
        expect(getGlobalChatMessageMaxLength()).toBe(2000);
    });

    it('is a positive integer', () => {
        const value = getGlobalChatMessageMaxLength();
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
    });
});

describe('normalizeSingleLineText', () => {
    it('trims surrounding whitespace', () => {
        expect(normalizeSingleLineText('  hello  ')).toBe('hello');
    });

    it('collapses internal whitespace to single spaces', () => {
        expect(normalizeSingleLineText('foo   bar')).toBe('foo bar');
    });

    it('collapses newlines/tabs to single spaces', () => {
        expect(normalizeSingleLineText('foo\nbar\tbaz')).toBe('foo bar baz');
    });

    it('handles empty / whitespace-only input', () => {
        expect(normalizeSingleLineText('')).toBe('');
        expect(normalizeSingleLineText('   ')).toBe('');
        expect(normalizeSingleLineText('\n\n\t')).toBe('');
    });

    it('idempotent', () => {
        const once = normalizeSingleLineText('  hello   world  ');
        expect(normalizeSingleLineText(once)).toBe(once);
    });
});

describe('clampMuteDurationMinutes', () => {
    const MAX_MINUTES = 60 * 24 * 30; // 30 days

    it('returns null on null/undefined (means "permanent" / "no clamp")', () => {
        expect(clampMuteDurationMinutes(null)).toBe(null);
        expect(clampMuteDurationMinutes(undefined)).toBe(null);
    });

    it('returns null on non-finite', () => {
        expect(clampMuteDurationMinutes(NaN)).toBe(null);
        expect(clampMuteDurationMinutes(Infinity)).toBe(null);
        expect(clampMuteDurationMinutes(-Infinity)).toBe(null);
    });

    it('returns null on zero or negative', () => {
        expect(clampMuteDurationMinutes(0)).toBe(null);
        expect(clampMuteDurationMinutes(-5)).toBe(null);
        expect(clampMuteDurationMinutes(-1)).toBe(null);
    });

    it('passes through valid durations', () => {
        expect(clampMuteDurationMinutes(60)).toBe(60);
        expect(clampMuteDurationMinutes(1440)).toBe(1440); // 1 day
        expect(clampMuteDurationMinutes(MAX_MINUTES)).toBe(MAX_MINUTES);
    });

    it('clamps to 30 days (60 * 24 * 30 = 43200 minutes)', () => {
        expect(clampMuteDurationMinutes(MAX_MINUTES + 1)).toBe(MAX_MINUTES);
        expect(clampMuteDurationMinutes(1_000_000)).toBe(MAX_MINUTES);
    });

    it('truncates fractional values', () => {
        expect(clampMuteDurationMinutes(60.5)).toBe(60);
        expect(clampMuteDurationMinutes(60.9999)).toBe(60);
    });

    it('truncates fractional negative-near-zero values to 0 → null', () => {
        // Math.trunc(0.5) === 0 → falls into the zero/negative-rejected branch.
        expect(clampMuteDurationMinutes(0.5)).toBe(null);
    });
});

describe('normalizeMultiLineText (global-chat)', () => {
    // Same shape as services/messaging.ts:normalizeMultiLineText (fire 131). Tested
    // independently here so a future divergence between the two surfaces is caught.

    it('converts CRLF to LF', () => {
        expect(normalizeMultiLineText('line1\r\nline2')).toBe('line1\nline2');
    });

    it('strips trailing whitespace per line (preserves intentional blank lines)', () => {
        expect(normalizeMultiLineText('hello  \nworld\t')).toBe('hello\nworld');
        // Middle blank line is preserved (it's not trailing-whitespace on a line, it's a line).
        expect(normalizeMultiLineText('one\n\ntwo')).toBe('one\n\ntwo');
    });

    it('trims surrounding whitespace globally (post-line-strip)', () => {
        expect(normalizeMultiLineText('  hello  ')).toBe('hello');
    });

    it('combined CRLF + per-line trim + outer trim', () => {
        expect(normalizeMultiLineText('  \r\nhello \r\n  world  \r\n  '))
            .toBe('hello\n  world');
    });

    it('empty/whitespace-only → empty', () => {
        expect(normalizeMultiLineText('')).toBe('');
        expect(normalizeMultiLineText('  \n  ')).toBe('');
    });
});

describe('clampMessageLimit (global-chat)', () => {
    // Global chat uses DIFFERENT limits than messaging.ts (default 120 vs 80,
    // max 200 vs 150). These are stricter on the upper bound since global chat
    // can have higher total volume.

    const DEFAULT_GLOBAL = 120;
    const MAX_GLOBAL = 200;

    it('returns default 120 for non-finite values (NaN/Infinity/undefined)', () => {
        expect(clampMessageLimit(undefined)).toBe(DEFAULT_GLOBAL);
        expect(clampMessageLimit(NaN)).toBe(DEFAULT_GLOBAL);
        expect(clampMessageLimit(Infinity)).toBe(DEFAULT_GLOBAL);
        expect(clampMessageLimit(-Infinity)).toBe(DEFAULT_GLOBAL);
    });

    it('clamps to [1, 200] range', () => {
        expect(clampMessageLimit(0)).toBe(1);
        expect(clampMessageLimit(-5)).toBe(1);
        expect(clampMessageLimit(MAX_GLOBAL)).toBe(MAX_GLOBAL);
        expect(clampMessageLimit(MAX_GLOBAL + 1)).toBe(MAX_GLOBAL);
        expect(clampMessageLimit(1000)).toBe(MAX_GLOBAL);
    });

    it('truncates fractional values toward zero', () => {
        expect(clampMessageLimit(120.9)).toBe(120);
        expect(clampMessageLimit(1.5)).toBe(1);
    });

    it('passes valid values through (within range)', () => {
        expect(clampMessageLimit(1)).toBe(1);
        expect(clampMessageLimit(50)).toBe(50);
        expect(clampMessageLimit(120)).toBe(120);
        expect(clampMessageLimit(200)).toBe(200);
    });

    it('locks in the 200-MAX (different from messaging.ts MAX=150)', () => {
        // Regression guard: catches a future "DRY" refactor that accidentally
        // unifies the two clampers to the wrong shared limit.
        expect(clampMessageLimit(151)).toBe(151);
        expect(clampMessageLimit(151)).not.toBe(150);
    });
});
