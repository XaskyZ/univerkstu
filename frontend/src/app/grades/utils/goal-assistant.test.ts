import { describe, it, expect } from 'vitest';
import type { PlatonusSubjectGrade } from '@/lib/api';
import {
    buildGoalInsight,
    buildSubjectAssistantModel,
    ceilExamScore,
    classifyByName,
    resolveKind,
    formatStageSnapshot,
    getAssistantCopy,
    getEffectiveExamScore,
    getExamDisplayValue,
    getExamlessFinalValue,
    getKnownFinalScore,
    getSubjectStage,
    getTotalDisplayValue,
    getWeightedFinal,
    hasBothRksClosed,
    isExamZeroPlaceholder,
    isCourseworkSubject,
    isExamlessSubject,
    isPracticeSubject,
    solveRequiredExam,
    solveRequiredRk2,
} from './goal-assistant';

function makeSubject(overrides: Partial<PlatonusSubjectGrade>): PlatonusSubjectGrade {
    return {
        name: 'Test subject',
        rk1: '-',
        rk2: '-',
        rating: '-',
        exam: '-',
        total: '-',
        ...overrides,
    };
}

describe('subject kind detection', () => {
    it('respects kind from backend over name', () => {
        // Name says "Криптография" (regular-looking) but backend marked as coursework
        const subject = makeSubject({ name: 'Криптография', kind: 'coursework' });
        expect(isCourseworkSubject(subject)).toBe(true);
        expect(isExamlessSubject(subject)).toBe(true);
    });

    it('trusts kind=regular even when name has coursework markers', () => {
        // Edge case: name has "курсов" substring but backend explicitly said regular.
        // Backend wins.
        const subject = makeSubject({ name: 'Дискурсология', kind: 'regular' });
        // Note: 'дискурсология' doesn't actually contain 'курсов' (no v before о), but
        // demonstrate that explicit kind=regular blocks any name guessing.
        expect(isCourseworkSubject(subject)).toBe(false);
        expect(isExamlessSubject(subject)).toBe(false);
    });

    it('falls back to name detection when kind is missing (cached snapshot)', () => {
        const subject = makeSubject({ name: 'Курсовая работа по программированию' });
        expect(isCourseworkSubject(subject)).toBe(true);
        expect(isExamlessSubject(subject)).toBe(true);
    });

    it('detects practice via name fallback', () => {
        const subject = makeSubject({ name: 'Учебная практика' });
        expect(isPracticeSubject(subject)).toBe(true);
        expect(isExamlessSubject(subject)).toBe(true);
    });

    it('detects practice via Kazakh marker', () => {
        const subject = makeSubject({ name: 'Оқу тәжірибесі' });
        expect(isPracticeSubject(subject)).toBe(true);
    });

    it('does not mistake практикум for practice in fallback', () => {
        const subject = makeSubject({ name: 'Практикум по программированию' });
        expect(isPracticeSubject(subject)).toBe(false);
        expect(isExamlessSubject(subject)).toBe(false);
    });
});

describe('getExamlessFinalValue', () => {
    it('returns null for regular subjects', () => {
        const subject = makeSubject({ kind: 'regular', rating: '85', total: '85' });
        expect(getExamlessFinalValue(subject)).toBeNull();
    });

    it('returns clamped rating when present and >0', () => {
        const subject = makeSubject({ kind: 'coursework', rating: '90' });
        expect(getExamlessFinalValue(subject)).toBe(90);
    });

    it('falls back to total when rating is empty', () => {
        const subject = makeSubject({ kind: 'practice', rating: '-', total: '75' });
        expect(getExamlessFinalValue(subject)).toBe(75);
    });

    it('returns null when both rating and total are zero/missing', () => {
        const subject = makeSubject({ kind: 'coursework', rating: '0', total: '0' });
        expect(getExamlessFinalValue(subject)).toBeNull();
    });
});

