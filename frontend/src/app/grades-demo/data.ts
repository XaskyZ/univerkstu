/**
 * ============================================================================
 *  Информационная модель (что показывает реальная страница /grades)
 * ============================================================================
 *
 *  Источники истины:
 *    - frontend/src/lib/api.ts         : PlatonusSubjectGrade, GradesMeta
 *    - frontend/src/app/grades/types.ts: GoalInsight, SubjectAssistantModel, AssistantStatus, SubjectStage
 *    - frontend/src/app/grades/utils/goal-assistant.ts : правило допуска
 *      (среднее РК1+РК2 >= 50), формулы RK_WEIGHT=0.3, EXAM_WEIGHT=0.4,
 *      прогноз итога и минимальный балл на экзамене.
 *    - frontend/src/app/grades/utils/grades-helpers.ts : тоны оценок,
 *      обнаружение «Недоп.», парсинг РК/экзамена.
 *    - frontend/src/components/GradesView.tsx          : шапка с GPA,
 *      переключатель семестров, кэш/staleness, количество предметов.
 *
 *  Реальный набор полей по предмету (PlatonusSubjectGrade + производные):
 *    - name        : полное название («Высшая математика II»)
 *    - code        : код предмета («MAT2103»)
 *    - tutors      : список преподавателей (1..n)
 *    - kind        : 'regular' | 'coursework' | 'practice'
 *                    (у coursework / practice экзамена нет — итог в rating/total)
 *    - rk1, rk2    : строки (могут быть числом, пустыми, «-», «Недоп.»)
 *    - rating      : текущая семестровая сумма
 *    - exam        : строка (может быть «Недоп.», «0», пустой)
 *    - total       : итог (после экзамена) или «0» / пусто, пока не выставлен
 *    - examDate    : дата экзамена из календаря (если найдена)
 *
 *  Производные поля (рассчитываются goal-assistant.ts):
 *    - stage          : 'rk1' | 'rk2' | 'exam' | 'final' | 'blocked' | 'unknown'
 *    - stageTitle     : человеко-читаемая стадия («Идёт первая рубежка»,
 *                       «Остался экзамен», «Недопуск к экзамену», «Итог выставлен»)
 *    - finalKnown     : зафиксированный итог (если есть)
 *    - previewTotal   : что будет итогом, если ничего не менять
 *    - currentSemesterPoints : текущая сумма семестровых баллов
 *    - admissionAverage      : (rk1+rk2)/2 — должен быть >= 50 для допуска
 *    - goalInsights[50|70|90] :
 *        - neededExam        : минимум баллов на экзамене для цели
 *        - neededRk2         : минимум баллов на РК2 для цели
 *        - safeSemesterPoints: минимум семестровых баллов, чтобы не уйти на кредиты
 *        - projectedFinal    : прогноз итога при выбранной цели
 *        - status            : 'ok' | 'achievable' | 'risk' | 'impossible'
 *
 *  Поля, которых НЕТ в реальном API, но в учебной системе университета они есть
 *  (transcript / силлабус) и здесь добавлены для полноты UI:
 *    - credits        : кредиты (3-6)
 *    - hours          : академические часы (90-180)
 *    - letterGrade    : буквенная оценка (A, A-, B+, B, B-, C+, C, C-, D+, D, F, FX)
 *    - department     : кафедра, ведущая предмет
 *
 *  Уровень семестра (GradesMeta + кэш):
 *    - year, semester        : 2025/1 (осенний), 2025/2 (весенний) ...
 *    - label                 : «2025/2026 (осень)»
 *    - gpa                   : GPA текущего семестра
 *    - overallGpa            : кумулятивный GPA
 *    - totalSubjects         : число предметов
 *    - creditsEarned/total   : сводка по кредитам
 *    - parsedAt              : когда подтянули из Platonus
 *    - groupName             : группа («ИВТ-23-1»)
 *
 *  Уровень студента (профиль + transcript):
 *    - fullName, login
 *    - cumulativeGpa         : средний за всё время
 *    - transferGpa           : переводной GPA (часто отличается от cumulative)
 *    - completedCredits, totalProgramCredits
 *
 *  Категории состояния (используются в Kanban + статус-точках):
 *    - 'passed'   : финал известен и >= 70
 *    - 'ok'       : идёт нормально, риска нет
 *    - 'at-risk'  : средняя РК ниже 60 или нужен большой балл на экзамене
 *    - 'blocked'  : Платонус выставил «Недоп.» или средняя РК < 50
 *    - 'pending'  : данных мало, ждём оценок
 */

