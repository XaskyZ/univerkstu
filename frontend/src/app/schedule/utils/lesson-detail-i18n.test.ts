import { describe, it, expect } from 'vitest';
import { getLessonDetailUi } from './lesson-detail-i18n';

describe('getLessonDetailUi', () => {
    it('returns Russian strings for "ru"', () => {
        const ui = getLessonDetailUi('ru');
        expect(ui.noteLabel).toBe('Заметка');
        expect(ui.save).toBe('Сохранить');
        expect(ui.delete).toBe('Удалить');
        expect(ui.saved).toBe('Заметка сохранена');
        expect(ui.deleted).toBe('Заметка удалена');
        expect(ui.confirmDelete).toBe('Удалить эту заметку?');
        expect(ui.hasNoteIndicator).toBe('У этой пары есть заметка');
        expect(ui.charsLeft(12, 500)).toBe('12/500');
    });

    it('returns Kazakh strings for "kz"', () => {
        const ui = getLessonDetailUi('kz');
        expect(ui.noteLabel).toBe('Жазба');
        expect(ui.save).toBe('Сақтау');
        expect(ui.delete).toBe('Жою');
        expect(ui.saved).toBe('Жазба сақталды');
        expect(ui.deleted).toBe('Жазба жойылды');
        expect(ui.confirmDelete).toBe('Бұл жазбаны жою керек пе?');
        expect(ui.hasNoteIndicator).toBe('Бұл сабақта жазба бар');
        expect(ui.charsLeft(0, 500)).toBe('0/500');
    });

    it('returns English strings for "en"', () => {
        const ui = getLessonDetailUi('en');
        expect(ui.noteLabel).toBe('Note');
        expect(ui.save).toBe('Save');
        expect(ui.delete).toBe('Delete');
        expect(ui.saved).toBe('Note saved');
        expect(ui.deleted).toBe('Note deleted');
        expect(ui.confirmDelete).toBe('Delete this note?');
        expect(ui.hasNoteIndicator).toBe('This lesson has a note');
        expect(ui.charsLeft(500, 500)).toBe('500/500');
    });
});
