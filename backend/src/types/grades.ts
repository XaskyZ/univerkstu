/**
 * Типы для системы оценок (Platonus)
 */

export interface Exam {
    name: string;       // "РК 1", "РК 2", "Экз.", "Курс.р."
    mark: string | number;  // Оценка или "-"
}

/**
 * Тип предмета.
 * - regular: обычный предмет с РК1/РК2/экзаменом
 * - coursework: курсовая работа — экзамена нет, итог в Рейтинг/total
 * - practice: практика — экзамена нет, итог в Рейтинг/total
 */
export type SubjectKind = 'regular' | 'coursework' | 'practice';

export interface Subject {
    subjectName: string;
    exams: Exam[];
    totalMark?: string | number;    // Итоговая оценка (приоритет 1)
    centerMark?: string | number;   // Запасной вариант (приоритет 2)
    totalScore?: string | number;   // Другие поля (приоритет 3)
    total?: string | number;        // Ещё один вариант
}

export interface GradesMeta {
    parsedAt: string;       // ISO timestamp
    year: number;           // Учебный год
    semester: number;       // 1 или 2
    totalSubjects: number;  // Количество предметов
    gpa?: number;           // Текущий GPA (если доступен)
    overallGpa?: number;    // За всё время (если доступен)
    groupName?: string;     // Группа студента из transcript (если доступна)
    // History maps from Platonus /rest/transcript/load. Keys are
    // term/course labels emitted by Platonus verbatim (e.g. "2024-1",
    // "2024-2" for terms; "1", "2", "3", "4" for courses). UI can build a
    // GPA-over-time chart without re-parsing transcript HTML.
    termGpaMap?: Record<string, number>;
    courseGpaMap?: Record<string, number>;
}

export interface GradesData {
    meta: GradesMeta;
    subjects: SubjectGrade[];
}

/**
 * Обработанные данные предмета для фронтенда
 */
export interface DetailedGrade {
    date: string;           // Дата в формате DD-MM-YYYY (или ISO)
    mark: number;           // Оценка (например, 90)
    type?: string;          // Тип оценки ("Текущая", "Рубежный контроль" и т.д. опционально)
    title?: string | null;  // Название компонента / ведомости
    month?: string | null;  // Месяц из исходного журнала
    teacher?: string | null; // Преподаватель, если Platonus его отдал
    comment?: string | null; // Комментарий / описание работы, если Platonus его отдал
}

export interface SubjectGrade {
    name: string;           // Название предмета
    code?: string;          // Код дисциплины (если извлечен из скобок)
    tutors?: string[];      // Список преподавателей
    kind: SubjectKind;      // Тип предмета (regular/coursework/practice)
    rk1: string;            // Оценка РК 1 или "-"
    rk2: string;            // Оценка РК 2 или "-"
    rating?: string;        // Оценка "Рейтинг" или "-"
    exam: string;           // Оценка экзамена/курсовой или "-"
    total: string;          // Итоговая оценка или "-"
    examDate?: string;      // Дата экзамена из calendarEvents (если удалось сопоставить)
    details?: DetailedGrade[]; // Детальные оценки с датами
    subjectID?: string;     // ID предмета для запроса деталей
    queryID?: string;       // Query ID для запроса деталей
}

export interface ParseGradesResult {
    success: boolean;
    data?: GradesData;
    error?: string;
}
