import { describe, it, expect } from 'vitest';
import { getCommentsThreadUi } from './comments-thread-i18n';

describe('getCommentsThreadUi', () => {
    it('returns Russian strings for "ru" (with proper pluralization)', () => {
        const ui = getCommentsThreadUi('ru');
        expect(ui.hideComments).toBe('Скрыть комментарии');
        expect(ui.placeholder).toBe('Напишите комментарий…');
        expect(ui.send).toBe('Отправить');
        expect(ui.reply).toBe('Ответить');
        expect(ui.cancel).toBe('Отмена');
        expect(ui.loading).toBe('Загрузка комментариев…');
        expect(ui.empty).toBe('Пока нет комментариев. Будь первым.');
        expect(ui.loadFailed).toBe('Не удалось загрузить комментарии');
        expect(ui.sendFailed).toBe('Не удалось отправить комментарий');
        expect(ui.deletedComment).toBe('Комментарий удалён');
        expect(ui.threadAriaLabel).toBe('Комментарии');
        expect(ui.charCount(42, 2000)).toBe('42/2000');

        // Russian pluralization for "комментарий" (1 / 2-4 / 5+, with 11-14 edge).
        expect(ui.showComments(0)).toBe('Показать 0 комментариев');
        expect(ui.showComments(1)).toBe('Показать 1 комментарий');
        expect(ui.showComments(2)).toBe('Показать 2 комментария');
        expect(ui.showComments(3)).toBe('Показать 3 комментария');
        expect(ui.showComments(4)).toBe('Показать 4 комментария');
        expect(ui.showComments(5)).toBe('Показать 5 комментариев');
        expect(ui.showComments(11)).toBe('Показать 11 комментариев');
        expect(ui.showComments(12)).toBe('Показать 12 комментариев');
        expect(ui.showComments(21)).toBe('Показать 21 комментарий');
        expect(ui.showComments(22)).toBe('Показать 22 комментария');
        expect(ui.showComments(25)).toBe('Показать 25 комментариев');
    });

    it('returns Kazakh strings for "kz"', () => {
        const ui = getCommentsThreadUi('kz');
        expect(ui.showComments(7)).toBe('7 пікірді көрсету');
        expect(ui.hideComments).toBe('Пікірлерді жасыру');
        expect(ui.placeholder).toBe('Пікір жазыңыз…');
        expect(ui.send).toBe('Жіберу');
        expect(ui.reply).toBe('Жауап беру');
        expect(ui.cancel).toBe('Болдырмау');
        expect(ui.loading).toBe('Пікірлер жүктелуде…');
        expect(ui.empty).toBe('Әзірге пікір жоқ. Бірінші болыңыз.');
        expect(ui.loadFailed).toBe('Пікірлерді жүктеу мүмкін болмады');
        expect(ui.sendFailed).toBe('Пікірді жіберу мүмкін болмады');
        expect(ui.deletedComment).toBe('Пікір жойылған');
        expect(ui.threadAriaLabel).toBe('Пікірлер');
        expect(ui.charCount(0, 2000)).toBe('0/2000');
    });

    it('returns English strings for "en" (with simple singular/plural)', () => {
        const ui = getCommentsThreadUi('en');
        expect(ui.showComments(1)).toBe('Show 1 comment');
        expect(ui.showComments(0)).toBe('Show 0 comments');
        expect(ui.showComments(5)).toBe('Show 5 comments');
        expect(ui.hideComments).toBe('Hide comments');
        expect(ui.placeholder).toBe('Write a comment…');
        expect(ui.send).toBe('Send');
        expect(ui.reply).toBe('Reply');
        expect(ui.cancel).toBe('Cancel');
        expect(ui.loading).toBe('Loading comments…');
        expect(ui.empty).toBe('No comments yet. Be the first.');
        expect(ui.loadFailed).toBe('Failed to load comments');
        expect(ui.sendFailed).toBe('Failed to send the comment');
        expect(ui.deletedComment).toBe('Comment deleted');
        expect(ui.threadAriaLabel).toBe('Comments');
        expect(ui.charCount(1999, 2000)).toBe('1999/2000');
    });
});
