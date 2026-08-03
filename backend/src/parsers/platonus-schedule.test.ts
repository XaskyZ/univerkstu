import { describe, it, expect } from 'vitest';
import {
    parsePlatonusSchedule,
    computeSemesterWeek,
    pickWeekPair,
    trimSeconds,
    approximateSemesterStart,
    type PlatonusScheduleWeek,
    type PlatonusRawLesson,
    type PlatonusLessonHour,
} from './platonus-schedule.js';
import type { Lesson } from '../types/index.js';

// Сетка пар осени 2026-2027 (обрезанный фрагмент реального дампа
// scratchpad/platonus-schedule.json): number — сквозной id из БД, не порядковый.
const LESSON_HOURS: PlatonusLessonHour[] = [
    { number: 36, start: '09:00:00', finish: '10:45:00', shiftNumber: 1, displayNumber: 1, duration: 105 },
    { number: 37, start: '10:55:00', finish: '12:40:00', shiftNumber: 1, displayNumber: 2, duration: 105 },
    { number: 38, start: '13:10:00', finish: '14:55:00', shiftNumber: 1, displayNumber: 3, duration: 105 },
    { number: 39, start: '15:05:00', finish: '16:50:00', shiftNumber: 1, displayNumber: 4, duration: 105 },
    { number: 40, start: '17:00:00', finish: '18:45:00', shiftNumber: 1, displayNumber: 5, duration: 105 },
];

interface FixtureLesson {
    day: string;   // ключ дня Platonus: '1' = Пн … '6' = Сб
    hour: number;  // lessonHours.number
    lesson: PlatonusRawLesson;
}

function makeWeek(items: FixtureLesson[], week = 1): PlatonusScheduleWeek {
    const days: NonNullable<NonNullable<PlatonusScheduleWeek['timetable']>['days']> = {};
    for (const item of items) {
        days[item.day] = days[item.day] || { lessons: {} };
        const dayLessons = days[item.day].lessons!;
        dayLessons[String(item.hour)] = dayLessons[String(item.hour)] || { lessons: [] };
        dayLessons[String(item.hour)].lessons!.push(item.lesson);
    }
    return {
        selectedStudyYear: 2026,
        selectedTerm: 1,
        selectedWeek: week,
        lessonHours: LESSON_HOURS,
        timetable: { days },
    };
}

// Фрагменты реальных занятий из дампа (осень 2026-2027, тест-учётка)
const DB_LECTURE: PlatonusRawLesson = {
    subjectName: 'Безопасность баз данных',
    groupTypeShortName: 'Л',
    groupTypeFullName: 'Лекции',
    tutorName: ' Досмаганбетов Д.А.',
    tutorShortName: 'Досмаганбетов Д.А.',
    auditory: '422б',
    building: 'Главный корпус',
    number: 39,
};

const LAW_SEMINAR: PlatonusRawLesson = {
    subjectName: 'Основы права, Основы антикоррупционной культуры',
    groupTypeShortName: 'СПЗ',
    groupTypeFullName: 'Практики, Семинары',
    tutorShortName: 'Егізбай А.Т.',
    auditory: '232',
    building: 'корпус №1',
    number: 39,
};

const NETSEC_LECTURE: PlatonusRawLesson = {
    subjectName: 'Защита сетевых информационных технологий',
    groupTypeShortName: 'Л',
    groupTypeFullName: 'Лекции',
    tutorShortName: 'Қыдырғали ұлы Д.',
    auditory: '420',
    building: 'Главный корпус',
    number: 36,
};

const SEMESTER = { year: 2026, term: 1 };

function flatLessons(
    parsed: ReturnType<typeof parsePlatonusSchedule>,
    dayName: string
): Array<{ slot: number; lesson: Lesson }> {
    const day = parsed.days.find((d) => d.name === dayName)!;
    const out: Array<{ slot: number; lesson: Lesson }> = [];
    day.lessons.forEach((slot, slotIndex) => {
        for (const lesson of slot) out.push({ slot: slotIndex, lesson });
    });
    return out;
}