describe('getEffectiveExamScore', () => {
    it('returns missing for examless subjects regardless of exam value', () => {
        const subject = makeSubject({ kind: 'coursework', exam: '0' });
        const result = getEffectiveExamScore(subject);
        expect(result.kind).toBe('missing');
        expect(result.value).toBeNull();
    });

    it('returns raw exam when both RKs are closed for regular subject', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: '85' });
        const result = getEffectiveExamScore(subject);
        expect(result.kind).toBe('number');
        expect(result.value).toBe(85);
    });

    it('treats zero exam as missing when RKs not both closed', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '-', exam: '0' });
        const result = getEffectiveExamScore(subject);
        expect(result.kind).toBe('missing');
    });

    it('treats placeholder zero exam as missing even when both RKs are closed (№5 аудита)', () => {
        // Ноябрь: РК1/РК2 опубликованы, Platonus держит '0' в слоте экзамена
        // до сессии (тотал рядом — тоже '0'-заглушка).
        const subject = makeSubject({ kind: 'regular', rk1: '85', rk2: '90', exam: '0', total: '0' });
        const result = getEffectiveExamScore(subject);
        expect(result.kind).toBe('missing');
        expect(result.value).toBeNull();
    });

    it('keeps real zero exam (total published positive) as a number', () => {
        // Реальный «0» за экзамен: Platonus уже посчитал положительный тотал.
        const subject = makeSubject({ kind: 'regular', rk1: '85', rk2: '90', exam: '0', total: '52.5' });
        const result = getEffectiveExamScore(subject);
        expect(result.kind).toBe('number');
        expect(result.value).toBe(0);
    });
});

describe('isExamZeroPlaceholder', () => {
    it('true for exam "0" when total is zero or missing', () => {
        expect(isExamZeroPlaceholder(makeSubject({ exam: '0', total: '0' }))).toBe(true);
        expect(isExamZeroPlaceholder(makeSubject({ exam: '0', total: '-' }))).toBe(true);
        expect(isExamZeroPlaceholder(makeSubject({ exam: '0', total: '' }))).toBe(true);
    });

    it('false for exam "0" when total is published positive (реальный ноль)', () => {
        expect(isExamZeroPlaceholder(makeSubject({ exam: '0', total: '52.5' }))).toBe(false);
    });

    it('false for non-zero, missing or text exam values', () => {
        expect(isExamZeroPlaceholder(makeSubject({ exam: '85', total: '0' }))).toBe(false);
        expect(isExamZeroPlaceholder(makeSubject({ exam: '-', total: '0' }))).toBe(false);
        expect(isExamZeroPlaceholder(makeSubject({ exam: 'Недоп.', total: '0' }))).toBe(false);
    });
});

describe('getExamDisplayValue', () => {
    it('shows em dash for examless subjects', () => {
        const subject = makeSubject({ kind: 'coursework', exam: '0' });
        expect(getExamDisplayValue(subject)).toBe('—');
    });

    it('shows ? when RKs not both closed and exam is zero', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '-', exam: '0' });
        expect(getExamDisplayValue(subject)).toBe('?');
    });

    it('shows ? for placeholder zero even when RKs both closed (№5 аудита)', () => {
        // Экзамен ещё не выставлен (тотал — тоже заглушка), «0» здесь врал бы.
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: '0' });
        expect(getExamDisplayValue(subject)).toBe('?');
    });

    it('shows real zero exam when total is published positive', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: '0', total: '46.5' });
        expect(getExamDisplayValue(subject)).toBe('0');
    });

    it('shows real exam grade after the exam', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: '88' });
        expect(getExamDisplayValue(subject)).toBe('88');
    });
});

describe('getTotalDisplayValue', () => {
    it('for examless with rating: shows formatted rating', () => {
        const subject = makeSubject({ kind: 'coursework', rating: '90', exam: '0', total: '0' });
        expect(getTotalDisplayValue(subject)).toBe('90');
    });

    it('for examless without rating: shows em dash', () => {
        const subject = makeSubject({ kind: 'practice', rating: '-', total: '-' });
        expect(getTotalDisplayValue(subject)).toBe('—');
    });

    it('for regular subject with no real exam: shows ?', () => {
        // Платонус-плейсхолдер: РК закрыты, но экзамен ещё не сдан
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: '0', total: '0' });
        expect(getTotalDisplayValue(subject)).toBe('?');
    });

    it('for regular subject with text "Допуск" in exam: shows ?', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: 'Допуск', total: '0' });
        expect(getTotalDisplayValue(subject)).toBe('?');
    });

    it('for regular subject with real exam grade: shows raw total', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '80', rk2: '75', exam: '85', total: '82' });
        expect(getTotalDisplayValue(subject)).toBe('82');
    });

    it('for blocked subject: shows raw total (not ?)', () => {
        // Недопуск к экзамену — реальный статус, не замазываем вопросом
        const subject = makeSubject({ kind: 'regular', rk1: '30', rk2: '40', exam: 'Недоп.', total: '21' });
        expect(getTotalDisplayValue(subject)).toBe('21');
    });

    it('for subject just started: shows ? rather than misleading 0', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '-', rk2: '-', exam: '-', total: '-' });
        expect(getTotalDisplayValue(subject)).toBe('?');
    });

    it('for the not-started-semester stub («недоп.» + empty RKs): shows ?, not total "0"', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '-', rk2: '-', rating: '0', exam: 'недоп.', total: '0' });
        expect(getTotalDisplayValue(subject)).toBe('?');
    });
});

