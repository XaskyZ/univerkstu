import { describe, it, expect } from 'vitest';
import { classifyUmkdMaterial } from './umkd-classify.js';

describe('classifyUmkdMaterial', () => {
    it('1. RU "Экзаменационные вопросы по математике" → strong', () => {
        const r = classifyUmkdMaterial({ title: 'Экзаменационные вопросы по математике' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('экзаменационные вопросы');
    });

    it('2. RU "Перечень экзаменационных вопросов 2025" → strong', () => {
        const r = classifyUmkdMaterial({ title: 'Перечень экзаменационных вопросов 2025' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('перечень экзаменационных вопросов');
    });

    it('3. RU "Вопросы к экзамену" + type "doc" → strong', () => {
        const r = classifyUmkdMaterial({ title: 'Вопросы к экзамену', type: 'doc' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('вопросы к экзамену');
    });

    it('4. EN "Exam Questions Final" → strong', () => {
        const r = classifyUmkdMaterial({ title: 'Exam Questions Final' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('exam questions');
    });

    it('5. KZ "Емтихан сұрақтары физика" → strong', () => {
        const r = classifyUmkdMaterial({ title: 'Емтихан сұрақтары физика' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('емтихан сұрақтары');
    });

    it('6. filename "ekz_voprosy_2024.pdf" → strong (filename pattern)', () => {
        const r = classifyUmkdMaterial({ filename: 'ekz_voprosy_2024.pdf' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('filename:');
    });

    it('7. "Экзамен 2024" + type "видео" → weak (lone exam word, short title)', () => {
        const r = classifyUmkdMaterial({ title: 'Экзамен 2024', type: 'видео' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('weak');
        expect(r.reason).toBe('exam word only');
    });

    // Decision: "Программа экзамена" → weak, not none.
    // The NEGATIVE_TOKEN list contains the exact phrase 'программа курса',
    // not the bare word 'программа'. Blocking 'программа' alone would also
    // reject legitimate "Программа экзаменационных вопросов" docs, so we
    // accept the false-positive risk here and surface it as 'weak' confidence.
    it('8. "Программа экзамена" → weak (documented decision: bare "программа" is NOT a negative token)', () => {
        const r = classifyUmkdMaterial({ title: 'Программа экзамена' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('weak');
        expect(r.reason).toBe('exam word only');
    });

    it('9. "Лекция 5: экзамен Гаусса" → none (negative "лекци")', () => {
        const r = classifyUmkdMaterial({ title: 'Лекция 5: экзамен Гаусса' });
        expect(r.kind).toBe('other');
        expect(r.confidence).toBe('none');
    });

    it('10. "Вопросы к лабораторной работе" → none (negative "лаборатор", no exam token)', () => {
        const r = classifyUmkdMaterial({ title: 'Вопросы к лабораторной работе' });
        expect(r.kind).toBe('other');
        expect(r.confidence).toBe('none');
    });

    it('11. "Тестовые вопросы" + type "Тест" → none (negative "тестов", no exam token)', () => {
        const r = classifyUmkdMaterial({ title: 'Тестовые вопросы', type: 'Тест' });
        expect(r.kind).toBe('other');
        expect(r.confidence).toBe('none');
    });

    it('12. "Билеты и вопросы экзамена" → medium (exam+question combo, no exact phrase)', () => {
        const r = classifyUmkdMaterial({ title: 'Билеты и вопросы экзамена' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('medium');
        expect(r.reason).toBe('exam+question');
    });

    it('13. "Syllabus.pdf" → none (negative "syllabus", no exam token)', () => {
        const r = classifyUmkdMaterial({ title: 'Syllabus.pdf', filename: 'Syllabus.pdf' });
        expect(r.kind).toBe('other');
        expect(r.confidence).toBe('none');
    });

    it('14. "questions for the exam.docx" → strong', () => {
        const r = classifyUmkdMaterial({ title: 'questions for the exam.docx' });
        expect(r.kind).toBe('exam-questions');
        expect(r.confidence).toBe('strong');
        expect(r.reason).toContain('questions for the exam');
    });

    // Extra sanity check: empty input → none.
    it('empty input returns none', () => {
        expect(classifyUmkdMaterial({})).toEqual({
            kind: 'other',
            confidence: 'none',
            reason: 'no match',
        });
    });
});
