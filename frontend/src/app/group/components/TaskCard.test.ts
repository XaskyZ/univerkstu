import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { priorityTone, deadlineTone } from './TaskCard';

describe('priorityTone', () => {
    // Maps the GroupTaskView priority to a ChipTone for the chip color.
    // A regression silently changes the visual urgency cue on every task card.

    it('high priority → danger (red urgency)', () => {
        expect(priorityTone('high')).toBe('danger');
    });

    it('medium priority → warning (orange caution)', () => {
        expect(priorityTone('medium')).toBe('warning');
    });

    it('low priority → muted (no urgency)', () => {
        expect(priorityTone('low')).toBe('muted');
    });
});

describe('deadlineTone', () => {
    // Decides the deadline-row coloring: overdue (red) / today (orange) / normal (muted).
    // Drives the per-task deadline visual prompt that helps students prioritize.

    beforeEach(() => {
        vi.useFakeTimers();
        // Freeze "now" at noon on May 13, 2026 (local time, for toDateString comparison).
        vi.setSystemTime(new Date(2026, 4, 13, 12, 0, 0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('null/undefined deadline → normal (no urgency)', () => {
        expect(deadlineTone(null)).toBe('normal');
        expect(deadlineTone(undefined)).toBe('normal');
        expect(deadlineTone('')).toBe('normal'); // empty string is falsy
    });

    it('past deadline → overdue', () => {
        // 1 day before "now" → overdue.
        expect(deadlineTone(new Date(2026, 4, 12).toISOString())).toBe('overdue');
    });

    it('deadline earlier today → overdue (past now)', () => {
        // 9 AM today, when "now" is noon → already passed → overdue.
        expect(deadlineTone(new Date(2026, 4, 13, 9, 0, 0).toISOString())).toBe('overdue');
    });

    it('deadline later today → today (future today)', () => {
        // 5 PM today, when "now" is noon → future, but same day → today.
        expect(deadlineTone(new Date(2026, 4, 13, 17, 0, 0).toISOString())).toBe('today');
    });

    it('deadline tomorrow → normal', () => {
        expect(deadlineTone(new Date(2026, 4, 14).toISOString())).toBe('normal');
    });

    it('deadline in 1 week → normal', () => {
        expect(deadlineTone(new Date(2026, 4, 20).toISOString())).toBe('normal');
    });

    it('deadline 1 minute ago → overdue (boundary)', () => {
        // Deadline at 11:59 today, "now" at 12:00 → overdue.
        expect(deadlineTone(new Date(2026, 4, 13, 11, 59, 0).toISOString())).toBe('overdue');
    });

    it('handles invalid deadline gracefully (NaN time falls to normal)', () => {
        // new Date('garbage').getTime() is NaN, which is NOT < now and NOT === today's
        // toDateString → falls through to 'normal'. Documents this defensive behavior.
        expect(deadlineTone('not a date')).toBe('normal');
    });
});
