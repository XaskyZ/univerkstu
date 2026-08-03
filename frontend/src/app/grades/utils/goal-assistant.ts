import type { PlatonusSubjectGrade, PlatonusSubjectKind } from '@/lib/api';
import {
    type AssistantStatus,
    EXAM_WEIGHT,
    type GoalInsight,
    type GoalOption,
    GOAL_OPTIONS,
    type ParsedScore,
    RK_WEIGHT,
    type SubjectAssistantModel,
} from '../types';
import {
    clampNumber,
    formatGoalNumber,
    hasPublishedSemesterActivity,
    parseScoreValue,
} from './grades-helpers';

export function getAssistantCopy(language: 'ru' | 'kz' | 'en') {
    if (language === 'en') {
        return {
            helperTitle: 'Grade assistant',
            targetTitle: 'Goal',
            stageTitle: 'Stage',
            stageRk1: 'RK1 in progress',
            stageRk2: 'RK2 in progress',
            stageExam: 'Waiting for exam',
            stageFinal: 'Final result',
            stageBlocked: 'No admission to exam',
            stageUnknown: 'Waiting for data',
            stageExamlessPending: 'Waiting for the final mark',
            snapshot: 'Current snapshot',
            ifExamTarget: 'If exam = goal',
            ifRk2Target: 'If RK2 = goal',
            admissionRule: 'Admission threshold',
            debtRisk: 'Risk of failing the course',
            currentState: 'Current state',
            projectedFinal: 'Projected result',
            semesterBase: 'Current semester points',
            minExam: 'Minimum exam',
            minRk2: 'Minimum RK2',
            extraRk: 'Need from remaining RK',
            safePath: 'Safe path to 50',
            impossible: 'Impossible',
            noData: 'Not enough data yet',
            closed: 'Subject closed',
            blocked: 'Exam blocked',
            statusOk: 'Already ok',
            statusAchievable: 'Achievable',
            statusRisk: 'Risk',
            statusImpossible: 'Impossible',
            statusAlmostImpossible: 'Almost impossible',
            targetReached: 'Target already secured.',
            targetReachedClosed: 'This result is already fixed.',
            targetPossible: 'The goal is reachable with the remaining points.',
            targetRisk: 'The goal is still reachable, but the margin is small.',
            targetImpossible: 'Even the remaining RK and exam are not enough.',
            targetAlmostImpossible: 'The target is still mathematically possible, but it requires almost maximum scores.',
            blockedSummary: 'The subject currently shows no admission to exam.',
            missingSummary: 'Need more data to calculate precisely.',
            rk1Summary: 'Platonus has not published RK1 yet, so the first milestone is still in progress.',
            rk2Summary: 'RK1 is already published, so the course has moved to the second milestone.',
            examSummary: 'Both milestones are already published. The next stage is the exam.',
            finalSummary: 'The exam grade is already published, so the final result is fixed.',
            finalSummaryExamless: 'The final result for this subject is already locked.',
            examlessPendingSummary: 'There is no exam for this subject — the final mark will appear once the teacher publishes it.',
            snapshotHint: 'Closed grades that already affect the final result.',
            ifExamTargetHint: 'How much RK2 is needed if the exam stays at the selected goal.',
            ifRk2TargetHint: 'How much exam is needed if RK2 stays at the selected goal.',
            admissionHint: 'Exam admission requires the average of RK1 and RK2 to be at least 50.',
            debtHint: 'A final below 50 means you must retake this subject.',
            safePathReached: 'You already have enough semester points to stay above 50.',
            safePathNeed: 'Need at least {value} more semester points so the exam can still save the course.',
            examNeed: 'Need at least {value} on the exam.',
            rk2Need: 'Need at least {value} on RK2.',
            rkNeed: 'Need at least {value} more semester points.',
            examCalendar: 'Exam in calendar: {value}',
            totalPreview: 'Preliminary total',
        };
    }

    if (language === 'kz') {
        return {
            helperTitle: 'Баға көмекшісі',
            targetTitle: 'Мақсат',
            stageTitle: 'Кезең',
            stageRk1: 'Бірінші рубежка жүріп жатыр',
            stageRk2: 'Екінші рубежка жүріп жатыр',
            stageExam: 'Емтихан кезеңі',
            stageFinal: 'Қорытынды дайын',
            stageBlocked: 'Емтиханға допуск жоқ',
            stageUnknown: 'Дерек күтілуде',
            stageExamlessPending: 'Қорытынды бағаны күтеміз',
            snapshot: 'Қазіргі кескін',
            ifExamTarget: 'Егер емтихан = мақсат',
            ifRk2Target: 'Егер РК2 = мақсат',
            admissionRule: 'Допуск шегі',
            debtRisk: 'Академиялық қарыз қаупі',
            currentState: 'Қазіргі жағдай',
            projectedFinal: 'Болжамды қорытынды',
            semesterBase: 'Семестрлік ұпай',
            minExam: 'Емтихан минимумы',
            minRk2: 'РК2 минимумы',
            extraRk: 'Қалған рубежкадан керек',
            safePath: '50-ге қауіпсіз жол',
            impossible: 'Мүмкін емес',
            noData: 'Әзірге дерек аз',
            closed: 'Пән жабылған',
            blocked: 'Емтиханға жіберілмеген',
            statusOk: 'Қазірдің өзінде жеткілікті',
            statusAchievable: 'Жетуге болады',
            statusRisk: 'Тәуекел бар',
            statusImpossible: 'Мүмкін емес',
            statusAlmostImpossible: 'Іс жүзінде мүмкін емес',
            targetReached: 'Мақсат қазірдің өзінде қамтамасыз етілген.',
            targetReachedClosed: 'Нәтиже бекітілген.',
            targetPossible: 'Қалған ұпаймен мақсатқа жетуге болады.',
            targetRisk: 'Мақсатқа жетуге болады, бірақ қор аз.',
            targetImpossible: 'Қалған РК мен емтихан да жеткіліксіз.',
            targetAlmostImpossible: 'Мақсат математикалық тұрғыда бар, бірақ оған жету үшін шекке жақын баллдар керек.',
            blockedSummary: 'Қазір бұл пәнде емтиханға допуск жоқ.',
            missingSummary: 'Дәл есеп үшін дерек жеткіліксіз.',
            rk1Summary: 'Platonus әлі РК1 бағасын көрсеткен жоқ, демек бірінші рубежка жабылған жоқ.',
            rk2Summary: 'РК1 бағасы шыққан, сондықтан қазір екінші рубежка жүріп жатыр.',
            examSummary: 'Екі рубежка да жабылған, келесі кезең емтихан.',
            finalSummary: 'Емтихан бағасы жарияланған, қорытынды нәтиже бекітілген.',
            finalSummaryExamless: 'Пән бойынша қорытынды нәтиже бекітілген.',
            examlessPendingSummary: 'Бұл пәнде емтихан жоқ — қорытынды бағаны оқытушы қойғаннан кейін көрінеді.',
            snapshotHint: 'Қорытындыға әсер ететін жабық бағалар.',
            ifExamTargetHint: 'Егер емтихан таңдалған мақсат деңгейінде болса, РК2 қанша болу керек.',
            ifRk2TargetHint: 'Егер РК2 таңдалған мақсат деңгейінде болса, емтихан қанша болу керек.',
            admissionHint: 'Емтиханға допуск алу үшін РК1 мен РК2-нің орташасы кемінде 50 болуы керек.',
            debtHint: 'Қорытынды 50-ден төмен болса, пәнді қайта тапсыру керек.',
            safePathReached: '50-ден жоғары қалуға семестрлік ұпай жеткілікті.',
            safePathNeed: 'Емтихан пәнді құтқара алуы үшін тағы кемінде {value} семестрлік ұпай керек.',
            examNeed: 'Емтиханда кемінде {value} керек.',
            rk2Need: 'РК2-де кемінде {value} керек.',
            rkNeed: 'Қалған рубежкадан кемінде {value} керек.',
            examCalendar: 'Күнтізбедегі емтихан: {value}',
            totalPreview: 'Алдын ала total',
        };
    }

    return {
        helperTitle: 'Помощник по оценке',
        targetTitle: 'Цель',
        stageTitle: 'Стадия',
        stageRk1: 'Идёт первая рубежка',
        stageRk2: 'Идёт вторая рубежка',
        stageExam: 'Остался экзамен',
        stageFinal: 'Итог уже выставлен',
        stageBlocked: 'Недопуск к экзамену',
        stageUnknown: 'Ждём данные',
        stageExamlessPending: 'Ждём итоговую оценку',
        snapshot: 'Текущий срез',
        ifExamTarget: 'Если экзамен = цели',
        ifRk2Target: 'Если РК2 = цели',
        admissionRule: 'Порог допуска',
        debtRisk: 'Риск задолженности',
        currentState: 'Текущее состояние',
        projectedFinal: 'Прогноз итоговой',
        semesterBase: 'Семестровые баллы',
        minExam: 'Минимум на экзамене',
        minRk2: 'Минимум на РК2',
        extraRk: 'Нужно добрать по РК',
        safePath: 'Безопасный путь к 50',
        impossible: 'Недостижимо',
        noData: 'Пока не хватает данных',
        closed: 'Предмет закрыт',
        blocked: 'Недопуск к экзамену',
        statusOk: 'Уже ок',
        statusAchievable: 'Достижимо',
        statusRisk: 'Риск',
        statusImpossible: 'Недостижимо',
        statusAlmostImpossible: 'Практически невозможно',
        targetReached: 'Цель уже обеспечена.',
        targetReachedClosed: 'Результат уже зафиксирован.',
        targetPossible: 'Цель достижима с оставшимися баллами.',
        targetRisk: 'Цель ещё достижима, но запас маленький.',
        targetImpossible: 'Даже максимум по РК и экзамену не вытягивает цель.',
        targetAlmostImpossible: 'Цель ещё достижима математически, но для неё нужны почти максимальные баллы.',
        blockedSummary: 'Сейчас по предмету отмечен недопуск к экзамену.',
        missingSummary: 'Для точного расчёта пока мало данных.',
        rk1Summary: 'Platonus ещё не показал РК1, значит первая рубежка пока не закрыта.',
        rk2Summary: 'Platonus уже показал РК1, значит первая рубежка закрыта и сейчас идёт вторая.',
        examSummary: 'Обе рубежки уже закрыты, дальше остаётся только экзамен.',
        finalSummary: 'Оценка за экзамен уже есть, итог по предмету зафиксирован.',
        finalSummaryExamless: 'Итог по предмету уже зафиксирован.',
        examlessPendingSummary: 'В этом предмете экзамена нет — итог появится, когда преподаватель его выставит.',
        snapshotHint: 'Закрытые оценки, которые уже влияют на итог.',
        ifExamTargetHint: 'Сколько нужно на РК2, если экзамен удержать на выбранной цели.',
        ifRk2TargetHint: 'Сколько нужно на экзамене, если РК2 удержать на выбранной цели.',
        admissionHint: 'Нужен средний балл РК1 и РК2 не ниже 50 для допуска к экзамену.',
        debtHint: 'Итог ниже 50 — предмет уходит на пересдачу.',
        safePathReached: 'Семестровых баллов уже хватает, чтобы не уйти на кредиты.',
        safePathNeed: 'Нужно ещё хотя бы {value} семестровых балла, чтобы экзамен ещё мог спасти предмет.',
        examNeed: 'Нужно минимум {value} на экзамене.',
        rk2Need: 'Нужно минимум {value} на РК2.',
        rkNeed: 'Нужно ещё минимум {value} по оставшимся РК.',
        examCalendar: 'Экзамен по календарю: {value}',
        totalPreview: 'Предварительный total',
    };
}

