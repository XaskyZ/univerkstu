import { describe, it, expect } from 'vitest';
import {
    extractFaculty,
    extractParity,
    extractPeriod,
    extractRoom,
    extractSemesterLinks,
    extractTime,
    extractWeekOptions,
    orderSemesterCandidates,
    parseScheduleTable,
    pickWeekForDate,
    splitTitleAndType,
} from './schedule.js';

// ---------------------------------------------------------------------------
// Фикстуры — обрезанные фрагменты реального HTML портала (август 2026).
// ---------------------------------------------------------------------------

/** Хаб /student/myschedule/: три семестра, weekSelect пуст (осень не опубликована). */
const LANDING_HTML = `
<table cellpadding="0" cellspacing="0" class="mt">
    <tr class="top">
        <td class="lt"></td>
        <td class="ct" unselectable="on">
                <a href="/student/myschedule/2026/1">
                    Расписание учебных занятий Осенний семестра на 2026-2027 учебный год
                </a>
                <a href="/student/myschedule/print/2026/1" onclick="window.open($(this).attr('href')); return false;">Печать</a>
        </td>
        <td class="rt"></td>
    </tr>
    <tr class="mid">
        <td class="lt"></td>
        <td class="ts">
                <a href="/student/myschedule/2025/2" class="lt">
                    <img src="/content/icons/tb_left.png" alt=" [<<] " />Расписание учебных занятий Весенний семестра на 2025-2026 учебный год
                </a>
                <a href="/student/myschedule/2026/2" class="rt">
                    Расписание учебных занятий Весенний семестра на 2026-2027 учебный год
                    <img src="/content/icons/tb_right.png" alt=" [>>] ">
                </a>
        </td>
        <td class="rt"></td>
    </tr>
    <tr class="mid">
        <td class="lt"></td>
        <td class="ts">
            <select id="weekSelect" autocomplete="off" onchange="location = this.value;">
            </select>
        </td>
        <td class="rt"></td>
    </tr>
</table>`;

/** Страница семестра /student/myschedule/2025/2: weekSelect с неделями. */
const SEMESTER_PAGE_HTML = `
<td class="ct" unselectable="on">
    <a href="/student/myschedule/2025/2">Расписание учебных занятий Весенний семестра на 2025-2026 учебный год</a>
</td>
<select id="weekSelect" autocomplete="off" onchange="location = this.value;">
        <option value="/student/myschedule/2025/2/26.01.2026/01.02.2026/">
            Неделя 01. 26.01.2026 - 01.02.2026
        </option>
        <option value="/student/myschedule/2025/2/02.02.2026/08.02.2026/">
            Неделя 02. 02.02.2026 - 08.02.2026
        </option>
        <option value="/student/myschedule/2025/2/04.05.2026/10.05.2026/">
            Неделя 15. 04.05.2026 - 10.05.2026
        </option>
</select>`;

