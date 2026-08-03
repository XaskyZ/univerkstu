/**
 * Maps a free-form UMKD course name to one of 32 fixed category keys.
 *
 * Why this exists:
 *   The UMKD tile grid renders a category-specific hand-drawn icon for each
 *   course. Course names are messy ("Математическая физика", "Программирование
 *   баз данных", "ОБЖ и охрана труда", …) — we need a deterministic, locale-
 *   aware match that prefers the *most specific* category when keywords clash.
 *
 * Algorithm:
 *   Each category has a list of keywords (lowercased substrings) and a
 *   priority. The category with the highest priority of any matched keyword
 *   wins. Ties are broken by category order. Falls through to `default`.
 *
 * Priority levers (deliberate):
 *   - "databases" > "programming" so "программирование баз данных" → databases
 *   - "physics" adjective ("физическая/физико") > "math" so
 *     "математическая физика" → physics
 *   - "chemistry" noun ("химия") > "physics" adjective so
 *     "физическая химия" → chemistry
 *   - "philosophy" picks up "логика" / "этика" explicitly.
 */

export type UmkdCategoryKey =
    | 'programming'
    | 'databases'
    | 'networks'
    | 'infosec'
    | 'cad'
    | 'math'
    | 'physics'
    | 'chemistry'
    | 'biology'
    | 'ecology'
    | 'geology'
    | 'mining'
    | 'mechanical'
    | 'electrical'
    | 'automation'
    | 'transport'
    | 'construction'
    | 'safety'
    | 'economics'
    | 'law'
    | 'philosophy'
    | 'history'
    | 'politology'
    | 'culturology'
    | 'kazakh'
    | 'russian'
    | 'english'
    | 'pe'
    | 'military'
    | 'pedagogy'
    | 'research'
    | 'default';

interface CategoryRule {
    key: UmkdCategoryKey;
    priority: number;
    keywords: string[];
}