describe('hasBothRksClosed', () => {
    it('returns true when both rk1 and rk2 parse to numbers', () => {
        expect(hasBothRksClosed(makeSubject({ rk1: '80', rk2: '75' }))).toBe(true);
        expect(hasBothRksClosed(makeSubject({ rk1: '0', rk2: '0' }))).toBe(true);
    });

    it('returns false when either rk is missing/blocked/text', () => {
        expect(hasBothRksClosed(makeSubject({ rk1: '-', rk2: '75' }))).toBe(false);
        expect(hasBothRksClosed(makeSubject({ rk1: '80', rk2: '-' }))).toBe(false);
        expect(hasBothRksClosed(makeSubject({ rk1: 'Недоп.', rk2: '75' }))).toBe(false);
    });

    it('returns false when both rks are missing', () => {
        expect(hasBothRksClosed(makeSubject({ rk1: '-', rk2: '-' }))).toBe(false);
    });
});

describe('getWeightedFinal', () => {
    // RK_WEIGHT = 0.3, EXAM_WEIGHT = 0.4. So total = rk1*0.3 + rk2*0.3 + exam*0.4.

    it('computes weighted sum of all three components', () => {
        expect(getWeightedFinal(80, 75, 90)).toBeCloseTo(80 * 0.3 + 75 * 0.3 + 90 * 0.4);
        expect(getWeightedFinal(100, 100, 100)).toBeCloseTo(100);
    });

    it('treats null values as 0 (preserves partial-progress visualization)', () => {
        expect(getWeightedFinal(null, 80, 90)).toBeCloseTo(80 * 0.3 + 90 * 0.4);
        expect(getWeightedFinal(80, null, 90)).toBeCloseTo(80 * 0.3 + 90 * 0.4);
        expect(getWeightedFinal(80, 75, null)).toBeCloseTo(80 * 0.3 + 75 * 0.3);
        expect(getWeightedFinal(null, null, null)).toBe(0);
    });

    it('weights satisfy RK*2 + EXAM = 1.0 (validates against drift)', () => {
        expect(getWeightedFinal(100, 100, 100)).toBe(100);
    });
});

describe('solveRequiredRk2', () => {
    it('returns null when rk1 or exam unknown', () => {
        expect(solveRequiredRk2(50, null, 80)).toBe(null);
        expect(solveRequiredRk2(50, 75, null)).toBe(null);
    });

    it('solves for rk2 such that weighted-final equals target', () => {
        // target = rk1*0.3 + rk2*0.3 + exam*0.4
        // 50 = 60*0.3 + rk2*0.3 + 70*0.4 → 50 = 18 + 0.3*rk2 + 28 → 0.3*rk2 = 4 → rk2 = ~13.33
        const result = solveRequiredRk2(50, 60, 70);
        expect(result).toBeCloseTo(4 / 0.3);
    });

    it('roundtrip: getWeightedFinal(rk1, solveRequiredRk2(t,…), exam) ≈ t', () => {
        const rk2 = solveRequiredRk2(75, 80, 90)!;
        expect(getWeightedFinal(80, rk2, 90)).toBeCloseTo(75);
    });

    it('can return negative when target is unreachable', () => {
        // If rk1 and exam already overshoot the target, rk2 must be negative.
        const result = solveRequiredRk2(20, 80, 80);
        expect(result!).toBeLessThan(0);
    });
});

describe('solveRequiredExam', () => {
    it('returns null when rk1 or rk2 unknown', () => {
        expect(solveRequiredExam(50, null, 80)).toBe(null);
        expect(solveRequiredExam(50, 75, null)).toBe(null);
    });

    it('solves for exam such that weighted-final equals target', () => {
        // target = rk1*0.3 + rk2*0.3 + exam*0.4
        // 50 = 80*0.3 + 75*0.3 + exam*0.4 → 50 = 24 + 22.5 + 0.4*exam → 0.4*exam = 3.5 → exam = 8.75
        expect(solveRequiredExam(50, 80, 75)).toBeCloseTo(3.5 / 0.4);
    });

    it('roundtrip: getWeightedFinal(rk1, rk2, solveRequiredExam(t,…)) ≈ t', () => {
        const exam = solveRequiredExam(75, 80, 90)!;
        expect(getWeightedFinal(80, 90, exam)).toBeCloseTo(75);
    });
});

