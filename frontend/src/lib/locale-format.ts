import type { AppLanguage } from './language-context';

/**
 * Map the app language to a BCP-47 locale tag for `Intl` / `toLocaleString`
 * date and number formatting. Keeps date formatting consistent with the UI
 * language instead of always rendering Russian-style dates.
 */
export function localeTag(language: AppLanguage): string {
    return language === 'en' ? 'en-US' : language === 'kz' ? 'kk-KZ' : 'ru-RU';
}