export type SubjectKind = 'regular' | 'coursework' | 'practice';

export type SubjectStatus =
    | 'passed'   // итог зафиксирован, >= 70
    | 'ok'       // в норме (>= 50 по средней, риска нет)
    | 'at-risk'  // средняя < 60 или нужен высокий балл на экзамене
    | 'blocked'  // Недоп. — нет допуска к экзамену
    | 'pending'; // мало данных / ещё идёт стадия РК1

export type LetterGrade =
    | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-'
    | 'D+' | 'D' | 'F' | 'FX' | '—';

export type SubjectStage =
    | 'rk1' | 'rk2' | 'exam' | 'final' | 'blocked' | 'unknown';

export interface GoalProjection {
    target: 50 | 70 | 90;
    status: 'ok' | 'achievable' | 'risk' | 'impossible';
    neededExam: number | null;
    neededRk2: number | null;
    projectedFinal: number | null;
}

export interface FakeSubject {
    id: string;
    code: string;            // «MAT2103»
    name: string;
    kind: SubjectKind;
    department: string;
    teachers: string[];
    credits: number;
    hours: number;

    // Базовые баллы (null = ещё не выставлен)
    rk1: number | null;
    rk2: number | null;
    coursework: number | null;   // для предметов с курсовой работой
    practice: number | null;     // для предметов с практической частью
    exam: number | null;
    rating: number | null;       // текущая семестровая сумма (РК-фаза)
    total: number | null;        // итоговая оценка

    // Производные
    letter: LetterGrade;
    status: SubjectStatus;
    stage: SubjectStage;
    stageLabel: string;
    admissionAverage: number | null; // (rk1+rk2)/2 или null
    minExamForPass: number | null;   // минимум на экзамене для итога >= 50
    minExamFor70: number | null;     // минимум на экзамене для итога >= 70
    minExamFor90: number | null;     // минимум на экзамене для итога >= 90
    projection: GoalProjection[];

    examDate?: string;               // ISO дата экзамена (если назначена)
    courseworkDeadline?: string;     // ISO дата сдачи курсовой
    rk1Date?: string;                // ISO дата проведённой РК1
    rk2Date?: string;                // ISO дата РК2
    blocked?: boolean;               // true если Недоп.
    isClosed?: boolean;              // период закрыт (прошлый семестр)
    note?: string;                   // короткая подсказка
}

export interface FakeSemester {
    year: number;
    semester: 1 | 2;
    label: string;
    gpa: number;
    creditsEarned: number;
    creditsTotal: number;
    parsedAt: string;
    isClosed: boolean;
    subjects: FakeSubject[];
}

export interface FakeStudent {
    fullName: string;
    login: string;
    group: string;
    program: string;
    course: number;
    cumulativeGpa: number;
    transferGpa: number;
    completedCredits: number;
    totalProgramCredits: number;
}

// =============================================================================
//  Хелперы для генерации
// =============================================================================

const RK = 0.3;
const EX = 0.4;

function letterFromScore(score: number | null): LetterGrade {
    if (score === null) return '—';
    if (score >= 95) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 75) return 'B-';
    if (score >= 70) return 'C+';
    if (score >= 65) return 'C';
    if (score >= 60) return 'C-';
    if (score >= 55) return 'D+';
    if (score >= 50) return 'D';
    if (score >= 25) return 'FX';
    return 'F';
}

