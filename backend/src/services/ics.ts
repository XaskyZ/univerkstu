/**
 * RFC 5545 (iCalendar) feed builder for the schedule export endpoint.
 *
 * Pure module — given a `Schedule` and a base week starting on a Monday, it
 * produces a string body that calendar apps can subscribe to.
 *
 * We expand the week-grid schedule into concrete dated events for a window
 * of weeks (default: 16, i.e. roughly one semester) so the user can see the
 * whole semester in their calendar app at once. Parity-tagged lessons
 * (`num`/`den`) are emitted only on the matching weeks.
 */

import type { Schedule, Lesson, TimeSlot } from '../types/index.js';

export interface BuildIcsFeedOptions {
    /** X-WR-CALNAME header shown in the calendar app. */
    calendarName: string;
    /** Affects PRODID metadata and language hint; doesn't translate event titles. */
    language: 'ru' | 'kz' | 'en';
    /**
     * First Monday of the recurrence window. If omitted, falls back to the
     * Monday of the current week.
     */
    weekStart?: Date;
    /** How many weeks of events to emit. Default 16. */
    weeksToExpand?: number;
    /**
     * Override "now" used for the DTSTAMP field. Tests pass this so the output
     * is deterministic.
     */
    now?: Date;
}

const DAY_KEY_TO_OFFSET: Record<string, number> = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
};

/**
 * RFC 5545 TEXT escape: backslash, comma, semicolon are reserved; newlines
 * encode as `\n`. We strip CR so embedded CRLFs don't double-encode.
 */
export function escapeIcsText(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/**
 * Formats a Date as a floating local date-time per RFC 5545 (`YYYYMMDDTHHMMSS`).
 * No `Z` suffix → calendar apps treat it as local time, which matches what
 * KSTU schedules show (no timezone conversion surprises).
 */
function formatLocalDateTime(date: Date): string {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        'T',
        pad2(date.getHours()),
        pad2(date.getMinutes()),
        pad2(date.getSeconds()),
    ].join('');
}

/**
 * Formats a Date as a UTC stamp (`YYYYMMDDTHHMMSSZ`) — required for DTSTAMP.
 */
function formatUtcDateTime(date: Date): string {
    return [
        date.getUTCFullYear(),
        pad2(date.getUTCMonth() + 1),
        pad2(date.getUTCDate()),
        'T',
        pad2(date.getUTCHours()),
        pad2(date.getUTCMinutes()),
        pad2(date.getUTCSeconds()),
        'Z',
    ].join('');
}

function parseHm(value: string): { hours: number; minutes: number } | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
}

function getMondayOf(date: Date): Date {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = result.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    result.setDate(result.getDate() + diff);
    return result;
}

function applyHm(base: Date, hm: { hours: number; minutes: number }): Date {
    const result = new Date(base);
    result.setHours(hm.hours, hm.minutes, 0, 0);
    return result;
}

/**
 * Stable, content-derived UID for an event. Calendar apps use the UID to
 * dedupe across re-imports — we want the same lesson on the same day to keep
 * the same UID across multiple exports.
 */
function buildEventUid(args: {
    userId: string;
    weekIndex: number;
    dayKey: string;
    slotIndex: number;
    lessonIndex: number;
}): string {
    return [
        'lesson',
        args.userId || 'anon',
        `w${args.weekIndex}`,
        args.dayKey,
        `s${args.slotIndex}`,
        `l${args.lessonIndex}`,
    ].join('-') + '@univerkstu';
}

function getParityForWeek(weekIndex: number): 'num' | 'den' {
    // Week 1 (weekIndex=0) → numerator; alternates after. Matches the
    // `weekParity` convention used elsewhere in the app.
    return weekIndex % 2 === 0 ? 'num' : 'den';
}

interface ExpandedEvent {
    uid: string;
    start: Date;
    end: Date;
    summary: string;
    location: string | null;
    description: string | null;
}