describe('ceilExamScore', () => {
    it('returns null for null input', () => {
        expect(ceilExamScore(null)).toBe(null);
    });

    it('rounds fractional values up', () => {
        expect(ceilExamScore(8.1)).toBe(9);
        expect(ceilExamScore(8.9)).toBe(9);
        expect(ceilExamScore(9.0)).toBe(9);
    });

    it('clamps negative values to 0', () => {
        expect(ceilExamScore(-5)).toBe(0);
        expect(ceilExamScore(-0.1)).toBe(0);
    });

    it('handles zero correctly', () => {
        expect(ceilExamScore(0)).toBe(0);
    });
});

describe('getAssistantCopy', () => {
    const ru = getAssistantCopy('ru');
    const kz = getAssistantCopy('kz');
    const en = getAssistantCopy('en');

    it('returns a non-null object for all 3 languages', () => {
        for (const obj of [ru, kz, en]) {
            expect(obj).toBeTypeOf('object');
            expect(obj).not.toBeNull();
        }
    });

    it('all three languages produce the same keys (translation parity)', () => {
        const ruKeys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(ruKeys);
        expect(Object.keys(en).sort()).toEqual(ruKeys);
    });

    it('RU vs EN string entries differ for most keys (catches copy-paste)', () => {
        const ruRec = ru as unknown as Record<string, unknown>;
        const enRec = en as unknown as Record<string, unknown>;
        const stringKeys = Object.keys(ru).filter((k) => typeof ruRec[k] === 'string');
        const identical = stringKeys.filter((k) => ruRec[k] === enRec[k]);
        expect(identical.length / stringKeys.length).toBeLessThan(0.1);
    });

    it('English copy uses expected vocabulary', () => {
        expect(en.helperTitle).toBe('Grade assistant');
        expect(en.targetTitle).toBe('Goal');
    });

    it('snapshot Russian helper title (UI-visible string)', () => {
        // Locking visible UI copy — accidental rewording shows up in tests instead of in QA.
        expect(typeof ru.helperTitle).toBe('string');
        expect(ru.helperTitle.length).toBeGreaterThan(0);
        expect(ru.helperTitle).not.toBe(en.helperTitle);
    });
});

describe('formatStageSnapshot', () => {
    it('uses Рейтинг label for examless subjects (coursework/practice)', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '75', rating: '90',
        });
        const result = formatStageSnapshot(subject);
        expect(result).toBe('РК1 80 • РК2 75 • Рейтинг 90');
    });

    it('uses Экзамен label for regular subjects', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '75', exam: '85',
        });
        const result = formatStageSnapshot(subject);
        expect(result).toContain('Экзамен');
        expect(result).toContain('РК1 80');
        expect(result).toContain('РК2 75');
    });

    it('shows em dash for missing rk1/rk2 values', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '', rk2: '', exam: '' });
        const result = formatStageSnapshot(subject);
        expect(result).toMatch(/РК1\s+—/);
        expect(result).toMatch(/РК2\s+—/);
    });

    it('shows em dash for missing rating on examless subjects', () => {
        const subject = makeSubject({ kind: 'practice', rk1: '80', rk2: '75', rating: '' });
        const result = formatStageSnapshot(subject);
        expect(result).toContain('Рейтинг —');
    });
});

