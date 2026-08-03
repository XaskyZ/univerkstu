import type { DetailedPlatonusGrade, PlatonusSubjectGrade } from '@/lib/api';

export function languageAwareAcademicLabel(
    kind: 'srsp' | 'lab' | 'practice' | 'lecture',
    language: 'ru' | 'kz' | 'en'
): string {
    const isEnglish = language === 'en';
    const isKazakh = language === 'kz';

    if (kind === 'srsp') return isEnglish ? 'SRSP' : isKazakh ? 'Оқытушымен СӨЖ' : 'СРСП';
    if (kind === 'lab') return isEnglish ? 'Lab work' : isKazakh ? 'Зертханалық жұмыс' : 'Лабораторная работа';
    if (kind === 'practice') return isEnglish ? 'Practice' : isKazakh ? 'Практика' : 'Практика';
    return isEnglish ? 'Lecture' : isKazakh ? 'Дәріс' : 'Лекция';
}

export function extractAcademicCodeParts(value?: string | null): { base: string; suffix: string | null } {
    if (!value) return { base: '', suffix: null };
    const trimmed = value.trim();
    const match = trimmed.match(/^(.*?)(?:--?)(SRSP|Lab|P|L)$/i);
    if (!match) {
        return { base: trimmed, suffix: null };
    }

    return {
        base: match[1].replace(/[-\s]+$/, '').trim(),
        suffix: match[2].toUpperCase(),
    };
}

export function humanizeAcademicSuffix(
    suffix: string | null,
    language: 'ru' | 'kz' | 'en'
): string | null {
    if (!suffix) return null;
    if (suffix === 'SRSP') return languageAwareAcademicLabel('srsp', language);
    if (suffix === 'LAB') return languageAwareAcademicLabel('lab', language);
    if (suffix === 'P') return languageAwareAcademicLabel('practice', language);
    if (suffix === 'L') return languageAwareAcademicLabel('lecture', language);
    return suffix;
}

/**
 * Тип записи журнала оценок приходит с бэкенда как один из литералов
 * 'РК' / 'Текущая' / 'Экзамен' (см. `item.type` в `DetailedPlatonusGrade`) —
 * бэкенд их не переводит, локализуем на клиенте. Всё незнакомое — как есть.
 */
export function translateJournalEntryType(
    type: string | null | undefined,
    language: 'ru' | 'kz' | 'en'
): string | null {
    const trimmed = type?.trim();
    if (!trimmed) return null;

    if (trimmed === 'РК') {
        return language === 'en' ? 'Midterm' : language === 'kz' ? 'Аралық бақылау' : 'Рубежный контроль';
    }
    if (trimmed === 'Текущая') {
        return language === 'en' ? 'Coursework' : language === 'kz' ? 'Ағымдағы баға' : 'Текущая оценка';
    }
    if (trimmed === 'Экзамен') {
        return language === 'en' ? 'Exam' : language === 'kz' ? 'Емтихан' : 'Экзамен';
    }

    return trimmed;
}

export function getReadableDetailedGradeTitle(
    item: DetailedPlatonusGrade,
    subject: PlatonusSubjectGrade,
    language: 'ru' | 'kz' | 'en'
): string {
    const rawTitle = item.title?.trim();
    const subjectName = subject.name.trim();

    if (!rawTitle) {
        return item.type || subjectName;
    }

    const titleParts = extractAcademicCodeParts(rawTitle);
    const titleSuffix = humanizeAcademicSuffix(titleParts.suffix, language);

    if (!titleSuffix) {
        return rawTitle;
    }
    return titleSuffix;
}
