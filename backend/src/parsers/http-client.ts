/**
 * HTTP клиент для парсинга KSTU
 * Замена Playwright на быстрые HTTP запросы
 */

import axios, { type AxiosInstance } from 'axios';
import * as https from 'https';

const BASE_URL = 'https://univer.kstu.kz';
const API_URL = 'https://univerapi.kstu.kz';

// Типы для cookies
export interface KSTUCookies {
    '.ASPXAUTH': string;
    'ASP.NET_SessionId': string;
    'user_login'?: string;
}

// HTTP клиент с keep-alive
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    timeout: 30000,
});

// Базовый axios instance
const client: AxiosInstance = axios.create({
    timeout: 15000,
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
    },
    maxRedirects: 5,
    validateStatus: (status) => status < 500,
});

/**
 * Форматирует cookies в строку для заголовка
 */
export function formatCookies(cookies: KSTUCookies): string {
    return Object.entries(cookies)
        .filter(([_, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

/**
 * Парсит Set-Cookie заголовки
 */
export function parseCookies(setCookieHeaders: string[] | undefined): Partial<KSTUCookies> {
    const cookies: Partial<KSTUCookies> = {};

    if (!setCookieHeaders) return cookies;

    for (const header of setCookieHeaders) {
        const match = header.match(/^([^=]+)=([^;]*)/);
        if (match) {
            const [, name, value] = match;
            if (name === '.ASPXAUTH' || name === 'ASP.NET_SessionId' || name === 'user_login') {
                cookies[name as keyof KSTUCookies] = value;
            }
        }
    }

    return cookies;
}

/**
 * GET запрос с cookies
 */
export async function httpGet(
    url: string,
    cookies: KSTUCookies,
    options: { referer?: string } = {}
): Promise<{ data: string; cookies: KSTUCookies; status: number }> {
    const headers: Record<string, string> = {
        Cookie: formatCookies(cookies),
    };

    if (options.referer) {
        headers['Referer'] = options.referer;
    }

    const response = await client.get(url, { headers });

    // Обновляем cookies из ответа
    const newCookies = parseCookies(response.headers['set-cookie']);
    const mergedCookies: KSTUCookies = { ...cookies, ...newCookies } as KSTUCookies;

    return {
        data: response.data,
        cookies: mergedCookies,
        status: response.status,
    };
}

/**
 * Скачивание файла (возвращает Buffer)
 */
export async function httpDownload(
    url: string,
    cookies: KSTUCookies
): Promise<{ data: Buffer; contentType: string; status: number }> {
    const response = await client.get(url, {
        headers: {
            Cookie: formatCookies(cookies),
        },
        responseType: 'arraybuffer',
        timeout: 60000, // Больше времени для файлов
    });

    return {
        data: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'application/octet-stream',
        status: response.status,
    };
}

/**
 * Сериализует поля формы в `application/x-www-form-urlencoded` строку.
 * Экспортируется для unit-тестов changeUniverPassword.
 */
export function encodeFormBody(fields: Record<string, string>): string {
    return Object.entries(fields)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

/**
 * Смена пароля на univer.kstu.kz.
 *
 * Алгоритм:
 *   1. Логин через существующий `login()`.
 *   2. GET /user/pass/ для прогрева cookies/CSRF и проверки доступности страницы.
 *   3. POST /user/pass/ с form-encoded body (pass1, pass2, oldpass, makechangepass).
 *
 * Возвращает `success: false` если шаги не прошли. Проверка факта смены пароля
 * (повторный login с новым паролем) выполняется на уровне route, не здесь.
 */
export async function changeUniverPassword(
    username: string,
    currentPassword: string,
    newPassword: string
): Promise<{ success: boolean; status?: number; error?: string }> {
    console.log(`[HTTP Client] changeUniverPassword: starting for ${username}`);

    const cookies = await login(username, currentPassword);
    if (!cookies) {
        return { success: false, error: 'login_failed' };
    }

    const passUrl = `${BASE_URL}/user/pass/`;

    try {
        const getResponse = await client.get(passUrl, {
            headers: {
                Cookie: formatCookies(cookies),
            },
            validateStatus: () => true,
        });

        if (getResponse.status >= 400) {
            console.log(`[HTTP Client] changeUniverPassword: GET /user/pass/ status=${getResponse.status}`);
            return { success: false, status: getResponse.status, error: 'pass_page_unavailable' };
        }

        const mergedCookies: KSTUCookies = {
            ...cookies,
            ...parseCookies(getResponse.headers['set-cookie']),
        } as KSTUCookies;

        const body = encodeFormBody({
            pass1: newPassword,
            pass2: newPassword,
            oldpass: currentPassword,
            makechangepass: '1',
        });

        const postResponse = await client.post(passUrl, body, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': formatCookies(mergedCookies),
                'Referer': passUrl,
                'Origin': BASE_URL,
            },
            maxRedirects: 5,
            validateStatus: () => true,
        });

        if (postResponse.status >= 400) {
            console.log(`[HTTP Client] changeUniverPassword: POST /user/pass/ status=${postResponse.status}`);
            return { success: false, status: postResponse.status, error: 'pass_post_failed' };
        }

        console.log(`[HTTP Client] changeUniverPassword: POST ok, status=${postResponse.status}`);
        return { success: true, status: postResponse.status };
    } catch (error) {
        console.error('[HTTP Client] changeUniverPassword error:', error instanceof Error ? error.message : 'unknown');
        return { success: false, error: 'network_error' };
    }
}

/**
 * Логин через univerapi.kstu.kz
 */
export async function login(username: string, password: string): Promise<KSTUCookies | null> {
    console.log(`[HTTP Client] Logging in as ${username}...`);

    try {
        // 1. Warmup request to main domain to establish ASP.NET_SessionId
        const warmupResponse = await client.get(BASE_URL, {
            maxRedirects: 5,
            validateStatus: () => true,
        });
        const warmupCookies = parseCookies(warmupResponse.headers['set-cookie']);
        const sessionId = warmupCookies['ASP.NET_SessionId'] || '';
        console.log(`[HTTP Client] Warmup: ASP.NET_SessionId=${sessionId ? 'obtained' : 'MISSING'}`);

        // 2. Login via API
        const url = `${API_URL}/?login=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

        const response = await client.get(url, {
            maxRedirects: 0,
            validateStatus: () => true,
        });

        const loginCookies = parseCookies(response.headers['set-cookie']);

        // 3. Check for auth cookie
        if (!loginCookies['.ASPXAUTH']) {
            console.log('[HTTP Client] Login failed: no .ASPXAUTH cookie');
            console.log('[HTTP Client] Response status:', response.status);
            return null;
        }

        console.log('[HTTP Client] Login successful');

        // 4. Merge cookies: use SessionId from warmup if login didn't provide one
        return {
            '.ASPXAUTH': loginCookies['.ASPXAUTH']!,
            'ASP.NET_SessionId': loginCookies['ASP.NET_SessionId'] || sessionId,
            'user_login': username,
        };
    } catch (error) {
        console.error('[HTTP Client] Login error:', error);
        return null;
    }
}

/**
 * Переключение языка на русский
 */
export async function switchToRussian(cookies: KSTUCookies): Promise<KSTUCookies> {
    console.log('[HTTP Client] Switching to Russian...');

    try {
        const { cookies: newCookies } = await httpGet(
            `${BASE_URL}/lang/change/ru/`,
            cookies
        );
        console.log('[HTTP Client] Language switched to Russian');
        return newCookies;
    } catch (error) {
        console.log('[HTTP Client] Could not switch language, continuing...');
        return cookies;
    }
}

/**
 * Проверка авторизации по HTML
 */
export function isLoggedIn(html: string): boolean {
    return !html.includes('login_form') &&
        !html.includes('action="/user/login"') &&
        !html.includes('Вход в систему');
}

export { BASE_URL };