describe('trimSeconds', () => {
    it('обрезает HH:MM:SS до HH:MM', () => {
        expect(trimSeconds('09:00:00')).toBe('09:00');
        expect(trimSeconds('17:45:30')).toBe('17:45');
    });

    it('оставляет уже короткое время и пустые значения как есть', () => {
        expect(trimSeconds('09:00')).toBe('09:00');
        expect(trimSeconds(undefined)).toBe('');
    });
});

describe('computeSemesterWeek / pickWeekPair', () => {
    it('первая неделя осеннего семестра начинается 1 сентября учебного года', () => {
        // Не опираемся на startSemesterPeriod Platonus — он отдаёт прошлогодние даты.
        const start = approximateSemesterStart(2026, 1);
        expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 8, 1]);
        expect(computeSemesterWeek(2026, 1, new Date(2026, 8, 1))).toBe(1);
        expect(computeSemesterWeek(2026, 1, new Date(2026, 8, 7))).toBe(1);
        expect(computeSemesterWeek(2026, 1, new Date(2026, 8, 8))).toBe(2);
    });

    it('зажимает неделю в границы 1..15', () => {
        expect(computeSemesterWeek(2026, 1, new Date(2026, 7, 1))).toBe(1);   // до старта
        expect(computeSemesterWeek(2026, 1, new Date(2027, 5, 1))).toBe(15);  // после конца
    });

    it('подбирает пару нечётная+чётная вокруг текущей недели', () => {
        expect(pickWeekPair(1)).toEqual({ oddWeek: 1, evenWeek: 2 });
        expect(pickWeekPair(4)).toEqual({ oddWeek: 3, evenWeek: 4 });
        expect(pickWeekPair(7)).toEqual({ oddWeek: 7, evenWeek: 8 });
        expect(pickWeekPair(15)).toEqual({ oddWeek: 15, evenWeek: 14 });
    });
});

