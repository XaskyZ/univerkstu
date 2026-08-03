import { describe, expect, it } from 'vitest';
import { parseShortcut, formatCombo } from './keyboard-shortcuts';

describe('parseShortcut', () => {
    it('parses a single lowercase key', () => {
        const result = parseShortcut('t');
        expect(result.parts).toHaveLength(1);
        expect(result.parts[0]).toMatchObject({
            key: 't',
            cmd: false,
            ctrl: false,
            shift: false,
            alt: false,
            primary: false,
        });
    });

    it('parses Cmd+K', () => {
        const result = parseShortcut('Cmd+K');
        expect(result.parts).toHaveLength(1);
        expect(result.parts[0]).toMatchObject({
            key: 'k',
            cmd: true,
            ctrl: false,
            shift: false,
        });
    });

    it('parses Ctrl+K as ctrl-only', () => {
        const result = parseShortcut('Ctrl+K');
        expect(result.parts[0]).toMatchObject({ key: 'k', ctrl: true, cmd: false });
    });

    it('parses Mod+K as the platform primary modifier', () => {
        const result = parseShortcut('Mod+K');
        expect(result.parts[0]).toMatchObject({ key: 'k', primary: true });
    });

    it('parses Shift+? combo', () => {
        const result = parseShortcut('Shift+?');
        expect(result.parts[0]).toMatchObject({ key: '?', shift: true });
    });

    it('parses a chord like "g s"', () => {
        const result = parseShortcut('g s');
        expect(result.parts).toHaveLength(2);
        expect(result.parts[0].key).toBe('g');
        expect(result.parts[1].key).toBe('s');
    });

    it('rejects chords longer than two keys', () => {
        expect(() => parseShortcut('g s d')).toThrow(/chords longer than 2/);
    });

    it('rejects empty input', () => {
        expect(() => parseShortcut('')).toThrow();
    });

    it('parses multi-char keys like Escape', () => {
        const result = parseShortcut('Escape');
        expect(result.parts[0]).toMatchObject({ key: 'escape' });
    });
});

describe('formatCombo', () => {
    it('uppercases single letters', () => {
        expect(formatCombo('t')).toBe('T');
    });

    it('joins chord parts with a space', () => {
        expect(formatCombo('g s')).toBe('G S');
    });

    it('renders Shift+? as a recognizable combo', () => {
        const formatted = formatCombo('Shift+?');
        expect(formatted).toMatch(/\?/);
    });

    it('prettifies Escape', () => {
        expect(formatCombo('Escape')).toBe('Esc');
    });
});
