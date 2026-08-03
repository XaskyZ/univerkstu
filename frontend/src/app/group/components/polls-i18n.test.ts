import { describe, it, expect } from 'vitest';
import { getPollsUi } from './polls-i18n';

describe('getPollsUi', () => {
    it('returns Russian strings for "ru" with correct pluralization', () => {
        const ui = getPollsUi('ru');
        expect(ui.createPoll).toBe('Создать опрос');
        expect(ui.submit).toBe('Создать');
        expect(ui.totalVotes(1)).toBe('1 голос');
        expect(ui.totalVotes(2)).toBe('2 голоса');
        expect(ui.totalVotes(5)).toBe('5 голосов');
        expect(ui.totalVotes(11)).toBe('11 голосов');
        expect(ui.totalVotes(22)).toBe('22 голоса');
        expect(ui.optionPlaceholder(0)).toBe('Вариант 1');
        expect(ui.closed).toBe('Опрос закрыт');
    });

    it('returns Kazakh strings for "kz"', () => {
        const ui = getPollsUi('kz');
        expect(ui.createPoll).toBe('Сауалнама жасау');
        expect(ui.questionLabel).toBe('Сұрақ');
        expect(ui.totalVotes(3)).toBe('3 дауыс');
        expect(ui.unvote).toBe('Дауысты алып тастау');
    });

    it('returns English strings for "en" and proper vote pluralization', () => {
        const ui = getPollsUi('en');
        expect(ui.createPoll).toBe('Create poll');
        expect(ui.questionLabel).toBe('Question');
        expect(ui.optionPlaceholder(2)).toBe('Option 3');
        expect(ui.totalVotes(1)).toBe('1 vote');
        expect(ui.totalVotes(0)).toBe('0 votes');
        expect(ui.totalVotes(5)).toBe('5 votes');
    });

    it('exposes consistent error messages across all languages', () => {
        // The three failure messages must be defined and non-empty so the
        // PollCard error-line render path always has something to show.
        for (const lang of ['ru', 'kz', 'en'] as const) {
            const ui = getPollsUi(lang);
            expect(ui.voteFailed.length).toBeGreaterThan(0);
            expect(ui.unvoteFailed.length).toBeGreaterThan(0);
            expect(ui.closeFailed.length).toBeGreaterThan(0);
        }
    });

    it('produces sensible min/max-options messages and option remove label', () => {
        const ru = getPollsUi('ru');
        expect(ru.minOptions).toMatch(/2/);
        expect(ru.maxOptions).toMatch(/8/);
        expect(ru.addOption).toBe('Добавить вариант');
        expect(ru.removeOption).toBe('Удалить');
        const en = getPollsUi('en');
        expect(en.minOptions).toMatch(/2/);
        expect(en.maxOptions).toMatch(/8/);
    });

    it('exposes non-empty multi-choice labels across every language', () => {
        for (const lang of ['ru', 'kz', 'en'] as const) {
            const ui = getPollsUi(lang);
            expect(ui.multiChoiceToggle.length).toBeGreaterThan(0);
            expect(ui.multiChoiceHint.length).toBeGreaterThan(0);
            expect(ui.multiChoiceBadge.length).toBeGreaterThan(0);
            expect(ui.unvoteAll.length).toBeGreaterThan(0);
        }
    });

    it('produces every key for every language (locale parity)', () => {
        const ru = getPollsUi('ru');
        const kz = getPollsUi('kz');
        const en = getPollsUi('en');
        expect(Object.keys(ru).sort()).toEqual(Object.keys(kz).sort());
        expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    });
});
