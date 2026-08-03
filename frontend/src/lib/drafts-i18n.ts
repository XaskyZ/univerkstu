/**
 * Local i18n factory for the composer-draft restore hint surface.
 *
 * Pure function — no React, no DOM, no storage. Mirrors the `get*Ui(language)`
 * factory pattern used elsewhere in the project (see `comments-thread-i18n`,
 * `reactions-i18n`, etc.). Kept next to the hook in `lib/` since the hint
 * surface is shared across many composer scopes and there is no single home
 * component to colocate with.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface DraftUi {
    /**
     * Short banner copy shown above a composer when an unsent draft has been
     * restored from localStorage. Phrased as a passive notice — no action
     * required from the user. The close affordance (and 10s auto-dismiss)
     * lives in the component.
     */
    draftRestoredHint: string;
}

export function getDraftUi(language: Lang): DraftUi {
    if (language === 'kz') {
        return {
            draftRestoredHint: 'Сақталмаған жоба қалпына келтірілді',
        };
    }
    if (language === 'en') {
        return {
            draftRestoredHint: 'Unsent draft restored',
        };
    }
    return {
        draftRestoredHint: 'Восстановлен черновик',
    };
}