/** Страница недели: table.schedule (обрезанный фрагмент реальной сетки). */
const WEEK_PAGE_HTML = `
<table class="schedule" cellpadding="0" cellspacing="0" style="width: 100%;">
    <tr style="height: 20px; border:1px solid Green">
        <th style="width: 25px;">&nbsp;</th>
        <th style=" text-align: center;">ПН</th>
        <th style=" text-align: center;">ВТ</th>
        <th style=" text-align: center;">СР</th>
        <th style=" text-align: center;">ЧТ</th>
        <th style=" text-align: center;">ПТ</th>
        <th style=" text-align: center;">СБ</th>
    </tr>
    <tr style="min-height: 120px;">
        <td class="time">
            <div class="divIE" style="display:none;">09:00-10:45</div>
            <div class="divnotIE" style="display:none;" name="asdf"></div>
        </td>
        <td class="field">&nbsp;</td>
        <td class="field" style="background-color: #D9E8FB;">
            <div class="groups">
                <div style="min-width:100px;">
                    <p class="teacher">Криптография, курсовой проект(Лабораторное занятие)</p><p class="teacher">Рожкова О. О.</p>
                    <p class="params">
                        <span class="aud_faculty" title="Аудитория факультета: главный корпус">ГЛА</span><span>Ауд.: Гк430</span>
                    </p>
                    <p class="params">
                        <span class="dateStartLbl">Период с 26.01 по 09.05</span>
                    </p>
                </div>
            </div>
        </td>
        <td class="field">&nbsp;</td>
        <td class="field">&nbsp;</td>
        <td class="field" style="background-color: #D9E8FB;">
            <div class="groups">
                <div style="min-width:100px;">
                    <p class="teacher">Системное программирование(Лекция)</p><p class="teacher">Қыдырғали ұлы Д.</p>
                    <p class="params">
                        <span class="aud_faculty" title="Аудитория факультета: главный корпус">ГЛА</span><span>Ауд.: Гк441</span>
                    </p>
                    <p class="params">
                        <span class="dateStartLbl">Период с 26.01 по 09.05</span>
                        <span class="denominator">Числитель</span>
                    </p>
                </div>
            </div>
        </td>
        <td class="field">&nbsp;</td>
    </tr>
</table>`;

describe('extractSemesterLinks', () => {
    it('finds all semester links, header link first, print links excluded', () => {
        const links = extractSemesterLinks(LANDING_HTML);
        expect(links).toHaveLength(3);
        expect(links[0]).toMatchObject({ year: 2026, term: 1, href: '/student/myschedule/2026/1' });
        expect(links[0].title).toContain('Осенний семестра на 2026-2027');
        expect(links.map((l) => `${l.year}/${l.term}`)).toEqual(['2026/1', '2025/2', '2026/2']);
    });

    it('returns empty array when there are no semester links', () => {
        expect(extractSemesterLinks('<div>Нет расписания</div>')).toEqual([]);
    });
});

describe('extractWeekOptions', () => {
    it('parses week options for the requested semester', () => {
        const weeks = extractWeekOptions(SEMESTER_PAGE_HTML, { year: 2025, term: 2 });
        expect(weeks).toHaveLength(3);
        expect(weeks[0]).toMatchObject({
            url: '/student/myschedule/2025/2/26.01.2026/01.02.2026/',
            start: '26.01.2026',
            end: '01.02.2026',
        });
        expect(weeks[0].label).toContain('Неделя 01');
    });

    it('ignores weeks belonging to another semester', () => {
        expect(extractWeekOptions(SEMESTER_PAGE_HTML, { year: 2026, term: 1 })).toEqual([]);
    });

    it('returns empty array for an empty weekSelect (semester not published)', () => {
        expect(extractWeekOptions(LANDING_HTML, { year: 2026, term: 1 })).toEqual([]);
    });
});

describe('pickWeekForDate', () => {
    const weeks = extractWeekOptions(SEMESTER_PAGE_HTML, { year: 2025, term: 2 });

    it('picks the week containing today', () => {
        const picked = pickWeekForDate(weeks, new Date(2026, 1, 4)); // 04.02.2026
        expect(picked?.start).toBe('02.02.2026');
    });

    it('picks the first upcoming week when today is before the semester', () => {
        const picked = pickWeekForDate(weeks, new Date(2026, 0, 1)); // 01.01.2026
        expect(picked?.start).toBe('26.01.2026');
    });

    it('picks the last week when the semester is already over', () => {
        const picked = pickWeekForDate(weeks, new Date(2026, 7, 2)); // 02.08.2026
        expect(picked?.start).toBe('04.05.2026');
    });

    it('returns null for an empty week list', () => {
        expect(pickWeekForDate([], new Date())).toBeNull();
    });
});

