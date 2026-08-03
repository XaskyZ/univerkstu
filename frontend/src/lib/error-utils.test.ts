import { describe, it, expect } from 'vitest';
import { toUserErrorMessage } from './error-utils';

describe('toUserErrorMessage', () => {
    const FALLBACK = 'Что-то пошло не так';

    it('returns the original error message when nothing special matches', () => {
        expect(toUserErrorMessage({ error: 'Random failure', fallback: FALLBACK }))
            .toBe('Random failure');
    });

    it('returns fallback when error is empty', () => {
        expect(toUserErrorMessage({ error: '', fallback: FALLBACK })).toBe(FALLBACK);
        expect(toUserErrorMessage({ fallback: FALLBACK })).toBe(FALLBACK);
    });

    it('routes UPSTREAM_AUTH_TEMPORARY to dedicated message', () => {
        const msg = toUserErrorMessage({
            errorCode: 'UPSTREAM_AUTH_TEMPORARY',
            fallback: FALLBACK,
            language: 'ru',
        });
        expect(msg).toContain('временно отклонил сессию');
    });

    it('routes PLATONUS_AUTH_REQUIRED with language-specific copy', () => {
        expect(toUserErrorMessage({ errorCode: 'PLATONUS_AUTH_REQUIRED', fallback: FALLBACK, language: 'ru' }))
            .toContain('Platonus');
        expect(toUserErrorMessage({ errorCode: 'PLATONUS_AUTH_REQUIRED', fallback: FALLBACK, language: 'en' }))
            .toContain('Exam data');
        expect(toUserErrorMessage({ errorCode: 'PLATONUS_AUTH_REQUIRED', fallback: FALLBACK, language: 'kz' }))
            .toContain('Емтихан');
    });

    it('routes 401 to relogin message', () => {
        const msg = toUserErrorMessage({ statusCode: 401, fallback: FALLBACK, language: 'ru' });
        expect(msg).toContain('Сессия');
    });

    it('routes AUTH_RELOGIN_REQUIRED to the same relogin message', () => {
        const a = toUserErrorMessage({ errorCode: 'AUTH_RELOGIN_REQUIRED', fallback: FALLBACK, language: 'ru' });
        const b = toUserErrorMessage({ statusCode: 401, fallback: FALLBACK, language: 'ru' });
        expect(a).toBe(b);
    });

    it('routes 429 to rate-limit message', () => {
        const msg = toUserErrorMessage({ statusCode: 429, fallback: FALLBACK, language: 'ru' });
        expect(msg).toContain('лимит');
    });

    it('routes "Too many requests" in error text to rate-limit', () => {
        const msg = toUserErrorMessage({ error: 'Too many requests on Y endpoint', fallback: FALLBACK, language: 'en' });
        expect(msg).toContain('Request limit');
    });

    it('routes 502/503/504 to university-unavailable', () => {
        for (const code of [502, 503, 504]) {
            const msg = toUserErrorMessage({ statusCode: code, fallback: FALLBACK, language: 'ru' });
            expect(msg).toContain('временно недоступен');
        }
    });

    it('routes "unavailable" substring (case-insensitive) to university-unavailable', () => {
        const msg = toUserErrorMessage({ error: 'service UNAVAILABLE right now', fallback: FALLBACK, language: 'ru' });
        expect(msg).toContain('временно недоступен');
    });

    it('routes statusCode 0 to poor-connection', () => {
        const msg = toUserErrorMessage({ statusCode: 0, fallback: FALLBACK, language: 'ru' });
        expect(msg).toContain('Плохое соединение');
    });

    it('routes "Network" / "Failed to fetch" to poor-connection', () => {
        expect(toUserErrorMessage({ error: 'Network Error', fallback: FALLBACK, language: 'en' }))
            .toContain('Poor connection');
        expect(toUserErrorMessage({ error: 'Failed to fetch', fallback: FALLBACK, language: 'en' }))
            .toContain('Poor connection');
    });

    it('routes localized network-hint substring to poor-connection', () => {
        // ru: "ошибка сети", kz: "желі қатесі"
        expect(toUserErrorMessage({ error: 'произошла ошибка сети', fallback: FALLBACK, language: 'ru' }))
            .toContain('Плохое соединение');
        expect(toUserErrorMessage({ error: 'желі қатесі болды', fallback: FALLBACK, language: 'kz' }))
            .toContain('Байланыс нашар');
    });

    it('defaults to Russian when no language provided', () => {
        const msg = toUserErrorMessage({ statusCode: 401, fallback: FALLBACK });
        // Should contain Russian word for "expired" — the RU branch
        expect(msg).toContain('Сессия');
    });

    it('UPSTREAM_AUTH_TEMPORARY differs by language', () => {
        const ru = toUserErrorMessage({ errorCode: 'UPSTREAM_AUTH_TEMPORARY', fallback: FALLBACK, language: 'ru' });
        const en = toUserErrorMessage({ errorCode: 'UPSTREAM_AUTH_TEMPORARY', fallback: FALLBACK, language: 'en' });
        const kz = toUserErrorMessage({ errorCode: 'UPSTREAM_AUTH_TEMPORARY', fallback: FALLBACK, language: 'kz' });
        expect(ru).not.toBe(en);
        expect(en).not.toBe(kz);
        expect(en).toContain('university server');
        expect(kz).toContain('Университет сервері');
    });

    it('errorCode wins over statusCode for the same input', () => {
        // PLATONUS_AUTH_REQUIRED should fire even with 401 status (it appears first in the chain)
        const msg = toUserErrorMessage({
            errorCode: 'PLATONUS_AUTH_REQUIRED',
            statusCode: 401,
            fallback: FALLBACK,
            language: 'ru',
        });
        expect(msg).toContain('Platonus');
    });
});