export function hasBothRksClosed(subject: PlatonusSubjectGrade) {
    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    return rk1.kind === 'number' && rk1.value !== null && rk2.kind === 'number' && rk2.value !== null;
}

// Резервные маркеры — на случай чтения предметов из старого кеша без `kind`.
// Должны соответствовать бэк-классификатору в `backend/src/parsers/grades.ts`.
const COURSEWORK_NAME_MARKERS_LOOSE = [
    'курсов',
    'course work',
    'coursework',
    'course project',
    'курстық',
    'курсовой проект',
    'курс. проект',
];
const COURSEWORK_NAME_MARKERS_TIGHT: RegExp[] = [
    /(?:^|[^\p{L}])кп(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])кр(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])жоба(?:[^\p{L}]|$)/u,
];
const PRACTICE_NAME_PATTERNS: RegExp[] = [
    /(?:^|[^\p{L}])практик(?:а|и|у|е|ой)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])тәжірибе/u,
    /(?:^|[^\p{L}])practice(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])интернатура/u,
];

export function classifyByName(subject: PlatonusSubjectGrade): PlatonusSubjectKind {
    const haystack = `${subject.name || ''} ${subject.code || ''}`.toLowerCase();
    if (COURSEWORK_NAME_MARKERS_LOOSE.some((marker) => haystack.includes(marker))) return 'coursework';
    if (COURSEWORK_NAME_MARKERS_TIGHT.some((pattern) => pattern.test(haystack))) return 'coursework';
    if (PRACTICE_NAME_PATTERNS.some((pattern) => pattern.test(haystack))) return 'practice';
    return 'regular';
}