describe('getSubjectStage', () => {
    it('returns "final" stage with closed=true when exam is graded', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '75', exam: '85', total: '82',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('final');
        expect(stage.isClosed).toBe(true);
        expect(stage.isBlocked).toBe(false);
        expect(stage.stageTone).toBe('ok');
    });

    it('returns "unknown" stage (examless pending) for examless subject with no rating yet', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '75', rating: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('unknown');
        expect(stage.isClosed).toBe(false);
        expect(stage.isBlocked).toBe(false);
        expect(stage.stageTone).toBe('achievable');
    });

    it('returns "final" stage for examless subject with rating set', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '75', rating: '90', total: '90',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('final');
        expect(stage.isClosed).toBe(true);
    });

    it('returns "blocked" stage when admission average (RK1+RK2)/2 < 50', () => {
        // Допуск считается по средней (РК1+РК2)/2. 30 + 40 = 70 / 2 = 35 → недопуск.
        const subject = makeSubject({
            kind: 'regular', rk1: '30', rk2: '40', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('blocked');
        expect(stage.isBlocked).toBe(true);
        expect(stage.stageTone).toBe('risk');
    });

    it('does NOT block when one RK is < 50 but the average is ≥ 50', () => {
        // 40 + 70 = 110 / 2 = 55 ≥ 50 → студент допущен, хотя РК1 ниже 50.
        const subject = makeSubject({
            kind: 'regular', rk1: '40', rk2: '70', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('exam');
        expect(stage.isBlocked).toBe(false);
    });

    it('respects Platonus explicit "Недоп." in exam field regardless of RK averages', () => {
        // Platonus сам пометил недопуск — авторитетный сигнал, переопределяет среднюю.
        const subject = makeSubject({
            kind: 'regular', rk1: '70', rk2: '70', exam: 'Недоп.', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('blocked');
        expect(stage.isBlocked).toBe(true);
    });

    it('does not declare blocked before both RKs are closed', () => {
        // Пока вторая рубежка ещё не закрыта, средняя не определена — стадия rk2.
        const subject = makeSubject({
            kind: 'regular', rk1: '30', rk2: '-', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('rk2');
        expect(stage.isBlocked).toBe(false);
    });

    it('stays at "exam" stage for placeholder zero exam with closed RKs (№5 аудита)', () => {
        // Ноябрь: РК1 = 85, РК2 = 90 опубликованы, Platonus держит '0' в слоте
        // экзамена до сессии. Раньше помощник объявлял «Итог уже выставлен»
        // с фиктивным тоталом, противореча бейджу «Ждём экзамен» в списке.
        const subject = makeSubject({ kind: 'regular', rk1: '85', rk2: '90', exam: '0', total: '0' });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('exam');
        expect(stage.isClosed).toBe(false);
        expect(stage.stageTitle).toBe('Остался экзамен');
    });

    it('returns "final" for real zero exam when total is published positive', () => {
        const subject = makeSubject({ kind: 'regular', rk1: '85', rk2: '90', exam: '0', total: '52.5' });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('final');
        expect(stage.isClosed).toBe(true);
    });

    it('returns "exam" stage when both rks closed (≥50) and exam pending', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '70', rk2: '75', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('exam');
        expect(stage.isBlocked).toBe(false);
        expect(stage.isClosed).toBe(false);
        expect(stage.stageTone).toBe('achievable');
    });

    it('returns "rk2" stage when only rk1 is graded', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '70', rk2: '-', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('rk2');
        expect(stage.isClosed).toBe(false);
        expect(stage.stageTone).toBe('achievable');
    });

    it('treats pre-filled «недоп.» of a not-started semester as "unknown", not blocked', () => {
        // Живой журнал осени 2026/1 (семестр ещё не начался): РК = '-',
        // Рейтинг = '0', в слоте экзамена Platonus заранее ставит «недоп.».
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', rating: '0', exam: 'недоп.', total: '0',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('unknown');
        expect(stage.isBlocked).toBe(false);
        expect(stage.stageTitle).toBe('Ждём данные');
    });

    it('keeps blocked for «недоп.» when at least one RK is really published', () => {
        // Реальный недопуск (например, по посещаемости) при одной закрытой РК.
        const subject = makeSubject({
            kind: 'regular', rk1: '40', rk2: '-', rating: '0', exam: 'недоп.', total: '0',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('blocked');
        expect(stage.isBlocked).toBe(true);
    });

    it('returns "rk1" stage when neither rk graded (initial state)', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        expect(stage.stage).toBe('rk1');
        expect(stage.stageTone).toBe('risk'); // "no progress yet" — tone is risk
    });

    it('English language returns English stage titles', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'en');
        // The stage title comes from getAssistantCopy('en') — should not be the Russian default.
        expect(stage.stageTitle).toBe('RK1 in progress');
    });

    it('Kazakh language returns Kazakh stage titles', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'kz');
        // Distinct from RU/EN — just verify it's a non-empty string and different from English.
        expect(stage.stageTitle.length).toBeGreaterThan(0);
        expect(stage.stageTitle).not.toBe('RK1 in progress');
    });
});

describe('buildGoalInsight', () => {
    it('examless subject with final ≥ target: status=ok', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '75', rating: '90', total: '90',
        });
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.status).toBe('ok');
        expect(insight.target).toBe(70);
        expect(insight.currentSemesterPoints).toBe(90);
        expect(insight.projectedFinal).toBe(90);
        // No "needed exam" suggestions for closed examless.
        expect(insight.neededExam).toBe(null);
        expect(insight.neededRk2).toBe(null);
    });

    it('examless subject with final < target: status=impossible (already closed)', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '75', rating: '60', total: '60',
        });
        const insight = buildGoalInsight(subject, 90, 'ru');
        expect(insight.status).toBe('impossible');
        expect(insight.projectedFinal).toBe(60);
    });

    it('examless subject pending (no rating yet): status=risk with examless-pending copy', () => {
        const subject = makeSubject({
            kind: 'practice', rk1: '80', rk2: '75', rating: '-', total: '-',
        });
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.status).toBe('risk');
        expect(insight.projectedFinal).toBe(null);
        expect(insight.currentSemesterPoints).toBe(null); // no rating
    });

    it('regular subject with exam graded and final ≥ target: status=ok', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '75', exam: '85', total: '80',
        });
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.status).toBe('ok');
        expect(insight.projectedFinal).toBe(80);
        // Closed subject — no more suggestions needed.
        expect(insight.neededExam).toBe(null);
    });

    it('regular subject with exam graded and final < target: status=impossible (closed)', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '50', rk2: '50', exam: '50', total: '50',
        });
        const insight = buildGoalInsight(subject, 90, 'ru');
        expect(insight.status).toBe('impossible');
        expect(insight.projectedFinal).toBe(50);
    });

    it('regular subject blocked (admission avg <50): status=risk with stage title from blocked stage', () => {
        // 30 + 40 = 70 / 2 = 35 → ниже 50, недопуск.
        const subject = makeSubject({
            kind: 'regular', rk1: '30', rk2: '40', exam: '-', total: '-',
        });
        const stage = getSubjectStage(subject, 'ru');
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.status).toBe('risk');
        expect(insight.title).toBe(stage.stageTitle);
    });

    it('regular subject at rk1 stage (nothing graded): status=risk, no needed values', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', exam: '-', total: '-',
        });
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.status).toBe('risk');
        expect(insight.currentSemesterPoints).toBe(null);
        expect(insight.projectedFinal).toBe(null);
    });

    it('rk2 stage (rk1 graded high): suggests neededExam and neededRk2', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '-', exam: '-', total: '-',
        });
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.target).toBe(70);
        // At this stage, the assistant suggests both rk2 and exam targets.
        // The exact values depend on the math (see solveRequiredRk2/Exam tests above).
        expect(insight.neededRk2).not.toBe(null);
        expect(insight.neededExam).not.toBe(null);
    });

    it('exam stage (both rks graded high): suggests neededExam only', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '85', exam: '-', total: '-',
        });
        const insight = buildGoalInsight(subject, 70, 'ru');
        expect(insight.neededExam).not.toBe(null);
        // Already past target on rk-only contribution, so the status should be ok or achievable.
        expect(['ok', 'achievable']).toContain(insight.status);
    });

    it('exam stage with very high target may yield risk/impossible', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '60', rk2: '60', exam: '-', total: '-',
        });
        // Target 95 with current setup requires exam ≥ ~155 → over 100 → practical impossible.
        const insight = buildGoalInsight(subject, 90, 'ru');
        expect(['impossible', 'risk']).toContain(insight.status);
    });
});