function statusFor(opts: {
    blocked?: boolean;
    finalKnown: number | null;
    admission: number | null;
    minExam: number | null;
}): SubjectStatus {
    if (opts.blocked) return 'blocked';
    if (opts.finalKnown !== null) {
        if (opts.finalKnown >= 70) return 'passed';
        if (opts.finalKnown >= 50) return 'ok';
        return 'at-risk';
    }
    if (opts.admission !== null && opts.admission < 50) return 'blocked';
    if (opts.admission === null) return 'pending';
    if (opts.minExam !== null && opts.minExam >= 80) return 'at-risk';
    if (opts.admission >= 70) return 'ok';
    if (opts.admission >= 60) return 'ok';
    return 'at-risk';
}

function stageFor(opts: {
    blocked?: boolean;
    rk1: number | null;
    rk2: number | null;
    exam: number | null;
    total: number | null;
    kind: SubjectKind;
}): { stage: SubjectStage; label: string } {
    if (opts.kind !== 'regular') {
        if (opts.total !== null) return { stage: 'final', label: 'Итог выставлен' };
        return { stage: 'unknown', label: 'Ждём итоговую оценку' };
    }
    if (opts.total !== null && opts.exam !== null) {
        return { stage: 'final', label: 'Итог выставлен' };
    }
    if (opts.blocked) return { stage: 'blocked', label: 'Недопуск к экзамену' };
    if (opts.rk2 !== null) return { stage: 'exam', label: 'Остался экзамен' };
    if (opts.rk1 !== null) return { stage: 'rk2', label: 'Идёт вторая рубежка' };
    return { stage: 'rk1', label: 'Идёт первая рубежка' };
}

function buildProjection(opts: {
    rk1: number | null;
    rk2: number | null;
    finalKnown: number | null;
    kind: SubjectKind;
}): { projection: GoalProjection[]; minExamForPass: number | null; minExamFor70: number | null; minExamFor90: number | null } {
    const { rk1, rk2, finalKnown, kind } = opts;

    const minExamFor = (target: number): number | null => {
        if (kind !== 'regular') return null;
        if (rk1 === null || rk2 === null) return null;
        const need = Math.ceil((target - rk1 * RK - rk2 * RK) / EX);
        return Math.max(0, need);
    };

    const projection: GoalProjection[] = ([50, 70, 90] as const).map((target) => {
        if (finalKnown !== null) {
            return {
                target,
                status: finalKnown >= target ? 'ok' : 'impossible',
                neededExam: null,
                neededRk2: null,
                projectedFinal: finalKnown,
            };
        }
        const need = minExamFor(target);
        let status: GoalProjection['status'] = 'achievable';
        if (need === null) status = 'risk';
        else if (need <= 0) status = 'ok';
        else if (need > 100) status = 'impossible';
        else if (need >= 85) status = 'risk';

        let projected: number | null = null;
        if (rk1 !== null && rk2 !== null) {
            const assumedExam = Math.min(100, Math.max(0, need ?? 0));
            projected = Math.round(rk1 * RK + rk2 * RK + assumedExam * EX);
        }
        return { target, status, neededExam: need, neededRk2: null, projectedFinal: projected };
    });

    return {
        projection,
        minExamForPass: minExamFor(50),
        minExamFor70: minExamFor(70),
        minExamFor90: minExamFor(90),
    };
}

interface SeedSubject {
    id: string;
    code: string;
    name: string;
    kind?: SubjectKind;
    department: string;
    teachers: string[];
    credits: number;
    hours?: number;
    rk1?: number | null;
    rk2?: number | null;
    coursework?: number | null;
    practice?: number | null;
    exam?: number | null;
    total?: number | null;
    blocked?: boolean;
    examDate?: string;
    courseworkDeadline?: string;
    rk1Date?: string;
    rk2Date?: string;
    isClosed?: boolean;
    note?: string;
}