export function resolveKind(subject: PlatonusSubjectGrade): PlatonusSubjectKind {
    return subject.kind ?? classifyByName(subject);
}

export function isCourseworkSubject(subject: PlatonusSubjectGrade): boolean {
    return resolveKind(subject) === 'coursework';
}

export function isPracticeSubject(subject: PlatonusSubjectGrade): boolean {
    return resolveKind(subject) === 'practice';
}

export function isExamlessSubject(subject: PlatonusSubjectGrade): boolean {
    const kind = resolveKind(subject);
    return kind === 'coursework' || kind === 'practice';
}

/**
 * Итоговая оценка для курсовой/практики. Сначала пробуем `rating`,
 * иначе `total` — оба заполнены преподавателем, экзамена в этом предмете нет.
 */
export function getExamlessFinalValue(subject: PlatonusSubjectGrade): number | null {
    if (!isExamlessSubject(subject)) return null;

    const rating = parseScoreValue(subject.rating);
    if (rating.kind === 'number' && rating.value !== null && rating.value > 0) {
        return clampNumber(rating.value, 0, 100);
    }

    const total = parseScoreValue(subject.total);
    if (total.kind === 'number' && total.value !== null && total.value > 0) {
        return clampNumber(total.value, 0, 100);
    }

    return null;
}

