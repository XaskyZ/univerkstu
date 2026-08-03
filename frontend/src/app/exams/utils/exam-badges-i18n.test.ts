import { describe, it, expect } from 'vitest';
import { getExamBadgesUi } from './exam-badges-i18n';

describe('getExamBadgesUi', () => {
    const LANGUAGES = ['ru', 'kz', 'en'] as const;

    it('returns the same set of keys for every supported language', () => {
        const ruKeys = Object.keys(getExamBadgesUi('ru')).sort();
        for (const lang of LANGUAGES) {
            expect(Object.keys(getExamBadgesUi(lang)).sort()).toEqual(ruKeys);
        }
    });

    it('returns non-empty strings for every key in every language', () => {
        for (const lang of LANGUAGES) {
            const ui = getExamBadgesUi(lang);
            for (const value of Object.values(ui)) {
                expect(value.trim().length).toBeGreaterThan(0);
            }
        }
    });
});