// Keywords are matched as case-insensitive substrings of the normalised name.
// `priority` is integer — higher wins. Default rule entries land at priority 1;
// "noun beats adjective" entries land at 3+; sharp disambiguators at 5+.
const RULES: CategoryRule[] = [
    {
        key: 'databases',
        priority: 6,
        keywords: ['баз данных', 'базы данных', 'базам данных', 'базах данных', 'subd', 'субд', 'database', 'sql', 'дерекқор'],
    },
    {
        key: 'chemistry',
        priority: 5,
        keywords: ['хими', 'chemi', 'химия', 'химик', 'химические'],
    },
    {
        key: 'physics',
        priority: 4,
        keywords: [
            'физик', 'physic', 'механика жидкост', 'термодинамик', 'оптик',
            'квантов', 'электромагнетизм',
        ],
    },
    {
        key: 'philosophy',
        priority: 4,
        keywords: ['философ', 'логик', 'этик', 'эстетик', 'philosoph', 'logic'],
    },
    {
        key: 'infosec',
        priority: 4,
        keywords: ['информационн', 'безопасност', 'кибербезоп', 'защит', 'крипто', 'security', 'хакер'],
    },
    {
        key: 'networks',
        priority: 4,
        keywords: ['сет', 'network', 'tcp', 'протокол', 'интернет вещей', 'cisco', 'желі'],
    },
    {
        key: 'automation',
        priority: 4,
        keywords: ['автоматиз', 'роботот', 'мехатрон', 'plc', 'асу', 'scada', 'управлени'],
    },
    {
        key: 'cad',
        priority: 4,
        keywords: ['автокад', 'autocad', 'cad', 'инженерн', 'начертатель', 'черчение', 'компас 3d'],
    },
    {
        key: 'programming',
        priority: 3,
        keywords: [
            'программир', 'программ', 'кодинг', 'алгоритм', 'objective',
            'питон', 'python', 'java', 'c++', 'c#', 'web', 'веб', 'frontend',
            'backend', 'software', 'разработка по',
        ],
    },
    {
        key: 'math',
        priority: 3,
        keywords: [
            'математик', 'высшая математика', 'дискретн', 'статистик', 'теория вероятност',
            'линейн', 'matemat', 'mathematic', 'алгебра', 'геометрия', 'математикалық',
        ],
    },
    {
        key: 'biology',
        priority: 4,
        keywords: ['биолог', 'микробиолог', 'biology', 'анатоми', 'ботан'],
    },
    {
        key: 'ecology',
        priority: 4,
        keywords: ['эколог', 'ecology', 'окружающ', 'environment', 'устойчиво'],
    },
    {
        key: 'geology',
        priority: 4,
        keywords: ['геолог', 'минерало', 'петрограф', 'литолог'],
    },
    {
        key: 'mining',
        priority: 4,
        keywords: ['горн', 'рудн', 'добыч', 'обогащени', 'шахт', 'карьер', 'mining'],
    },
    {
        key: 'mechanical',
        priority: 3,
        keywords: ['механик', 'детали маш', 'мехатрон', 'сопромат', 'сопротивлени материа', 'mechanic'],
    },
    {
        key: 'electrical',
        priority: 4,
        keywords: ['электротехн', 'электрическ', 'электроэнер', 'electric'],
    },
    {
        key: 'transport',
        priority: 4,
        keywords: ['транспорт', 'логистик', 'автомоб', 'железнодорож', 'дорожн', 'transport'],
    },
    {
        key: 'construction',
        priority: 4,
        keywords: ['строитель', 'железобет', 'архитектур', 'construction', 'градостро'],
    },
    {
        // Higher than `infosec` so "охрана труда и техника безопасности" wins
        // over the broader "безопасност" infosec keyword.
        key: 'safety',
        priority: 5,
        keywords: ['охрана труд', 'обж', 'безопасност жизне', 'промышленная безоп', 'жизнедеятель', 'техника безопасност', 'тб'],
    },
    {
        key: 'economics',
        priority: 4,
        keywords: ['экономик', 'менеджмент', 'маркетинг', 'финанс', 'бухгалт', 'economic', 'business'],
    },
    {
        key: 'law',
        priority: 4,
        keywords: ['прав', 'юриспруден', 'правовед', 'трудовое право', 'конституц', 'юридическ', 'law', 'legal'],
    },
    {
        key: 'history',
        priority: 4,
        keywords: ['истори', 'history', 'археолог', 'хронолог', 'тарих'],
    },
    {
        key: 'politology',
        priority: 4,
        keywords: ['политолог', 'политическ', 'геополит', 'politic'],
    },
    {
        key: 'culturology',
        priority: 4,
        keywords: ['культуролог', 'культура', 'искусств', 'cultur', 'мәдениет', 'литератур'],
    },
    {
        key: 'kazakh',
        priority: 5,
        keywords: ['казахск', 'қазақ', 'kazakh', 'қазақша'],
    },
    {
        key: 'russian',
        priority: 5,
        keywords: ['русск', 'russian', 'русский язык'],
    },
    {
        key: 'english',
        priority: 5,
        keywords: ['английск', 'english', 'иностранн', 'foreign language', 'ағылшын'],
    },
    {
        key: 'pe',
        priority: 5,
        keywords: ['физическая культура', 'физкультур', 'спорт', 'physical educat', 'дене шынықт'],
    },
    {
        key: 'military',
        priority: 5,
        keywords: ['военн', 'воинск', 'нвп', 'начальная военная', 'military'],
    },
    {
        key: 'pedagogy',
        priority: 4,
        keywords: ['педагог', 'методика преподава', 'дидактик', 'воспитани', 'didactic', 'pedago'],
    },
    {
        key: 'research',
        priority: 4,
        keywords: [
            'научн', 'исследова', 'дипломн', 'курсова', 'диссертац',
            'нир', 'практик', 'research', 'thesis', 'practice', 'methodol',
        ],
    },
];

function normalise(input: string): string {
    return input
        .toLowerCase()
        .replace(/ё/g, 'е')
        // collapse whitespace and trim — keeps multiword keywords stable
        .replace(/\s+/g, ' ')
        .trim();
}