/**
 * Заглушка-«0» в слоте экзамена. До сессии Platonus держит в экзамене строку
 * '0' (рядом обычно и тотал-«0»), причём даже когда обе РК уже закрыты.
 * Реальной оценкой «0» (неявка/провал) считаем её только когда тотал тоже
 * опубликован положительным числом — иначе экзамен ещё просто не выставлен.
 */
export function isExamZeroPlaceholder(subject: PlatonusSubjectGrade): boolean {
    const exam = parseScoreValue(subject.exam);
    if (exam.kind !== 'number' || exam.value !== 0) return false;
    const total = parseScoreValue(subject.total);
    return !(total.kind === 'number' && total.value !== null && total.value > 0);
}

export function getEffectiveExamScore(subject: PlatonusSubjectGrade): ParsedScore {
    const exam = parseScoreValue(subject.exam);
    if (isExamlessSubject(subject)) {
        return { kind: 'missing', raw: exam.raw, value: null };
    }

    // №5 аудита: заглушка-«0» не считается выставленным экзаменом даже после
    // закрытия обеих РК — иначе стадия становилась «Итог уже выставлен» с
    // фиктивным тоталом и противоречила бейджу «Ждём экзамен» в списке предметов.
    if (isExamZeroPlaceholder(subject)) {
        return { kind: 'missing', raw: exam.raw, value: null };
    }

    if (hasBothRksClosed(subject)) {
        return exam;
    }

    if (exam.kind === 'blocked') {
        return { kind: 'missing', raw: exam.raw, value: null };
    }

    if (exam.kind === 'number' && exam.value === 0) {
        return { kind: 'missing', raw: exam.raw, value: null };
    }

    return exam;
}

export function getExamDisplayValue(subject: PlatonusSubjectGrade) {
    if (isExamlessSubject(subject)) {
        return '—';
    }

    // Заглушка-«0» — экзамен ещё не выставлен: показываем «?» (согласованно
    // со стадией «Остался экзамен»), а не пугающий ноль. Реальный «0»
    // (тотал опубликован положительным) остаётся видимым как есть.
    if (isExamZeroPlaceholder(subject)) {
        return '?';
    }

    const rawExam = parseScoreValue(subject.exam);
    if (!hasBothRksClosed(subject) && (rawExam.kind === 'blocked' || (rawExam.kind === 'number' && rawExam.value === 0))) {
        return '?';
    }
    return subject.exam;
}