describe('orderSemesterCandidates', () => {
    const links = extractSemesterLinks(LANDING_HTML);

    it('puts the semester matching the current academic period first', () => {
        const ordered = orderSemesterCandidates(links, { year: 2026, semester: 1 }, new Date(2026, 7, 2));
        expect(ordered.map((l) => `${l.year}/${l.term}`)).toEqual(['2026/1', '2025/2', '2026/2']);
    });

    it('prefers already-started semesters over future ones for fallback', () => {
        // Желаемый семестр отсутствует в ссылках — первый кандидат остаётся
        // заголовочный (2026/1), затем прошедший 2025/2, будущий 2026/2 — последним.
        const ordered = orderSemesterCandidates(links, { year: 2030, semester: 1 }, new Date(2026, 7, 2));
        expect(ordered.map((l) => `${l.year}/${l.term}`)).toEqual(['2026/1', '2025/2', '2026/2']);
    });

    it('keeps the portal-default (header) link as the second candidate when desired differs', () => {
        const ordered = orderSemesterCandidates(links, { year: 2025, semester: 2 }, new Date(2026, 3, 1));
        expect(ordered[0]).toMatchObject({ year: 2025, term: 2 });
        expect(ordered[1]).toMatchObject({ year: 2026, term: 1 });
    });
});