function mat(seed: SeedSubject): FakeSubject {
    const kind: SubjectKind = seed.kind ?? 'regular';
    const rk1 = seed.rk1 ?? null;
    const rk2 = seed.rk2 ?? null;
    const exam = seed.exam ?? null;
    const total = seed.total ?? null;
    const coursework = seed.coursework ?? null;
    const practice = seed.practice ?? null;
    const admission = rk1 !== null && rk2 !== null ? (rk1 + rk2) / 2 : null;

    let finalKnown: number | null = total;
    if (finalKnown === null && kind === 'regular' && rk1 !== null && rk2 !== null && exam !== null) {
        finalKnown = Math.round(rk1 * RK + rk2 * RK + exam * EX);
    }
    if (finalKnown === null && kind !== 'regular' && total !== null) {
        finalKnown = total;
    }

    // rating = текущая сумма за семестр (если экзамен не сдан — учитываем 0)
    let rating: number | null = null;
    if (rk1 !== null && rk2 !== null) {
        rating = Math.round(rk1 * 0.5 + rk2 * 0.5);
    } else if (rk1 !== null) {
        rating = rk1;
    }

    const { projection, minExamForPass, minExamFor70, minExamFor90 } = buildProjection({
        rk1, rk2, finalKnown, kind,
    });

    const stageInfo = stageFor({ blocked: seed.blocked, rk1, rk2, exam, total: finalKnown, kind });
    const status = statusFor({
        blocked: seed.blocked,
        finalKnown,
        admission,
        minExam: minExamForPass,
    });
    const letter = letterFromScore(finalKnown);

    return {
        id: seed.id,
        code: seed.code,
        name: seed.name,
        kind,
        department: seed.department,
        teachers: seed.teachers,
        credits: seed.credits,
        hours: seed.hours ?? seed.credits * 30,
        rk1, rk2, coursework, practice, exam, rating, total: finalKnown,
        letter, status,
        stage: stageInfo.stage,
        stageLabel: stageInfo.label,
        admissionAverage: admission,
        minExamForPass, minExamFor70, minExamFor90,
        projection,
        examDate: seed.examDate,
        courseworkDeadline: seed.courseworkDeadline,
        rk1Date: seed.rk1Date,
        rk2Date: seed.rk2Date,
        blocked: seed.blocked,
        isClosed: seed.isClosed,
        note: seed.note,
    };
}

// =============================================================================
//  Семестры
// =============================================================================