export function getTotalDisplayValue(subject: PlatonusSubjectGrade) {
    if (isExamlessSubject(subject)) {
        const examlessFinal = getExamlessFinalValue(subject);
        if (examlessFinal !== null) return formatGoalNumber(examlessFinal);
        const rating = parseScoreValue(subject.rating);
        if (rating.kind === 'number' && rating.value !== null) {
            return formatGoalNumber(clampNumber(rating.value, 0, 100));
        }
        return '—';
    }

    const rawExam = parseScoreValue(subject.exam);

    // Недопуск — оставляем сырое значение, чтобы пользователь видел реальный статус.
    // Заглушку-«недоп.» не начавшегося семестра (ни одной опубликованной оценки)
    // сюда не пускаем — иначе рисовали бы ложный total «0».
    if (rawExam.kind === 'blocked' && hasPublishedSemesterActivity(subject)) {
        return subject.total;
    }

    // Экзамен не выставлен реальным положительным баллом (пусто, `0`, или текстовый
    // плейсхолдер типа «Допуск») — тотал-«0» в Platonus это просто заглушка, врёт
    // пользователю про провал. Рисуем `?`.
    const examGradedRealValue = rawExam.kind === 'number' && (rawExam.value ?? 0) > 0;
    if (!examGradedRealValue) {
        return '?';
    }

    return subject.total;
}

export function getWeightedFinal(rk1: number | null, rk2: number | null, exam: number | null) {
    return (rk1 ?? 0) * RK_WEIGHT + (rk2 ?? 0) * RK_WEIGHT + (exam ?? 0) * EXAM_WEIGHT;
}

export function solveRequiredRk2(target: number, rk1: number | null, exam: number | null) {
    if (rk1 === null || exam === null) return null;
    return (target - rk1 * RK_WEIGHT - exam * EXAM_WEIGHT) / RK_WEIGHT;
}

export function solveRequiredExam(target: number, rk1: number | null, rk2: number | null) {
    if (rk1 === null || rk2 === null) return null;
    return (target - rk1 * RK_WEIGHT - rk2 * RK_WEIGHT) / EXAM_WEIGHT;
}

export function ceilExamScore(value: number | null) {
    if (value === null) return null;
    return Math.max(0, Math.ceil(value));
}

export function formatStageSnapshot(subject: PlatonusSubjectGrade) {
    if (isExamlessSubject(subject)) {
        return `РК1 ${subject.rk1 || '—'} • РК2 ${subject.rk2 || '—'} • Рейтинг ${subject.rating || '—'}`;
    }
    return `РК1 ${subject.rk1 || '—'} • РК2 ${subject.rk2 || '—'} • Экзамен ${getExamDisplayValue(subject) || '—'}`;
}

export function getKnownFinalScore(subject: PlatonusSubjectGrade): number | null {
    if (isExamlessSubject(subject)) {
        return getExamlessFinalValue(subject);
    }

    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    const exam = getEffectiveExamScore(subject);
    const total = parseScoreValue(subject.total);
    const rk1Value = rk1.kind === 'number' ? rk1.value : null;
    const rk2Value = rk2.kind === 'number' ? rk2.value : null;
    const examValue = exam.kind === 'number' ? exam.value : null;

    if (examValue === null) return null;

    return clampNumber(
        total.kind === 'number' && total.value !== null
            ? total.value
            : getWeightedFinal(rk1Value, rk2Value, examValue),
        0,
        100
    );
}

