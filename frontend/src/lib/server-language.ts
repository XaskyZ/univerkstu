import { cookies } from 'next/headers';
import type { AppLanguage } from './language-context';

export const LANGUAGE_COOKIE_KEY = 'app-language';

export async function getServerLanguage(): Promise<AppLanguage> {
    const cookieStore = await cookies();
    const value = cookieStore.get(LANGUAGE_COOKIE_KEY)?.value;
    return value === 'ru' || value === 'kz' || value === 'en' ? value : 'ru';
}

export function getLanguageLocale(language: AppLanguage) {
    if (language === 'kz') return 'kk_KZ';
    if (language === 'en') return 'en_US';
    return 'ru_RU';
}