const currentSubjects: FakeSubject[] = [
    mat({
        id: 'mat2103', code: 'MAT2103', name: 'Высшая математика II',
        department: 'Кафедра математики', teachers: ['Иванова Г.М.', 'Серикова А.К.'],
        credits: 5, hours: 150,
        rk1: 78, rk2: 84, exam: null, total: null,
        examDate: '2026-06-08T10:00:00',
        rk1Date: '2026-03-18', rk2Date: '2026-05-04',
    }),
    mat({
        id: 'phy2204', code: 'PHY2204', name: 'Физика — электричество и магнетизм',
        department: 'Кафедра физики', teachers: ['Ким С.К.'],
        credits: 4, hours: 120,
        rk1: 42, rk2: 48, exam: null, total: null,
        blocked: false,
        examDate: '2026-06-12T13:00:00',
        rk1Date: '2026-03-22', rk2Date: '2026-05-07',
        note: 'Под угрозой — нужен высокий балл на экзамене',
    }),
    mat({
        id: 'cs2305', code: 'CS2305', name: 'Структуры данных и алгоритмы',
        department: 'Кафедра информатики', teachers: ['Петров П.П.'],
        credits: 6, hours: 180,
        rk1: 90, rk2: 88, exam: null, total: null,
        examDate: '2026-06-15T09:00:00',
        rk1Date: '2026-03-19', rk2Date: '2026-05-05',
    }),
    mat({
        id: 'cs2310', code: 'CS2310', name: 'Базы данных',
        department: 'Кафедра информатики', teachers: ['Алиева А.А.'],
        credits: 5, hours: 150,
        rk1: 82, rk2: 76, coursework: 88, exam: null, total: null,
        examDate: '2026-06-18T11:00:00',
        courseworkDeadline: '2026-05-15',
        rk1Date: '2026-03-20', rk2Date: '2026-05-06',
        note: 'Курсовая зачтена',
    }),
    mat({
        id: 'eng2201', code: 'ENG2201', name: 'Профессиональный английский',
        department: 'Кафедра иностранных языков', teachers: ['Smith J.', 'Назарова Д.Е.'],
        credits: 3, hours: 90,
        rk1: 65, rk2: 70, exam: null, total: null,
        examDate: '2026-06-05T15:00:00',
        rk1Date: '2026-03-17', rk2Date: '2026-05-03',
    }),
    mat({
        id: 'phi2102', code: 'PHI2102', name: 'Философия',
        department: 'Кафедра социально-гуманитарных дисциплин', teachers: ['Серикбаев Б.К.'],
        credits: 3, hours: 90,
        rk1: 30, rk2: null, exam: null, total: null,
        blocked: true,
        examDate: '2026-06-22T10:00:00',
        rk1Date: '2026-03-21',
        note: 'Платонус выставил Недоп.',
    }),
    mat({
        id: 'cs2401', code: 'CS2401', name: 'Курсовая работа по программированию',
        kind: 'coursework',
        department: 'Кафедра информатики', teachers: ['Петров П.П.'],
        credits: 2, hours: 60,
        rk1: null, rk2: null, total: 92,
        courseworkDeadline: '2026-05-22',
    }),
    mat({
        id: 'pr2501', code: 'PR2501', name: 'Производственная практика',
        kind: 'practice',
        department: 'Кафедра информатики', teachers: ['Алиева А.А.'],
        credits: 4, hours: 240,
        rk1: null, rk2: null, total: 87,
        note: 'Практика на «Тенгизшевройл», 4 недели',
    }),
    mat({
        id: 'eco2103', code: 'ECO2103', name: 'Экономика предприятия',
        department: 'Кафедра экономики', teachers: ['Жунусова Г.С.'],
        credits: 3, hours: 90,
        rk1: 70, rk2: null, exam: null, total: null,
        examDate: '2026-06-20T13:00:00',
        rk1Date: '2026-03-24',
    }),
    mat({
        id: 'pe2201', code: 'PE2201', name: 'Физическая культура',
        department: 'Кафедра физвоспитания', teachers: ['Алимов Е.С.'],
        credits: 2, hours: 60,
        rk1: 95, rk2: 92, exam: null, total: null,
        examDate: '2026-06-03T08:00:00',
        rk1Date: '2026-03-15', rk2Date: '2026-05-02',
    }),
];