export function getSubjectStage(
    subject: PlatonusSubjectGrade,
    language: 'ru' | 'kz' | 'en'
): Pick<SubjectAssistantModel, 'stage' | 'stageTitle' | 'stageSummary' | 'stageTone' | 'isBlocked' | 'isClosed'> {
    const copy = getAssistantCopy(language);
    const examless = isExamlessSubject(subject);
    const finalKnown = getKnownFinalScore(subject);

    if (finalKnown !== null) {
        return {
            stage: 'final',
            stageTitle: copy.stageFinal,
            stageSummary: examless ? copy.finalSummaryExamless : copy.finalSummary,
            stageTone: 'ok',
            isBlocked: false,
            isClosed: true,
        };
    }

    if (examless) {
        return {
            stage: 'unknown',
            stageTitle: copy.stageExamlessPending,
            stageSummary: copy.examlessPendingSummary,
            stageTone: 'achievable',
            isBlocked: false,
            isClosed: false,
        };
    }

    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    const exam = getEffectiveExamScore(subject);

    const rk1Closed = rk1.kind === 'number' && rk1.value !== null;
    const rk2Closed = rk2.kind === 'number' && rk2.value !== null;
    const examClosed = exam.kind === 'number' && exam.value !== null;
    // Допуск по средней рейтинга: (РК1+РК2)/2 ≥ 50. Если Platonus уже выставил
    // явный «Недоп.» в поле экзамена — это авторитетный сигнал, его и слушаем,
    // НО только когда по предмету есть хоть одна реально опубликованная оценка:
    // для не начавшегося семестра Platonus проставляет «недоп.» заранее при
    // пустых РК ('-') и нулевом рейтинге — это заглушка «данных ещё нет».
    // До закрытия обоих РК блокировку не объявляем — итоговая средняя ещё не известна.
    const rawExam = parseScoreValue(subject.exam);
    const hasActivity = hasPublishedSemesterActivity(subject);
    const platonusSaysBlocked = rawExam.kind === 'blocked' && hasActivity;
    const admissionAverage = rk1Closed && rk2Closed
        ? ((rk1.value ?? 0) + (rk2.value ?? 0)) / 2
        : null;
    const blocked = platonusSaysBlocked
        || (admissionAverage !== null && admissionAverage < 50);

    // Заглушка-«недоп.» без единой опубликованной оценки — семестр/предмет
    // ещё не начался. Показываем «ждём данные», а не тревожный недопуск.
    if (rawExam.kind === 'blocked' && !hasActivity) {
        return {
            stage: 'unknown',
            stageTitle: copy.stageUnknown,
            stageSummary: copy.missingSummary,
            stageTone: 'achievable',
            isBlocked: false,
            isClosed: false,
        };
    }

    if (examClosed) {
        return {
            stage: 'final',
            stageTitle: copy.stageFinal,
            stageSummary: copy.finalSummary,
            stageTone: 'ok',
            isBlocked: false,
            isClosed: true,
        };
    }

    if (blocked) {
        return {
            stage: 'blocked',
            stageTitle: copy.stageBlocked,
            stageSummary: copy.blockedSummary,
            stageTone: 'risk',
            isBlocked: true,
            isClosed: false,
        };
    }

    if (rk2Closed) {
        return {
            stage: 'exam',
            stageTitle: copy.stageExam,
            stageSummary: copy.examSummary,
            stageTone: 'achievable',
            isBlocked: false,
            isClosed: false,
        };
    }

    if (rk1Closed) {
        return {
            stage: 'rk2',
            stageTitle: copy.stageRk2,
            stageSummary: copy.rk2Summary,
            stageTone: 'achievable',
            isBlocked: false,
            isClosed: false,
        };
    }

    return {
        stage: 'rk1',
        stageTitle: copy.stageRk1,
        stageSummary: copy.rk1Summary,
        stageTone: 'risk',
        isBlocked: false,
        isClosed: false,
    };
}