describe('parsePlatonusSchedule — сетка', () => {
    it('lessonHours → timeSlots c обрезкой секунд и сортировкой по displayNumber', () => {
        const parsed = parsePlatonusSchedule(makeWeek([]), makeWeek([], 2), SEMESTER);
        expect(parsed.timeSlots).toHaveLength(5);
        expect(parsed.timeSlots[0]).toMatchObject({ start: '09:00', end: '10:45' });
        expect(parsed.timeSlots[4]).toMatchObject({ start: '17:00', end: '18:45' });
    });

    it('дни 1..6 → mon..sat, у каждого дня по слоту на каждую пару', () => {
        const parsed = parsePlatonusSchedule(makeWeek([]), makeWeek([], 2), SEMESTER);
        expect(parsed.days.map((d) => d.name)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
        for (const day of parsed.days) {
            expect(day.lessons).toHaveLength(5);
        }
    });

    it('маппит поля занятия: title/type/teacher/room и building → faculty', () => {
        const odd = makeWeek([{ day: '3', hour: 39, lesson: DB_LECTURE }]);
        const even = makeWeek([{ day: '3', hour: 39, lesson: DB_LECTURE }], 2);
        const parsed = parsePlatonusSchedule(odd, even, SEMESTER);

        const wed = flatLessons(parsed, 'wed');
        expect(wed).toHaveLength(1);
        // Пара 39 = displayNumber 4 → индекс слота 3
        expect(wed[0].slot).toBe(3);
        expect(wed[0].lesson).toMatchObject({
            title: 'Безопасность баз данных',
            type: 'Л',
            teacher: 'Досмаганбетов Д.А.',
            room: '422б',
            faculty: 'Главный корпус',
            parity: 'all',
        });
    });

    it('заполняет meta: source=platonus и семестр', () => {
        const parsed = parsePlatonusSchedule(makeWeek([]), makeWeek([], 2), SEMESTER);
        expect(parsed.meta.source).toBe('platonus');
        expect(parsed.meta.semester).toMatchObject({ year: 2026, term: 1 });
        expect(parsed.meta.tz).toBe('Asia/Almaty');
    });
});

describe('parsePlatonusSchedule — чётность (parity)', () => {
    it('занятие в обеих неделях → all; только в нечётной → num; только в чётной → den', () => {
        const odd = makeWeek([
            { day: '3', hour: 39, lesson: DB_LECTURE },   // есть в обеих
            { day: '4', hour: 39, lesson: LAW_SEMINAR },  // только нечётная
        ]);
        const even = makeWeek([
            { day: '3', hour: 39, lesson: DB_LECTURE },     // есть в обеих
            { day: '3', hour: 36, lesson: NETSEC_LECTURE }, // только чётная
        ], 2);

        const parsed = parsePlatonusSchedule(odd, even, SEMESTER);

        const wed = flatLessons(parsed, 'wed');
        const thu = flatLessons(parsed, 'thu');

        const dbLecture = wed.find((l) => l.lesson.title === 'Безопасность баз данных');
        expect(dbLecture?.lesson.parity).toBe('all');

        const lawSeminar = thu.find((l) => l.lesson.title.startsWith('Основы права'));
        expect(lawSeminar?.lesson.parity).toBe('num');

        const netsec = wed.find((l) => l.lesson.title === 'Защита сетевых информационных технологий');
        expect(netsec?.lesson.parity).toBe('den');
        expect(netsec?.slot).toBe(0); // пара 36 = первый слот

        // Ничего не задублировалось
        expect(wed).toHaveLength(2);
        expect(thu).toHaveLength(1);
    });

    it('смена аудитории между неделями = два занятия с parity num и den', () => {
        // Реальный кейс из дампа: Безопасность баз данных ЛЗ в сб — на нечётной
        // неделе пара 38, на чётной 37 и 38. Здесь проверяем смену аудитории.
        const inRoom426: PlatonusRawLesson = { ...DB_LECTURE, auditory: '426' };
        const odd = makeWeek([{ day: '6', hour: 38, lesson: DB_LECTURE }]);
        const even = makeWeek([{ day: '6', hour: 38, lesson: inRoom426 }], 2);

        const parsed = parsePlatonusSchedule(odd, even, SEMESTER);
        const sat = flatLessons(parsed, 'sat');

        expect(sat).toHaveLength(2);
        const numLesson = sat.find((l) => l.lesson.parity === 'num');
        const denLesson = sat.find((l) => l.lesson.parity === 'den');
        expect(numLesson?.lesson.room).toBe('422б');
        expect(denLesson?.lesson.room).toBe('426');
        // Оба — в одном слоте (пара 38 = displayNumber 3 → индекс 2)
        expect(numLesson?.slot).toBe(2);
        expect(denLesson?.slot).toBe(2);
    });

    it('одинаковое занятие в разных парах недель НЕ считается одним (ключ включает номер пары)', () => {
        const odd = makeWeek([{ day: '6', hour: 38, lesson: DB_LECTURE }]);
        const even = makeWeek([{ day: '6', hour: 37, lesson: DB_LECTURE }], 2);

        const parsed = parsePlatonusSchedule(odd, even, SEMESTER);
        const sat = flatLessons(parsed, 'sat');

        expect(sat).toHaveLength(2);
        expect(sat.find((l) => l.slot === 2)?.lesson.parity).toBe('num');
        expect(sat.find((l) => l.slot === 1)?.lesson.parity).toBe('den');
    });

    it('пустые/заглушечные ячейки игнорируются', () => {
        const odd = makeWeek([
            { day: '3', hour: 39, lesson: { empty: true } },
            { day: '3', hour: 38, lesson: { subjectName: '   ' } },
        ]);
        const parsed = parsePlatonusSchedule(odd, makeWeek([], 2), SEMESTER);
        expect(flatLessons(parsed, 'wed')).toHaveLength(0);
    });
});