const previousSubjects: FakeSubject[] = [
    mat({
        id: 'mat1102', code: 'MAT1102', name: 'Высшая математика I',
        department: 'Кафедра математики', teachers: ['Иванова Г.М.'],
        credits: 5, hours: 150,
        rk1: 84, rk2: 90, exam: 88, total: 87, isClosed: true,
    }),
    mat({
        id: 'phy1203', code: 'PHY1203', name: 'Физика — механика',
        department: 'Кафедра физики', teachers: ['Ким С.К.'],
        credits: 4, hours: 120,
        rk1: 72, rk2: 68, exam: 74, total: 71, isClosed: true,
    }),
    mat({
        id: 'cs1101', code: 'CS1101', name: 'Введение в программирование',
        department: 'Кафедра информатики', teachers: ['Петров П.П.'],
        credits: 5, hours: 150,
        rk1: 96, rk2: 92, exam: 94, total: 94, isClosed: true,
    }),
    mat({
        id: 'his1101', code: 'HIS1101', name: 'Современная история Казахстана',
        department: 'Кафедра социально-гуманитарных дисциплин', teachers: ['Серикбаев Б.К.'],
        credits: 5, hours: 150,
        rk1: 88, rk2: 86, exam: 90, total: 88, isClosed: true,
    }),
    mat({
        id: 'eng1101', code: 'ENG1101', name: 'Английский язык — базовый',
        department: 'Кафедра иностранных языков', teachers: ['Smith J.'],
        credits: 3, hours: 90,
        rk1: 78, rk2: 80, exam: 82, total: 80, isClosed: true,
    }),
    mat({
        id: 'chem1101', code: 'CHEM1101', name: 'Химия',
        department: 'Кафедра химии', teachers: ['Оспанов Т.К.'],
        credits: 4, hours: 120,
        rk1: 55, rk2: 60, exam: 58, total: 58, isClosed: true,
    }),
    mat({
        id: 'pe1201', code: 'PE1201', name: 'Физическая культура',
        department: 'Кафедра физвоспитания', teachers: ['Алимов Е.С.'],
        credits: 2, hours: 60,
        rk1: 92, rk2: 95, exam: 93, total: 93, isClosed: true,
    }),
    mat({
        id: 'eco1101', code: 'ECO1101', name: 'Основы экономики',
        department: 'Кафедра экономики', teachers: ['Жунусова Г.С.'],
        credits: 3, hours: 90,
        rk1: 74, rk2: 72, exam: 70, total: 72, isClosed: true,
    }),
];

export const semesters: FakeSemester[] = [
    {
        year: 2025,
        semester: 2,
        label: '2025/2026 (весна)',
        gpa: 3.31,
        creditsEarned: 0,
        creditsTotal: currentSubjects.reduce((s, x) => s + x.credits, 0),
        parsedAt: '2026-05-19T12:14:00',
        isClosed: false,
        subjects: currentSubjects,
    },
    {
        year: 2025,
        semester: 1,
        label: '2025/2026 (осень)',
        gpa: 3.42,
        creditsEarned: previousSubjects.reduce((s, x) => s + x.credits, 0),
        creditsTotal: previousSubjects.reduce((s, x) => s + x.credits, 0),
        parsedAt: '2026-01-12T09:30:00',
        isClosed: true,
        subjects: previousSubjects,
    },
];

export const student: FakeStudent = {
    fullName: 'Серіков Аян Маратұлы',
    login: 'serikov_ayan',
    group: 'ИВТ-23-1',
    program: 'Информатика и вычислительная техника',
    course: 2,
    cumulativeGpa: 3.37,
    transferGpa: 3.41,
    completedCredits: previousSubjects.reduce((s, x) => s + x.credits, 0) + 38,
    totalProgramCredits: 240,
};

export const currentSemester = semesters[0];
export const previousSemester = semesters[1];

// Доп. удобства
export const fakeSubjects: FakeSubject[] = currentSubjects;
export const fakeAverage = currentSemester.gpa;

export function statusOrder(): SubjectStatus[] {
    return ['blocked', 'at-risk', 'pending', 'ok', 'passed'];
}

export function getLetterTone(letter: LetterGrade): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
    if (letter === '—') return 'neutral';
    if (['A', 'A-', 'B+'].includes(letter)) return 'success';
    if (['B', 'B-', 'C+'].includes(letter)) return 'info';
    if (['C', 'C-', 'D+', 'D'].includes(letter)) return 'warning';
    return 'danger';
}

export function getScoreTone(value: number | null): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
    if (value === null) return 'neutral';
    if (value >= 90) return 'success';
    if (value >= 70) return 'info';
    if (value >= 50) return 'warning';
    return 'danger';
}