export function buildGoalInsight(
    subject: PlatonusSubjectGrade,
    target: GoalOption,
    language: 'ru' | 'kz' | 'en'
): GoalInsight {
    const copy = getAssistantCopy(language);

    if (isExamlessSubject(subject)) {
        const finalKnown = getExamlessFinalValue(subject);
        if (finalKnown !== null) {
            const reached = finalKnown >= target;
            return {
                target,
                status: reached ? 'ok' : 'impossible',
                title: reached ? copy.statusOk : copy.closed,
                summary: reached ? copy.targetReachedClosed : `${copy.closed}. ${copy.targetImpossible}`,
                neededExam: null,
                neededSemesterPoints: null,
                neededRk2: null,
                safeSemesterPoints: null,
                remainingSemesterCapacity: null,
                currentSemesterPoints: finalKnown,
                projectedFinal: finalKnown,
            };
        }

        const rating = parseScoreValue(subject.rating);
        const currentSemesterPoints = rating.kind === 'number' && rating.value !== null
            ? clampNumber(rating.value, 0, 100)
            : null;
        return {
            target,
            status: 'risk',
            title: copy.stageExamlessPending,
            summary: copy.examlessPendingSummary,
            neededExam: null,
            neededSemesterPoints: null,
            neededRk2: null,
            safeSemesterPoints: null,
            remainingSemesterCapacity: null,
            currentSemesterPoints,
            projectedFinal: null,
        };
    }

    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    const rating = parseScoreValue(subject.rating);
    const exam = getEffectiveExamScore(subject);
    const stage = getSubjectStage(subject, language);
    const rk1Value = rk1.kind === 'number' ? rk1.value : null;
    const rk2Value = rk2.kind === 'number' ? rk2.value : null;
    const examValue = exam.kind === 'number' ? exam.value : null;
    const hasRating = rating.kind === 'number' && rating.value !== null;
    const currentSemesterPoints = hasRating ? rating.value : getWeightedFinal(rk1Value, rk2Value, examValue);
    const knownFinal = getKnownFinalScore(subject);
    const finalKnown = knownFinal;
    const projectedFinal = finalKnown !== null
        ? finalKnown
        : clampNumber(
            getWeightedFinal(
                rk1Value,
                rk2Value ?? (stage.stage === 'rk2' ? target : null),
                examValue ?? (stage.stage === 'rk1' || stage.stage === 'rk2' || stage.stage === 'exam' ? target : null)
            ),
            0,
            100
        );
    const neededRk2 = stage.stage === 'rk2'
        ? solveRequiredRk2(target, rk1Value, target)
        : null;
    const neededExam = stage.stage === 'rk2'
        ? ceilExamScore(solveRequiredExam(target, rk1Value, target))
        : stage.stage === 'exam'
            ? ceilExamScore(solveRequiredExam(target, rk1Value, rk2Value))
            : null;
    const neededSemesterPoints = neededRk2 === null ? null : Math.max(50, neededRk2);
    const safeSemesterPoints = stage.stage === 'rk2'
        ? 50
        : stage.stage === 'exam'
            ? ceilExamScore(solveRequiredExam(50, rk1Value, rk2Value))
            : null;
    const remainingSemesterCapacity = null;
    const maxReachableFinal = stage.stage === 'rk2'
        ? getWeightedFinal(rk1Value, 100, 100)
        : stage.stage === 'exam'
            ? getWeightedFinal(rk1Value, rk2Value, 100)
            : finalKnown;
    if (finalKnown !== null) {
        const reached = finalKnown >= target;
        return {
            target,
            status: reached ? 'ok' : 'impossible',
            title: reached ? copy.statusOk : copy.closed,
            summary: reached ? copy.targetReachedClosed : `${copy.closed}. ${copy.targetImpossible}`,
            neededExam: null,
            neededSemesterPoints: null,
            neededRk2: null,
            safeSemesterPoints: null,
            remainingSemesterCapacity,
            currentSemesterPoints,
            projectedFinal: finalKnown,
        };
    }

    if (stage.isBlocked) {
        return {
            target,
            status: 'risk',
            title: stage.stageTitle,
            summary: stage.stageSummary,
            neededExam,
            neededSemesterPoints,
            neededRk2,
            safeSemesterPoints,
            remainingSemesterCapacity,
            currentSemesterPoints,
            projectedFinal,
        };
    }

    if (!hasRating && rk1.kind !== 'number' && rk2.kind !== 'number') {
        return {
            target,
            status: 'risk',
            title: stage.stageTitle,
            summary: stage.stageSummary,
            neededExam: null,
            neededSemesterPoints: null,
            neededRk2: null,
            safeSemesterPoints: null,
            remainingSemesterCapacity: null,
            currentSemesterPoints: null,
            projectedFinal: null,
        };
    }

    const requiredForTarget = stage.stage === 'rk2'
        ? Math.max(neededSemesterPoints ?? 0, neededExam ?? 0)
        : neededExam ?? 0;

    if (requiredForTarget <= 0 && (neededExam !== null || neededSemesterPoints !== null)) {
        return {
            target,
            status: 'ok',
            title: copy.statusOk,
            summary: copy.targetReached,
            neededExam: neededExam !== null ? 0 : null,
            neededSemesterPoints: neededSemesterPoints !== null ? 0 : null,
            neededRk2: neededRk2 !== null ? 0 : null,
            safeSemesterPoints,
            remainingSemesterCapacity,
            currentSemesterPoints,
            projectedFinal,
        };
    }

    const hardImpossible = maxReachableFinal !== null && maxReachableFinal < target;
    const practicalImpossible = !hardImpossible && (
        (neededSemesterPoints !== null && neededSemesterPoints > 100)
        || (neededExam !== null && neededExam > 100)
    );
    if (hardImpossible) {
        return {
            target,
            status: 'impossible',
            title: copy.impossible,
            summary: copy.targetImpossible,
            neededExam,
            neededSemesterPoints,
            neededRk2,
            safeSemesterPoints,
            remainingSemesterCapacity,
            currentSemesterPoints,
            projectedFinal,
        };
    }

    if (practicalImpossible) {
        return {
            target,
            status: 'impossible',
            title: copy.statusAlmostImpossible,
            summary: copy.targetAlmostImpossible,
            neededExam,
            neededSemesterPoints,
            neededRk2,
            safeSemesterPoints,
            remainingSemesterCapacity,
            currentSemesterPoints,
            projectedFinal,
        };
    }

    const status: AssistantStatus = (neededExam ?? 0) >= 85 || (neededSemesterPoints ?? 0) >= 85 ? 'risk' : 'achievable';
    return {
        target,
        status,
        title: status === 'achievable' ? copy.statusAchievable : copy.statusRisk,
        summary: stage.stage === 'rk2'
            ? copy.rk2Summary
            : stage.stage === 'exam'
                ? copy.examSummary
                : status === 'achievable'
                    ? copy.targetPossible
                    : copy.targetRisk,
        neededExam,
        neededSemesterPoints,
        neededRk2,
        safeSemesterPoints,
        remainingSemesterCapacity,
        currentSemesterPoints,
        projectedFinal,
    };
}

