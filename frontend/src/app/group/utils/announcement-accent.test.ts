import { describe, it, expect } from 'vitest';
import { getAnnouncementAccent } from './announcement-accent';

describe('getAnnouncementAccent', () => {
    it('returns danger-tinted tokens for "critical"', () => {
        const accent = getAnnouncementAccent('critical');
        expect(accent.pillColor).toBe('var(--danger)');
        expect(accent.border).toContain('status-danger-rgb');
        expect(accent.glow).toContain('status-danger-rgb');
        expect(accent.stripe).toContain('status-danger-rgb');
    });

    it('returns warning-tinted tokens for "warning"', () => {
        const accent = getAnnouncementAccent('warning');
        expect(accent.pillColor).toBe('var(--status-warning-color)');
        expect(accent.border).toContain('status-warning-rgb');
        expect(accent.glow).toContain('status-warning-rgb');
        expect(accent.stripe).toContain('status-warning-rgb');
    });

    it('returns info-tinted tokens for "info" / any other priority', () => {
        const accent = getAnnouncementAccent('info');
        expect(accent.pillColor).toBe('var(--status-info-color)');
        expect(accent.border).toContain('status-info-rgb');
        expect(accent.glow).toContain('status-info-rgb');
        expect(accent.stripe).toContain('status-info-rgb');
    });

    it('returns all five style keys (border, glow, stripe, pillBg, pillColor)', () => {
        const accent = getAnnouncementAccent('info');
        expect(Object.keys(accent).sort()).toEqual(['border', 'glow', 'pillBg', 'pillColor', 'stripe']);
    });

    it('falls back to info-tinted tokens for unknown priority values', () => {
        // Defensive check: anything that isn't 'critical' or 'warning' falls
        // into the info branch. Cast through unknown so we can pass a value
        // the type system would otherwise reject.
        const accent = getAnnouncementAccent('unknown-tier' as unknown as 'info');
        expect(accent.pillColor).toBe('var(--status-info-color)');
    });
});