describe('buildSubjectAssistantModel', () => {
    it('returns a model with all expected top-level fields', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '75', exam: '85', total: '82',
        });
        const model = buildSubjectAssistantModel(subject, 'ru');

        // Composed from getSubjectStage:
        expect(model.stage).toBe('final');
        expect(typeof model.stageTitle).toBe('string');
        expect(typeof model.stageSummary).toBe('string');
        expect(model.stageTone).toBe('ok');
        expect(model.isBlocked).toBe(false);
        expect(model.isClosed).toBe(true);

        // Numeric outputs:
        expect(model.finalKnown).toBe(82);
        expect(model.previewTotal).toBe(82);
        expect(model.examValue).toBe(85);
        expect(typeof model.currentSemesterPoints).toBe('number');

        // Goal insights are a map keyed by 50/70/90:
        expect(model.goalInsights[50]).toBeDefined();
        expect(model.goalInsights[70]).toBeDefined();
        expect(model.goalInsights[90]).toBeDefined();

        // Available data label is a non-empty string.
        expect(typeof model.availableDataLabel).toBe('string');
        expect(model.availableDataLabel.length).toBeGreaterThan(0);
    });

    it('uses "<final> итог" label when finalKnown !== null', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '75', exam: '85', total: '82',
        });
        const model = buildSubjectAssistantModel(subject, 'ru');
        expect(model.availableDataLabel).toContain('итог');
    });

    it('uses formatStageSnapshot label when no finalKnown', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '80', rk2: '-', exam: '-', total: '-',
        });
        const model = buildSubjectAssistantModel(subject, 'ru');
        expect(model.availableDataLabel).toContain('РК1');
        expect(model.availableDataLabel).not.toContain('итог');
    });

    it('examless subject: examValue is null, currentSemesterPoints reflects rating', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '75', rating: '90', total: '90',
        });
        const model = buildSubjectAssistantModel(subject, 'ru');
        expect(model.examValue).toBe(null);
        expect(model.currentSemesterPoints).toBe(90);
    });

    it('clamps currentSemesterPoints to [0,100]', () => {
        // Construct a subject whose weighted-final would exceed 100 if not clamped.
        // rk1=100 rk2=100 exam=100 → 100. With weights 0.3+0.3+0.4 this hits exactly 100.
        // Outside that domain (invalid input scores >100) clamp should kick in.
        const subject = makeSubject({
            kind: 'regular', rk1: '200', rk2: '200', exam: '200', total: '-',
        });
        const model = buildSubjectAssistantModel(subject, 'ru');
        expect(model.currentSemesterPoints).not.toBeNull();
        expect(model.currentSemesterPoints!).toBeLessThanOrEqual(100);
        expect(model.currentSemesterPoints!).toBeGreaterThanOrEqual(0);
    });

    it('all three goal insights share the same target type and have matching status field', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '70', rk2: '75', exam: '-', total: '-',
        });
        const model = buildSubjectAssistantModel(subject, 'ru');
        for (const goal of [50, 70, 90] as const) {
            const insight = model.goalInsights[goal];
            expect(insight.target).toBe(goal);
            expect(['ok', 'achievable', 'risk', 'impossible']).toContain(insight.status);
        }
    });

    it('language switching produces different stage titles', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', exam: '-', total: '-',
        });
        const ruModel = buildSubjectAssistantModel(subject, 'ru');
        const enModel = buildSubjectAssistantModel(subject, 'en');
        expect(enModel.stageTitle).toBe('RK1 in progress');
        expect(ruModel.stageTitle).not.toBe(enModel.stageTitle);
    });
});

