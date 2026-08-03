/**
 * Локальный кеш для быстрой загрузки данных
 * Паттерн: Stale-While-Revalidate
 * - Показываем кешированные данные мгновенно
 * - В фоне запрашиваем свежие
 * - Обновляем UI когда придут
 */

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    version: string;
}

const CACHE_VERSION = 'v1';
const STARTUP_BOOTSTRAP_META_KEY = 'startup_bootstrap_meta_v1';

/**
 * Получить данные из кеша
 */
export function getFromCache<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;

    try {
        const raw = localStorage.getItem(`cache_${key}`);
        if (!raw) return null;

        const entry: CacheEntry<T> = JSON.parse(raw);

        // Проверяем версию кеша
        if (entry.version !== CACHE_VERSION) {
            localStorage.removeItem(`cache_${key}`);
            return null;
        }

        return entry.data;
    } catch {
        return null;
    }
}

/**
 * Сохранить данные в кеш
 */
export function saveToCache<T>(key: string, data: T): void {
    if (typeof window === 'undefined') return;

    try {
        const entry: CacheEntry<T> = {
            data,
            timestamp: Date.now(),
            version: CACHE_VERSION,
        };
        localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch (e) {
        // localStorage full or unavailable
        console.warn('Failed to save to cache:', e);
    }
}

/**
 * Получить возраст кеша в минутах
 */
export function getCacheAge(key: string): number | null {
    if (typeof window === 'undefined') return null;

    try {
        const raw = localStorage.getItem(`cache_${key}`);
        if (!raw) return null;

        const entry = JSON.parse(raw);
        const ageMs = Date.now() - entry.timestamp;
        return Math.floor(ageMs / 1000 / 60);
    } catch {
        return null;
    }
}

/**
 * Очистить весь кеш
 */
export function clearCache(): void {
    if (typeof window === 'undefined') return;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('cache_')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
}

/**
 * Ключи кеша
 */
export const CacheKeys = {
    SCHEDULE: 'schedule',
    EXAMS: 'exams',
    UMKD: 'umkd',
    PROFILE: 'profile',
    PROFILE_SUMMARY: 'profile_summary',
    ACADEMIC_CONTEXT: 'academic_context',
    PLATONUS_STATUS: 'platonus_status',
    PLATONUS_GPA: 'platonus_gpa',
    PLATONUS_GROUP: 'platonus_group',
} as const;

export type StartupBootstrapBlock = 'schedule' | 'exams' | 'profileSummary' | 'platonusSummary';
export type StartupBootstrapFreshness = 'warm' | 'cached' | 'stale' | 'missing';

export interface StartupBootstrapMeta {
    userId: string;
    hydratedAt: number;
    issuedAt: string;
    freshness: Partial<Record<StartupBootstrapBlock, StartupBootstrapFreshness>>;
}

export function getStartupBootstrapMeta(): StartupBootstrapMeta | null {
    if (typeof window === 'undefined') return null;

    try {
        const raw = sessionStorage.getItem(STARTUP_BOOTSTRAP_META_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as StartupBootstrapMeta;
    } catch {
        return null;
    }
}

export function saveStartupBootstrapMeta(meta: StartupBootstrapMeta): void {
    if (typeof window === 'undefined') return;

    try {
        sessionStorage.setItem(STARTUP_BOOTSTRAP_META_KEY, JSON.stringify(meta));
    } catch {
        // Ignore session storage failures.
    }
}

export function clearStartupBootstrapMeta(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(STARTUP_BOOTSTRAP_META_KEY);
}

export function hasRecentStartupBootstrapBlock(
    block: StartupBootstrapBlock,
    maxAgeMs: number
): boolean {
    const meta = getStartupBootstrapMeta();
    if (!meta) return false;

    if (Date.now() - meta.hydratedAt > maxAgeMs) {
        return false;
    }

    const freshness = meta.freshness[block];
    return Boolean(freshness && freshness !== 'missing');
}
