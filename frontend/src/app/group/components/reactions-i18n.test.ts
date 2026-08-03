import { describe, it, expect } from 'vitest';
import { getReactionsUi } from './reactions-i18n';

describe('getReactionsUi', () => {
    it('returns Russian strings for "ru"', () => {
        const ui = getReactionsUi('ru');
        expect(ui.barLabel).toBe('Реакции на пост');
        expect(ui.pickAria('👍')).toBe('Реакция 👍');
        expect(ui.toggleFailed).toBe('Не удалось сохранить реакцию');
    });

    it('returns Kazakh strings for "kz"', () => {
        const ui = getReactionsUi('kz');
        expect(ui.barLabel).toBe('Жазбаға реакциялар');
        expect(ui.pickAria('❤️')).toBe('❤️ реакциясы');
        expect(ui.toggleFailed).toBe('Реакцияны сақтау сәтсіз аяқталды');
    });

    it('returns English strings for "en"', () => {
        const ui = getReactionsUi('en');
        expect(ui.barLabel).toBe('Post reactions');
        expect(ui.pickAria('🎉')).toBe('React with 🎉');
        expect(ui.toggleFailed).toBe('Failed to save reaction');
    });
});
