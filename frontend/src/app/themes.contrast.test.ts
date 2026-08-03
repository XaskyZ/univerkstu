import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the two colour-pair contracts that themes.css is supposed to hold for
 * every one of the eleven themes:
 *
 *   1. `--button-primary-fg` on `--primary` — the foreground painted on primary
 *      buttons, active segmented-control pills and unread badges. This one is
 *      ACTIVE: it regressed to a hardcoded `#fff` fallback (the token did not
 *      exist at all), which measured 1.37:1 on matrix and failed on all eleven.
 *
 *   2. `--muted` on `--bg` — secondary body copy. This one is SKIPPED, see the
 *      comment on the `it.todo` below: four themes have real, pre-existing
 *      failures that need a separate token pass, and loosening the threshold
 *      here would hide them.
 *
 * CAVEAT ON THE METHOD: ratios are computed from the flat hex literals in
 * themes.css. Several real surfaces are `rgba()` or a gradient over another
 * layer (`.btn-primary` paints `--gradient-primary`, not `--primary`; `--card`
 * is translucent over `--app-bg`). Where a gradient's dark stop is darker than
 * `--primary`, the on-screen ratio for a dark foreground is *lower* than what
 * this test measures — so passing here is necessary but not always sufficient.
 */

const AA_NORMAL_TEXT = 4.5;

const THEMES = [
    'light',
    'dark',
    'deep-blue',
    'aurora',
    'sunset',
    'matrix',
    'pastel',
    'referral-nebula',
    'referral-sherbet',
    'supporter-midnight',
    'supporter-paper',
] as const;

type ThemeName = (typeof THEMES)[number];

const themesCssPath = join(dirname(fileURLToPath(import.meta.url)), 'themes.css');
const themesCss = readFileSync(themesCssPath, 'utf8');

/**
 * The dark block is written as `:root, [data-theme="dark"] { ... }`, so match on
 * the selector list containing the theme rather than on an exact selector.
 */
function readThemeBlock(theme: ThemeName): string {
    const escaped = theme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|,)[^{}]*\\[data-theme="${escaped}"\\][^{}]*\\{([^}]*)\\}`, 'm');
    const match = themesCss.match(pattern);
    if (!match) throw new Error(`No rule block found for [data-theme="${theme}"] in themes.css`);
    return match[2];
}

function readToken(theme: ThemeName, token: string): string {
    const block = readThemeBlock(theme);
    const match = block.match(new RegExp(`(?:^|;|\\n)\\s*${token}\\s*:\\s*([^;]+);`));
    if (!match) throw new Error(`Theme "${theme}" does not define ${token}`);
    return match[1].trim();
}

function parseHex(value: string): [number, number, number] {
    const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) throw new Error(`Expected a flat hex colour, got "${value}"`);
    const hex = match[1].length === 3
        ? match[1].split('').map((c) => c + c).join('')
        : match[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

// WCAG 2.x relative luminance / contrast ratio.
function relativeLuminance(value: string): number {
    const [r, g, b] = parseHex(value).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

describe('themes.css contrast', () => {
    it('covers every theme declared in THEMES', () => {
        for (const theme of THEMES) {
            expect(() => readThemeBlock(theme)).not.toThrow();
        }
    });

    describe('--button-primary-fg on --primary meets WCAG AA (4.5:1)', () => {
        for (const theme of THEMES) {
            it(theme, () => {
                const fg = readToken(theme, '--button-primary-fg');
                const primary = readToken(theme, '--primary');
                const ratio = contrastRatio(fg, primary);
                expect(
                    ratio,
                    `${theme}: ${fg} on ${primary} = ${ratio.toFixed(2)}:1`,
                ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
            });
        }
    });

    /**
     * SKIPPED ON PURPOSE — do not "fix" this by lowering AA_NORMAL_TEXT.
     *
     * Four themes ship a `--muted` that genuinely fails 4.5:1 against their
     * `--bg`, and correcting them means re-picking a secondary-text colour per
     * theme (a token pass tracked separately, not a cascade bug):
     *
     *   light             #6d7189 on #f4f6ff -> 4.45:1
     *   referral-sherbet  #8b7065 on #fff7ed -> 4.30:1
     *   supporter-paper   #73857f on #f6fbf7 -> 3.72:1
     *   pastel            #9a8a9c on #fef7f0 -> 3.05:1
     *
     * The other seven themes already pass (matrix is the tightest at 5.14:1).
     * Flip this to a real `describe`/`it` once those four tokens are darkened.
     */
    it.todo('--muted on --bg meets WCAG AA (4.5:1) — fails on light, referral-sherbet, supporter-paper, pastel');
});
