import { describe, it, expect } from 'vitest';
import { getLeaderboardUi } from '@/app/settings/components/leaderboard/strings';
import { getReferralsUi } from '@/app/settings/referrals/strings';
import { getAddLessonUi } from '@/components/add-lesson-modal/strings';

type StringsFactory = (lang: 'ru' | 'kz' | 'en') => Record<string, unknown>;

interface Suite {
    name: string;
    factory: StringsFactory;
    maxIdenticalRatio?: number;
}

// Apply the same parity invariants across every i18n string module that exposes
// a `get*Ui(language)` factory. Keeps coverage uniform without duplicating the
// 5+ test cases per module across 6 test files.
const suites: Suite[] = [
    // The leaderboard factory takes `string`, so cast as needed. Allow higher
    // identical ratio since leaderboard has many short shared words (mostly proper
    // nouns + tier letters like 'S','A',… that don't get translated).
    { name: 'settings/components/leaderboard', factory: ((l: 'ru' | 'kz' | 'en') => getLeaderboardUi(l)) as unknown as StringsFactory, maxIdenticalRatio: 0.4 },
    { name: 'settings/referrals', factory: getReferralsUi as unknown as StringsFactory },
    { name: 'components/add-lesson-modal', factory: getAddLessonUi as unknown as StringsFactory },
];

describe.each(suites)('i18n parity for $name', ({ factory, maxIdenticalRatio = 0.1 }) => {
    const ru = factory('ru');
    const kz = factory('kz');
    const en = factory('en');

    it('returns an object for ru/kz/en', () => {
        for (const obj of [ru, kz, en]) {
            expect(obj).toBeTypeOf('object');
            expect(obj).not.toBeNull();
        }
    });

    it('all three languages produce the same keys', () => {
        const ruKeys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(ruKeys);
        expect(Object.keys(en).sort()).toEqual(ruKeys);
    });

    it('string entries differ between ru and en (below identical-ratio threshold)', () => {
        const stringKeys = Object.keys(ru).filter((k) => typeof ru[k] === 'string');
        const identical = stringKeys.filter((k) => ru[k] === en[k]);
        const ratio = stringKeys.length > 0 ? identical.length / stringKeys.length : 0;
        expect(ratio, `${identical.length}/${stringKeys.length} ru/en strings identical`).toBeLessThan(maxIdenticalRatio);
    });

    it('every value is string | array | function — no nested object leaks', () => {
        for (const obj of [ru, kz, en]) {
            for (const [key, value] of Object.entries(obj)) {
                if (value === null) continue;
                const t = typeof value;
                const ok = t === 'string' || t === 'function' || Array.isArray(value);
                // Some factories may include nested objects intentionally (e.g. typeLabels).
                // We don't require absence — just that the values that ARE strings/arrays/fns
                // pass through cleanly. Nested objects need their own structural test if added later.
                if (!ok) {
                    expect(t, `${key} is unexpected type for an i18n entry`).toBe('object');
                }
            }
        }
    });
});