export function buildSubjectAssistantModel(
    subject: PlatonusSubjectGrade,
    language: 'ru' | 'kz' | 'en'
): SubjectAssistantModel {
    const stage = getSubjectStage(subject, language);
    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    const rating = parseScoreValue(subject.rating);
    const knownFinal = getKnownFinalScore(subject);
    const examless = isExamlessSubject(subject);

    let currentSemesterPoints: number | null;
    let previewTotal: number | null;
    let examValue: number | null;

    if (examless) {
        examValue = null;
        currentSemesterPoints = rating.kind === 'number' && rating.value !== null
            ? clampNumber(rating.value, 0, 100)
            : null;
        previewTotal = knownFinal;
    } else {
        const exam = getEffectiveExamScore(subject);
        const total = parseScoreValue(subject.total);
        const rk1Value = rk1.kind === 'number' ? rk1.value : null;
        const rk2Value = rk2.kind === 'number' ? rk2.value : null;
        examValue = exam.kind === 'number' ? exam.value : null;
        currentSemesterPoints = rating.kind === 'number' && rating.value !== null
            ? clampNumber(rating.value, 0, 100)
            : clampNumber(getWeightedFinal(rk1Value, rk2Value, examValue), 0, 100);
        previewTotal = knownFinal !== null
            ? knownFinal
            : total.kind === 'number'
                ? clampNumber(total.value ?? 0, 0, 100)
                : null;
    }

    const remainingSemesterCapacity = null;
    const finalKnown = knownFinal;
    const goalInsights = GOAL_OPTIONS.reduce((acc, goal) => {
        acc[goal] = buildGoalInsight(subject, goal, language);
        return acc;
    }, {} as Record<GoalOption, GoalInsight>);

    let availableDataLabel = formatStageSnapshot(subject);
    if (finalKnown !== null) {
        availableDataLabel = `${formatGoalNumber(finalKnown)} итог`;
    }

    return {
        stage: stage.stage,
        stageTitle: stage.stageTitle,
        stageSummary: stage.stageSummary,
        stageTone: stage.stageTone,
        isBlocked: stage.isBlocked,
        isClosed: stage.isClosed,
        finalKnown,
        previewTotal,
        currentSemesterPoints,
        remainingSemesterCapacity,
        examValue,
        availableDataLabel,
        goalInsights,
    };
}
