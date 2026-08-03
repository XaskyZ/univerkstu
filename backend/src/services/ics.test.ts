import { describe, it, expect } from 'vitest';
import { buildIcsFeed, escapeIcsText } from './ics.js';
import type { Schedule } from '../types/index.js';

// All tests freeze "now" to the same Monday so they're independent of the test
// runner's local clock. 2026-05-04 (Mon) → first generated event lives that week.
const NOW = new Date('2026-05-04T08:00:00');

function emptySchedule(): Schedule {
    return {
        userId: 'test-user',
        meta: { tz: 'Asia/Almaty', parsedAt: NOW.toISOString(), userId: 'test-user' },
        timeSlots: [],
        days: [],
        cachedAt: NOW,
        expiresAt: NOW,
    };
}

describe('escapeIcsText', () => {
    it('escapes RFC 5545 reserved characters', () => {
        // Backslash escapes itself (so the encoded chars roundtrip cleanly),
        // newlines collapse to literal `\n`, and `,` + `;` get backslashed.
        const out = escapeIcsText('foo, bar; baz\nqux\\zz');
        expect(out).toBe('foo\\, bar\\; baz\\nqux\\\\zz');
    });
});

describe('buildIcsFeed', () => {
    it('returns a valid empty calendar wrapper when there are no lessons', () => {
        const feed = buildIcsFeed(emptySchedule(), {
            calendarName: 'Test Calendar',
            language: 'ru',
            weekStart: NOW,
            weeksToExpand: 4,
            now: NOW,
        });

        const lines = feed.split('\r\n');
        expect(lines[0]).toBe('BEGIN:VCALENDAR');
        expect(lines).toContain('VERSION:2.0');
        expect(lines).toContain('PRODID:-//UniverKstu//Schedule Export//EN');
        expect(lines).toContain('X-WR-CALNAME:Test Calendar');
        // No events when the schedule is empty.
        expect(feed.includes('BEGIN:VEVENT')).toBe(false);
        // Trailing CRLF + END:VCALENDAR.
        expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
    });

    it('emits one VEVENT per non-parity lesson within the requested window', () => {
        const schedule: Schedule = {
            ...emptySchedule(),
            timeSlots: [{ start: '08:00', end: '09:50' }],
            days: [
                {
                    name: 'mon',
                    lessons: [[
                        {
                            title: 'Algorithms',
                            type: 'Лек',
                            teacher: 'Ivanov I.I.',
                            room: '301',
                            faculty: null,
                            parity: 'all',
                            period: null,
                        },
                    ]],
                },
            ],
        };

        const feed = buildIcsFeed(schedule, {
            calendarName: 'Cal',
            language: 'en',
            weekStart: NOW,
            weeksToExpand: 1,
            now: NOW,
        });

        const eventCount = (feed.match(/BEGIN:VEVENT/g) || []).length;
        expect(eventCount).toBe(1);
        // Local-time stamp, no Z suffix.
        expect(feed).toMatch(/DTSTART:20260504T080000\r\n/);
        expect(feed).toMatch(/DTEND:20260504T095000\r\n/);
        expect(feed).toContain('SUMMARY:Algorithms (Лек)');
        expect(feed).toContain('LOCATION:301');
        expect(feed).toContain('DESCRIPTION:Ivanov I.I.');
    });

    it('escapes reserved characters in multi-lesson titles/locations and emits CRLF separators', () => {
        const schedule: Schedule = {
            ...emptySchedule(),
            timeSlots: [
                { start: '08:00', end: '09:50' },
                { start: '10:00', end: '11:50' },
            ],
            days: [
                {
                    name: 'mon',
                    lessons: [
                        [
                            {
                                title: 'Subject, with comma\nand newline',
                                type: 'Лек',
                                teacher: 'Prof; Surname',
                                room: 'A-1, hall',
                                faculty: null,
                                parity: 'all',
                                period: null,
                            },
                        ],
                        [
                            {
                                title: 'Numerator-only lesson',
                                type: null,
                                teacher: '',
                                room: null,
                                faculty: null,
                                parity: 'num',
                                period: null,
                            },
                            {
                                title: 'Denominator-only lesson',
                                type: null,
                                teacher: '',
                                room: null,
                                faculty: null,
                                parity: 'den',
                                period: null,
                            },
                        ],
                    ],
                },
            ],
        };

        const feed = buildIcsFeed(schedule, {
            calendarName: 'Cal, with comma',
            language: 'ru',
            weekStart: NOW,
            weeksToExpand: 2,
            now: NOW,
        });

        // Every line ends with CRLF per RFC 5545.
        expect(feed.split('\r\n').length).toBeGreaterThan(5);
        expect(feed.endsWith('\r\n')).toBe(true);

        // Escape commas + newlines + semicolons in user text.
        expect(feed).toContain('SUMMARY:Subject\\, with comma\\nand newline (Лек)');
        expect(feed).toContain('LOCATION:A-1\\, hall');
        expect(feed).toContain('DESCRIPTION:Prof\\; Surname');
        // X-WR-CALNAME escapes too.
        expect(feed).toContain('X-WR-CALNAME:Cal\\, with comma');

        // Across 2 weeks: week 1 → num parity, week 2 → den parity.
        // Slot 0 "all" → emitted twice (both weeks).
        // Slot 1 "num" lesson → only week 1; "den" lesson → only week 2.
        const eventCount = (feed.match(/BEGIN:VEVENT/g) || []).length;
        // 2 (slot 0 across both weeks) + 1 (num in week 1) + 1 (den in week 2) = 4
        expect(eventCount).toBe(4);

        // Sanity: every VEVENT has a UID and DTSTAMP.
        expect((feed.match(/UID:/g) || []).length).toBe(4);
        expect((feed.match(/DTSTAMP:/g) || []).length).toBe(4);
    });
});