function expandEvents(schedule: Schedule, opts: Required<Pick<BuildIcsFeedOptions, 'weekStart' | 'weeksToExpand'>>): ExpandedEvent[] {
    const events: ExpandedEvent[] = [];

    for (let weekIndex = 0; weekIndex < opts.weeksToExpand; weekIndex++) {
        const weekParity = getParityForWeek(weekIndex);
        const weekMonday = new Date(opts.weekStart);
        weekMonday.setDate(weekMonday.getDate() + weekIndex * 7);

        for (const day of schedule.days || []) {
            const dayOffset = DAY_KEY_TO_OFFSET[day.name];
            if (dayOffset === undefined) continue;

            const dayDate = new Date(weekMonday);
            dayDate.setDate(dayDate.getDate() + dayOffset);

            (day.lessons || []).forEach((slotLessons: Lesson[], slotIndex: number) => {
                const slot: TimeSlot | undefined = schedule.timeSlots?.[slotIndex];
                if (!slot) return;

                const startHm = parseHm(slot.start);
                const endHm = parseHm(slot.end);
                if (!startHm || !endHm) return;

                slotLessons.forEach((lesson, lessonIndex) => {
                    if (lesson.parity && lesson.parity !== 'all' && lesson.parity !== weekParity) {
                        return;
                    }
                    const start = applyHm(dayDate, startHm);
                    const end = applyHm(dayDate, endHm);

                    const summaryParts: string[] = [lesson.title || 'Lesson'];
                    if (lesson.type) summaryParts.push(`(${lesson.type})`);

                    const descriptionLines: string[] = [];
                    if (lesson.teacher) descriptionLines.push(lesson.teacher);
                    if (lesson.faculty) descriptionLines.push(lesson.faculty);
                    if (lesson.period) descriptionLines.push(lesson.period);

                    events.push({
                        uid: buildEventUid({
                            userId: schedule.userId,
                            weekIndex,
                            dayKey: day.name,
                            slotIndex,
                            lessonIndex,
                        }),
                        start,
                        end,
                        summary: summaryParts.join(' '),
                        location: lesson.room || null,
                        description: descriptionLines.length > 0 ? descriptionLines.join('\n') : null,
                    });
                });
            });
        }
    }

    return events;
}

/**
 * Build a minimal RFC 5545-compliant calendar feed string.
 *
 * Lines use CRLF terminators (mandated by the spec). Long-line folding is not
 * applied because real schedules don't produce 75-octet lines in practice and
 * every modern calendar app accepts unfolded short lines.
 */
export function buildIcsFeed(schedule: Schedule | null | undefined, opts: BuildIcsFeedOptions): string {
    const now = opts.now ?? new Date();
    const weekStart = opts.weekStart ? getMondayOf(opts.weekStart) : getMondayOf(now);
    const weeksToExpand = opts.weeksToExpand ?? 16;

    const lines: string[] = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//UniverKstu//Schedule Export//EN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push(`X-WR-CALNAME:${escapeIcsText(opts.calendarName)}`);
    lines.push(`X-WR-LANG:${opts.language}`);

    if (schedule) {
        const events = expandEvents(schedule, { weekStart, weeksToExpand });
        for (const event of events) {
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:${event.uid}`);
            lines.push(`DTSTAMP:${formatUtcDateTime(now)}`);
            lines.push(`DTSTART:${formatLocalDateTime(event.start)}`);
            lines.push(`DTEND:${formatLocalDateTime(event.end)}`);
            lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
            if (event.location) {
                lines.push(`LOCATION:${escapeIcsText(event.location)}`);
            }
            if (event.description) {
                lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
            }
            lines.push('END:VEVENT');
        }
    }

    lines.push('END:VCALENDAR');

    // RFC 5545 §3.1 mandates CRLF; many readers reject LF-only feeds.
    return lines.join('\r\n') + '\r\n';
}
