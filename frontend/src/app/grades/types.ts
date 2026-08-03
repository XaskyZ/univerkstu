import type { PlatonusSemester } from '@/lib/api';

export const GOAL_OPTIONS = [50, 70, 90] as const;
export type GoalOption = (typeof GOAL_OPTIONS)[number];

export type AssistantStatus = 'ok' | 'achievable' | 'risk' | 'impossible';
export type ParsedScoreKind = 'number' | 'missing' | 'blocked' | 'text';
export type SubjectStage = 'rk1' | 'rk2' | 'exam' | 'final' | 'blocked' | 'unknown';

/**
 * Краткий статус предмета для компактного списка `/grades`.
 * Раскладка человекочитаемых меток лежит в `messages.grades.statusLabel.*`.
 */
export type SubjectStatusKey =
    | 'final'           // итог уже выставлен
    | 'awaiting-exam'   // обе РК закрыты, ждём экзамен
    | 'awaiting-final'  // курсовая/практика без итога ИЛИ ещё идут рубежки
    | 'blocked'         // недопуск
    | 'no-data';        // ни одной оценки

export interface ParsedScore {
    kind: ParsedScoreKind;
    raw: string;
    value: number | null;
}

export interface GoalInsight {
    target: GoalOption;
    status: AssistantStatus;
    title: string;
    summary: string;
    neededExam: number | null;
    neededSemesterPoints: number | null;
    neededRk2: number | null;
    safeSemesterPoints: number | null;
    remainingSemesterCapacity: number | null;
    currentSemesterPoints: number | null;
    projectedFinal: number | null;
}

export interface SubjectAssistantModel {
    stage: SubjectStage;
    stageTitle: string;
    stageSummary: string;
    stageTone: AssistantStatus;
    isBlocked: boolean;
    isClosed: boolean;
    finalKnown: number | null;
    previewTotal: number | null;
    currentSemesterPoints: number | null;
    remainingSemesterCapacity: number | null;
    examValue: number | null;
    availableDataLabel: string;
    goalInsights: Record<GoalOption, GoalInsight>;
}

export interface CachedPlatonusStatus {
    connected: boolean;
    login: string | null;
    availableSemesters: PlatonusSemester[];
    preferredSemester?: {
        year: number;
        semester: number;
    } | null;
    updatedAt: string;
}

export const BLOCKED_MARKERS = ['недоп', 'nedop', 'not admitted'];
export const RK_WEIGHT = 0.3;
export const EXAM_WEIGHT = 0.4;