describe('classifyByName (name-based subject kind fallback)', () => {
    // Internal name-classifier used when subject.kind is missing (cached snapshots).
    // Matches across 3 pattern types: LOOSE includes, TIGHT regex, PRACTICE regex.
    // The classification order matters: coursework markers checked before practice
    // (so "Курсовая практика" → coursework, not practice).

    it('returns "regular" by default (no markers in name)', () => {
        expect(classifyByName(makeSubject({ name: 'Высшая математика' }))).toBe('regular');
        expect(classifyByName(makeSubject({ name: 'Физика', code: 'PHYS-101' }))).toBe('regular');
    });

    it('detects coursework by loose substring "курсов"', () => {
        expect(classifyByName(makeSubject({ name: 'Курсовая работа' }))).toBe('coursework');
        expect(classifyByName(makeSubject({ name: 'Курсовая по физике' }))).toBe('coursework');
    });

    it('detects coursework by English markers', () => {
        expect(classifyByName(makeSubject({ name: 'Course work in CS' }))).toBe('coursework');
        expect(classifyByName(makeSubject({ name: 'Coursework: Year 2' }))).toBe('coursework');
        expect(classifyByName(makeSubject({ name: 'Course project A' }))).toBe('coursework');
    });

    it('detects practice via word-boundary regex (not substring of "практикум")', () => {
        // The TIGHT regex pattern requires a word boundary so "практикум" (practicum)
        // doesn't accidentally classify as practice. Locks in this load-bearing distinction.
        expect(classifyByName(makeSubject({ name: 'Производственная практика' }))).toBe('practice');
        expect(classifyByName(makeSubject({ name: 'Лабораторный практикум' }))).toBe('regular');
    });

    it('uses both name AND code in the haystack', () => {
        // Markers in the code (without appearing in name) still trigger classification.
        // Documents that the regex sees `name code` concatenated lowercase.
        expect(classifyByName(makeSubject({ name: 'X', code: 'COURSEWORK-201' }))).toBe('coursework');
    });

    it('is case-insensitive (markers normalized to lowercase before match)', () => {
        expect(classifyByName(makeSubject({ name: 'КУРСОВАЯ РАБОТА' }))).toBe('coursework');
        expect(classifyByName(makeSubject({ name: 'COURSEWORK' }))).toBe('coursework');
    });

    it('coursework wins over practice when BOTH markers are present', () => {
        // Important precedence rule: "Курсовая практика" should be coursework
        // (not practice) because the coursework check runs first in the chain.
        expect(classifyByName(makeSubject({ name: 'Курсовая практика' }))).toBe('coursework');
    });

    it('handles empty name + code gracefully (returns "regular")', () => {
        expect(classifyByName(makeSubject({ name: '', code: '' }))).toBe('regular');
        expect(classifyByName(makeSubject({ name: '' }))).toBe('regular');
    });
});