describe('parseScheduleTable (new week-page markup)', () => {
    it('parses days, time slots and lessons from the per-week table', () => {
        const schedule = parseScheduleTable(WEEK_PAGE_HTML);

        expect(schedule.days.map((d) => d.name)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
        expect(schedule.timeSlots).toHaveLength(1);
        expect(schedule.timeSlots[0]).toMatchObject({ start: '09:00', end: '10:45' });

        const tueLessons = schedule.days[1].lessons.flat();
        expect(tueLessons).toHaveLength(1);
        expect(tueLessons[0]).toMatchObject({
            title: 'Криптография, курсовой проект',
            type: 'Лабораторное занятие',
            teacher: 'Рожкова О. О.',
            room: 'Гк430',
            faculty: 'ГЛА',
            parity: 'all',
        });

        const friLessons = schedule.days[4].lessons.flat();
        expect(friLessons).toHaveLength(1);
        expect(friLessons[0]).toMatchObject({
            title: 'Системное программирование',
            type: 'Лекция',
            teacher: 'Қыдырғали ұлы Д.',
            room: 'Гк441',
            parity: 'num',
        });
        expect(friLessons[0].period).toContain('Период с 26.01 по 09.05');

        // Пустые дни присутствуют, но без занятий
        expect(schedule.days[2].lessons.flat()).toHaveLength(0);
    });

    it('throws when the schedule table is missing (hub page)', () => {
        expect(() => parseScheduleTable(LANDING_HTML)).toThrow('не найдена');
    });
});

describe('extractTime', () => {
    it('returns null start/end when no time match', () => {
        const result = extractTime('Нет времени');
        expect(result.start).toBeNull();
        expect(result.end).toBeNull();
        expect(result.segments).toEqual([]);
        expect(result.raw).toBe('Нет времени');
    });

    it('parses a single time slot', () => {
        const result = extractTime('08:00-08:45');
        expect(result.start).toBe('08:00');
        expect(result.end).toBe('08:45');
        expect(result.segments).toEqual([{ start: '08:00', end: '08:45' }]);
    });

    it('parses two-segment paired slot and uses outer bounds for start/end', () => {
        const result = extractTime('08:00-08:45 / 08:50-09:30');
        expect(result.start).toBe('08:00');
        expect(result.end).toBe('09:30');
        expect(result.segments).toEqual([
            { start: '08:00', end: '08:45' },
            { start: '08:50', end: '09:30' },
        ]);
    });

    it('collapses extra whitespace in raw output', () => {
        const result = extractTime('  08:00-08:45    extra   ');
        expect(result.raw).toBe('08:00-08:45 extra');
    });

    it('handles 3-segment slot (uncommon but supported)', () => {
        const result = extractTime('08:00-08:30 / 08:35-09:00 / 09:05-09:30');
        expect(result.segments).toHaveLength(3);
        expect(result.start).toBe('08:00');
        expect(result.end).toBe('09:30');
    });

    it('ignores malformed time-like substrings that do not match HH:MM-HH:MM', () => {
        const result = extractTime('8:0-8:45');
        expect(result.start).toBeNull();
        expect(result.end).toBeNull();
    });

    it('extracts time embedded in surrounding text', () => {
        const result = extractTime('Время: 14:00-15:30 утром');
        expect(result.start).toBe('14:00');
        expect(result.end).toBe('15:30');
    });
});

describe('splitTitleAndType', () => {
    it('returns null type when no parenthesised label', () => {
        const result = splitTitleAndType('Математика');
        expect(result).toEqual({ title: 'Математика', type: null });
    });

    it('extracts the type from a parenthesised suffix', () => {
        const result = splitTitleAndType('Высшая математика (Лекция)');
        expect(result).toEqual({ title: 'Высшая математика', type: 'Лекция' });
    });

    it('trims surrounding whitespace', () => {
        const result = splitTitleAndType('   Алгоритмы (Семинар)   ');
        expect(result).toEqual({ title: 'Алгоритмы', type: 'Семинар' });
    });

    it('trims whitespace inside parens', () => {
        const result = splitTitleAndType('X (  Лекция  )');
        expect(result).toEqual({ title: 'X', type: 'Лекция' });
    });

    it('empty input returns empty title with null type', () => {
        expect(splitTitleAndType('')).toEqual({ title: '', type: null });
        expect(splitTitleAndType('   ')).toEqual({ title: '', type: null });
    });
});

describe('extractParity', () => {
    it('detects числитель', () => {
        expect(extractParity('<span class="denominator">Числитель</span>')).toBe('num');
    });

    it('detects знаменатель', () => {
        expect(extractParity('<span class="denominator">Знаменатель</span>')).toBe('den');
    });

    it('falls back to all when no marker', () => {
        expect(extractParity('<div>nothing</div>')).toBe('all');
    });

    it('falls back to all when text is unrelated', () => {
        expect(extractParity('<span class="denominator">расписание</span>')).toBe('all');
    });
});

describe('extractRoom', () => {
    it('returns trimmed room number', () => {
        expect(extractRoom('Ауд.: 305')).toBe('305');
    });

    it('returns null when label missing', () => {
        expect(extractRoom('Корпус 1')).toBeNull();
    });

    it('stops at pipe separator', () => {
        expect(extractRoom('Ауд.: 305 | Корпус 1')).toBe('305');
    });

    it('stops at angle-bracket (HTML tag start)', () => {
        expect(extractRoom('Ауд.: 305 <span>more</span>')).toBe('305');
    });

    it('handles alphanumeric room labels (not just digits)', () => {
        expect(extractRoom('Ауд.: 305-A')).toBe('305-A');
    });
});

describe('extractFaculty', () => {
    it('reads from .aud_faculty', () => {
        expect(extractFaculty('<div><span class="aud_faculty">КН</span></div>')).toBe('КН');
    });

    it('returns null when faculty span missing', () => {
        expect(extractFaculty('<div>nothing</div>')).toBeNull();
    });
});

describe('extractPeriod', () => {
    it('reads from .dateStartLbl', () => {
        expect(extractPeriod('<span class="dateStartLbl">с 1 февраля</span>')).toBe('с 1 февраля');
    });

    it('falls back to "all" when label missing', () => {
        expect(extractPeriod('<div>nothing</div>')).toBe('all');
    });

    it('trims surrounding whitespace inside the dateStartLbl span', () => {
        expect(extractPeriod('<span class="dateStartLbl">   с 1 февраля   </span>')).toBe('с 1 февраля');
    });

    it('picks the first dateStartLbl when multiple are present', () => {
        const html = '<span class="dateStartLbl">первый</span><span class="dateStartLbl">второй</span>';
        expect(extractPeriod(html)).toBe('первый');
    });
});
