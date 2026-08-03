import { describe, it, expect } from 'vitest';
import { PARTICLE_COLORS, CARD_VARIANTS, type CardPalette } from './variants';

describe('PARTICLE_COLORS', () => {
    it('every palette has exactly 3 colors (used for staggered particle emission)', () => {
        for (const [palette, colors] of Object.entries(PARTICLE_COLORS)) {
            expect(colors.length, `palette "${palette}" should have 3 colors`).toBe(3);
        }
    });

    it('every color is a valid hex string (#xxxxxx)', () => {
        for (const colors of Object.values(PARTICLE_COLORS)) {
            for (const color of colors) {
                expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
            }
        }
    });

    it('exports the expected 8 palette keys', () => {
        const expected = ['warm', 'green', 'blue', 'purple', 'red', 'indigo', 'gold', 'cyan'];
        expect(Object.keys(PARTICLE_COLORS).sort()).toEqual([...expected].sort());
    });
});

describe('CARD_VARIANTS', () => {
    const LANGUAGES = ['ru', 'kz', 'en'] as const;

    it('has variants for ru/kz/en', () => {
        expect(Object.keys(CARD_VARIANTS).sort()).toEqual(['en', 'kz', 'ru']);
    });

    it('each language has the same number of variants (translation parity)', () => {
        const counts = LANGUAGES.map((lang) => CARD_VARIANTS[lang].length);
        expect(new Set(counts).size).toBe(1);
        // Sanity bound — there are 8 in source today.
        expect(counts[0]).toBe(8);
    });

    it.each(LANGUAGES)('every variant in "%s" has all required fields', (lang) => {
        for (const variant of CARD_VARIANTS[lang]) {
            expect(variant.emoji).toBeTruthy();
            expect(variant.label).toBeTruthy();
            expect(variant.title).toBeTruthy();
            expect(variant.sub).toBeTruthy();
            expect(variant.accent).toBeTruthy();
            expect(variant.glow).toBeTruthy();
            expect(variant.background).toBeTruthy();
            expect(variant.particles).toBeTruthy();
        }
    });

    it('every variant references a valid particle palette key', () => {
        const validPalettes = new Set<CardPalette>(Object.keys(PARTICLE_COLORS) as CardPalette[]);
        for (const lang of LANGUAGES) {
            for (const variant of CARD_VARIANTS[lang]) {
                expect(validPalettes.has(variant.particles)).toBe(true);
            }
        }
    });

    it('language variants at the same index share visual identity (emoji + palette + background)', () => {
        const length = CARD_VARIANTS.ru.length;
        for (let i = 0; i < length; i++) {
            const ru = CARD_VARIANTS.ru[i];
            const kz = CARD_VARIANTS.kz[i];
            const en = CARD_VARIANTS.en[i];
            // Visual fields must match across languages — only `label`/`title`/`sub` are translated.
            expect(kz.emoji).toBe(ru.emoji);
            expect(en.emoji).toBe(ru.emoji);
            expect(kz.particles).toBe(ru.particles);
            expect(en.particles).toBe(ru.particles);
            expect(kz.background).toBe(ru.background);
            expect(en.background).toBe(ru.background);
            expect(kz.accent).toBe(ru.accent);
            expect(en.accent).toBe(ru.accent);
        }
    });

    it('every variant in every language has a unique emoji within its language', () => {
        for (const lang of LANGUAGES) {
            const emojis = CARD_VARIANTS[lang].map((v) => v.emoji);
            expect(new Set(emojis).size).toBe(emojis.length);
        }
    });

    it('translated text fields ARE different across languages (catch copy-paste mistakes)', () => {
        for (let i = 0; i < CARD_VARIANTS.ru.length; i++) {
            const ru = CARD_VARIANTS.ru[i];
            const en = CARD_VARIANTS.en[i];
            // EN and RU titles should not be identical — that would mean someone copy-pasted.
            expect(en.title).not.toBe(ru.title);
            expect(en.sub).not.toBe(ru.sub);
        }
    });
});