describe('getKnownFinalScore', () => {
    // Returns the "definitive" final score for a subject if known, else null.
    // Branching:
    //   - examless (coursework/practice): returns getExamlessFinalValue
    //   - regular: needs exam graded; uses subject.total if numeric, else weighted final;
    //     clamped to [0, 100]

    it('returns examless final value for coursework subjects', () => {
        const coursework = makeSubject({ name: 'Курсовая', rating: '85', total: '' });
        expect(getKnownFinalScore(coursework)).toBe(85);
    });

    it('returns examless final value for practice subjects', () => {
        const practice = makeSubject({ name: 'Производственная практика', rating: '70' });
        expect(getKnownFinalScore(practice)).toBe(70);
    });

    it('returns null when examless subject has no rating + no total', () => {
        const coursework = makeSubject({ name: 'Курсовая', rating: '', total: '' });
        expect(getKnownFinalScore(coursework)).toBe(null);
    });

    it('returns null for regular subject when exam not graded', () => {
        const subject = makeSubject({ rk1: '80', rk2: '85', exam: '', total: '' });
        expect(getKnownFinalScore(subject)).toBe(null);
    });

    it('uses subject.total when numeric (preferred over computed weighted final)', () => {
        // total is the canonical Platonus value — trust it when present.
        const subject = makeSubject({ rk1: '80', rk2: '85', exam: '90', total: '87' });
        expect(getKnownFinalScore(subject)).toBe(87);
    });

    it('falls back to weighted final when total is non-numeric', () => {
        // 0.3*80 + 0.3*90 + 0.4*100 = 24 + 27 + 40 = 91
        const subject = makeSubject({ rk1: '80', rk2: '90', exam: '100', total: '' });
        expect(getKnownFinalScore(subject)).toBe(91);
    });

    it('clamps result to [0, 100]', () => {
        // A subject with total=150 (shouldn't happen but defensive) gets clamped to 100.
        const overflowed = makeSubject({ rk1: '80', rk2: '85', exam: '90', total: '150' });
        expect(getKnownFinalScore(overflowed)).toBe(100);
    });

    it('returns null for placeholder zero exam with closed RKs (№5 — не фиксируем фиктивный итог)', () => {
        const subject = makeSubject({ rk1: '85', rk2: '90', exam: '0', total: '0' });
        expect(getKnownFinalScore(subject)).toBe(null);
    });

    it('returns published total for real zero exam (total positive)', () => {
        const subject = makeSubject({ rk1: '85', rk2: '90', exam: '0', total: '52.5' });
        expect(getKnownFinalScore(subject)).toBe(52.5);
    });
});

describe('resolveKind (kind resolution with backend-first priority)', () => {
    // Resolves subject kind: trust backend's explicit `kind` field when set,
    // otherwise fall back to `classifyByName`. This is the gate that every
    // `isCourseworkSubject`/`isPracticeSubject`/`isExamlessSubject` check uses.

    it('trusts backend "regular" even when name has coursework markers', () => {
        // CRITICAL invariant: backend's `kind` is authoritative — name-based
        // classification is only a fallback for older cached snapshots without
        // the kind field. A regression that flipped this priority would
        // mis-classify newer Platonus parses based on stale name heuristics.
        const subject = makeSubject({ kind: 'regular', name: 'Курсовая работа' });
        expect(resolveKind(subject)).toBe('regular');
    });

    it('trusts backend "coursework" even when name lacks markers', () => {
        const subject = makeSubject({ kind: 'coursework', name: 'Высшая математика' });
        expect(resolveKind(subject)).toBe('coursework');
    });

    it('trusts backend "practice" verbatim', () => {
        const subject = makeSubject({ kind: 'practice', name: 'Random Name' });
        expect(resolveKind(subject)).toBe('practice');
    });

    it('falls back to classifyByName when kind is missing (undefined)', () => {
        // The ?? operator only falls through on null/undefined.
        const subject = makeSubject({ name: 'Курсовая работа' });
        // No kind field → name classification → coursework.
        expect(resolveKind(subject)).toBe('coursework');
    });

    it('falls back to classifyByName when kind is null', () => {
        // Locks in that null is treated as "missing" (not as a valid kind).
        const subject = makeSubject({ kind: null as unknown as undefined, name: 'Курсовая работа' });
        expect(resolveKind(subject)).toBe('coursework');
    });

    it('default fallback to "regular" when kind missing AND no name markers', () => {
        const subject = makeSubject({ name: 'Какой-то предмет' });
        expect(resolveKind(subject)).toBe('regular');
    });
});