export function categorizeUmkdCourse(name: string): UmkdCategoryKey {
    const haystack = normalise(name);
    if (!haystack) return 'default';

    let best: { key: UmkdCategoryKey; priority: number } | null = null;
    for (const rule of RULES) {
        for (const keyword of rule.keywords) {
            if (!haystack.includes(keyword)) continue;
            if (!best || rule.priority > best.priority) {
                best = { key: rule.key, priority: rule.priority };
            }
            break; // one match per rule is enough
        }
    }
    return best ? best.key : 'default';
}

/**
 * Short aria-label / tooltip text per category, in three locales.
 * Keep these short — they're for accessibility, not the visible tile.
 */
export const UMKD_CATEGORY_LABEL: Record<UmkdCategoryKey, { ru: string; kz: string; en: string }> = {
    programming: { ru: 'Программирование', kz: 'Программалау', en: 'Programming' },
    databases: { ru: 'Базы данных', kz: 'Дерекқор', en: 'Databases' },
    networks: { ru: 'Сети', kz: 'Желілер', en: 'Networks' },
    infosec: { ru: 'Информационная безопасность', kz: 'Ақпараттық қауіпсіздік', en: 'Information security' },
    cad: { ru: 'Инженерная графика / CAD', kz: 'Инженерлік графика', en: 'Engineering graphics / CAD' },
    math: { ru: 'Математика', kz: 'Математика', en: 'Mathematics' },
    physics: { ru: 'Физика', kz: 'Физика', en: 'Physics' },
    chemistry: { ru: 'Химия', kz: 'Химия', en: 'Chemistry' },
    biology: { ru: 'Биология', kz: 'Биология', en: 'Biology' },
    ecology: { ru: 'Экология', kz: 'Экология', en: 'Ecology' },
    geology: { ru: 'Геология', kz: 'Геология', en: 'Geology' },
    mining: { ru: 'Горное дело', kz: 'Тау-кен ісі', en: 'Mining' },
    mechanical: { ru: 'Механика', kz: 'Механика', en: 'Mechanical engineering' },
    electrical: { ru: 'Электротехника', kz: 'Электротехника', en: 'Electrical engineering' },
    automation: { ru: 'Автоматизация', kz: 'Автоматтандыру', en: 'Automation' },
    transport: { ru: 'Транспорт', kz: 'Көлік', en: 'Transport' },
    construction: { ru: 'Строительство', kz: 'Құрылыс', en: 'Construction' },
    safety: { ru: 'Охрана труда / БЖД', kz: 'Еңбек қауіпсіздігі', en: 'Occupational safety' },
    economics: { ru: 'Экономика', kz: 'Экономика', en: 'Economics' },
    law: { ru: 'Право', kz: 'Құқық', en: 'Law' },
    philosophy: { ru: 'Философия', kz: 'Философия', en: 'Philosophy' },
    history: { ru: 'История', kz: 'Тарих', en: 'History' },
    politology: { ru: 'Политология', kz: 'Саясаттану', en: 'Political science' },
    culturology: { ru: 'Культурология', kz: 'Мәдениеттану', en: 'Cultural studies' },
    kazakh: { ru: 'Казахский язык', kz: 'Қазақ тілі', en: 'Kazakh language' },
    russian: { ru: 'Русский язык', kz: 'Орыс тілі', en: 'Russian language' },
    english: { ru: 'Английский язык', kz: 'Ағылшын тілі', en: 'English language' },
    pe: { ru: 'Физкультура', kz: 'Дене шынықтыру', en: 'Physical education' },
    military: { ru: 'Военная подготовка', kz: 'Әскери дайындық', en: 'Military training' },
    pedagogy: { ru: 'Педагогика', kz: 'Педагогика', en: 'Pedagogy' },
    research: { ru: 'Научная работа / практика', kz: 'Ғылыми жұмыс / тәжірибе', en: 'Research / practice' },
    default: { ru: 'Учебный материал', kz: 'Оқу материалы', en: 'Study material' },
};
