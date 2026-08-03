import { describe, expect, it } from 'vitest';
import { getHistoryUi, letterGradeTone } from './history-i18n';

describe('getHistoryUi', () => {
    it('returns a Russian payload for ru', () => {
        const ui = getHistoryUi('ru');
        expect(ui.screenTitle).toBe('Академическая история');
        expect(ui.recbookSection).toBe('Зачётка');
        expect(ui.transcriptSection).toBe('Академическая выписка');
        expect(ui.historyLinkLabel).toBe('Академическая история');
    });

    it('returns a Kazakh payload for kz', () => {
        const ui = getHistoryUi('kz');
        expect(ui.screenTitle).toBe('Академиялық тарих');
        expect(ui.recbookSection).toBe('Сынақ кітапшасы');
        expect(ui.transcriptSection).toBe('Академиялық анықтама');
        expect(ui.back).toBe('Артқа');
    });

    it('returns an English payload for en', () => {
        const ui = getHistoryUi('en');
        expect(ui.screenTitle).toBe('Academic history');
        expect(ui.recbookSection).toBe('Record book');
        expect(ui.transcriptSection).toBe('Academic transcript');
        expect(ui.refresh).toBe('Refresh');
    });

    it('keeps locale shapes in parity (no missing keys)', () => {
        const ru = getHistoryUi('ru');
        const kz = getHistoryUi('kz');
        const en = getHistoryUi('en');
        const keys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(keys);
        expect(Object.keys(en).sort()).toEqual(keys);
    });
});

describe('letterGradeTone', () => {
    it('maps A and A- to success', () => {
        expect(letterGradeTone('A')).toBe('success');
        expect(letterGradeTone('A-')).toBe('success');
    });

    it('maps B family to info', () => {
        expect(letterGradeTone('B')).toBe('info');
        expect(letterGradeTone('B+')).toBe('info');
        expect(letterGradeTone('B-')).toBe('info');
    });

    it('maps C/D family to warning', () => {
        expect(letterGradeTone('C')).toBe('warning');
        expect(letterGradeTone('C-')).toBe('warning');
        expect(letterGradeTone('D+')).toBe('warning');
    });

    it('maps F and FX to danger', () => {
        expect(letterGradeTone('F')).toBe('danger');
        expect(letterGradeTone('FX')).toBe('danger');
    });

    it('returns muted for empty input', () => {
        expect(letterGradeTone(null)).toBe('muted');
        expect(letterGradeTone(undefined)).toBe('muted');
        expect(letterGradeTone('')).toBe('muted');
    });
});
