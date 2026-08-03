import { describe, it, expect } from 'vitest';
import {
    surfaceBoxStyle,
    tinyCapsStyle,
    darkInputStyle,
    gradientButtonStyle,
    secondaryButtonStyle,
    rankBubbleStyle,
    hintChipStyle,
    miniMutedStyle,
    dropdownStyle,
    dropdownItemMutedStyle,
    dropdownButtonStyle,
    tierButtonStyle,
    tagChipStyle,
    teacherRowButtonStyle,
} from './styles';
import type { TeacherTier } from '@/lib/api';

describe('static style constants', () => {
    it('every exported constant is a non-empty CSSProperties object', () => {
        const constants = {
            surfaceBoxStyle, tinyCapsStyle, darkInputStyle, gradientButtonStyle, secondaryButtonStyle,
            rankBubbleStyle, hintChipStyle, miniMutedStyle, dropdownStyle, dropdownItemMutedStyle,
            dropdownButtonStyle,
        };
        for (const [name, value] of Object.entries(constants)) {
            expect(value, `${name} should be an object`).toBeTypeOf('object');
            expect(Object.keys(value).length, `${name} should have at least one CSS property`).toBeGreaterThan(0);
        }
    });

    it('dropdownButtonStyle has interactive cursor and full width', () => {
        expect(dropdownButtonStyle.width).toBe('100%');
        expect(dropdownButtonStyle.cursor).toBe('pointer');
    });
});

describe('tierButtonStyle', () => {
    const tiers: TeacherTier[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

    it.each(tiers)('returns a style object with all required keys for tier %s', (tier) => {
        const style = tierButtonStyle(tier, false);
        expect(style.borderRadius).toBe('999px');
        expect(style.fontSize).toBe('13px');
        expect(style.fontWeight).toBe(800);
        expect(style.cursor).toBe('pointer');
        expect(style.border).toContain('1px solid');
    });

    it('active state uses tier-specific background instead of neutral pill', () => {
        const inactive = tierButtonStyle('S', false);
        const active = tierButtonStyle('S', true);
        expect(active.background).not.toBe(inactive.background);
        expect(active.color).not.toBe(inactive.color);
    });

    it('different tiers produce different border colors when inactive', () => {
        const borders = tiers.map((t) => tierButtonStyle(t, false).border);
        // Most tiers use distinct color tokens — at minimum, 4 of 7 should differ.
        expect(new Set(borders).size).toBeGreaterThanOrEqual(4);
    });

    it('B and F tiers use CSS variables (not literal rgba)', () => {
        const b = tierButtonStyle('B', true);
        const f = tierButtonStyle('F', true);
        expect(String(b.background)).toContain('var(--');
        expect(String(f.background)).toContain('var(--');
    });
});

describe('tagChipStyle', () => {
    it('active vs inactive differ in border, background, and color', () => {
        const a = tagChipStyle(true);
        const b = tagChipStyle(false);
        expect(a.border).not.toBe(b.border);
        expect(a.background).not.toBe(b.background);
        expect(a.color).not.toBe(b.color);
    });

    it('active uses primary color token', () => {
        expect(tagChipStyle(true).color).toBe('var(--primary)');
    });

    it('both states are clickable', () => {
        expect(tagChipStyle(true).cursor).toBe('pointer');
        expect(tagChipStyle(false).cursor).toBe('pointer');
    });
});

describe('teacherRowButtonStyle', () => {
    it('active vs inactive differ in border and background', () => {
        const a = teacherRowButtonStyle(true);
        const b = teacherRowButtonStyle(false);
        expect(a.border).not.toBe(b.border);
        expect(a.background).not.toBe(b.background);
    });

    it('inactive falls back to the regular row tokens', () => {
        const style = teacherRowButtonStyle(false);
        expect(style.background).toBe('var(--leaderboard-row-bg)');
        expect(style.border).toBe('1px solid var(--leaderboard-surface-border)');
    });

    it('both states are full-width interactive rows', () => {
        for (const active of [true, false]) {
            const style = teacherRowButtonStyle(active);
            expect(style.width).toBe('100%');
            expect(style.cursor).toBe('pointer');
            expect(style.textAlign).toBe('left');
        }
    });
});
