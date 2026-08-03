import { describe, it, expect } from 'vitest';
import { getSeasonMode } from './SnowEffect';

describe('getSeasonMode', () => {
    // The function maps the current month to a particle-effect season. Snowflakes
    // for winter (Dec–Feb), pink petals for spring (Mar–May), amber leaves for
    // autumn (Jun–Nov). Summer has no dedicated mode — nobody studies in summer,
    // so summer months fold into autumn ("predict autumn"). Month index is 0-based,
    // so off-by-one bugs at the boundaries are easy.

    it('December → winter (month index 11)', () => {
        expect(getSeasonMode(new Date(2026, 11, 1))).toBe('winter');
        expect(getSeasonMode(new Date(2026, 11, 15))).toBe('winter');
        expect(getSeasonMode(new Date(2026, 11, 31))).toBe('winter');
    });

    it('January → winter (month index 0)', () => {
        expect(getSeasonMode(new Date(2026, 0, 1))).toBe('winter');
        expect(getSeasonMode(new Date(2026, 0, 31))).toBe('winter');
    });

    it('February → winter (month index 1)', () => {
        expect(getSeasonMode(new Date(2026, 1, 1))).toBe('winter');
        expect(getSeasonMode(new Date(2026, 1, 28))).toBe('winter');
    });

    it('March → spring (boundary — first non-winter month)', () => {
        // March 1 is the transition from winter snow to spring petals.
        expect(getSeasonMode(new Date(2026, 2, 1))).toBe('spring');
        expect(getSeasonMode(new Date(2026, 2, 31))).toBe('spring');
    });

    it('March through May → spring', () => {
        for (let month = 2; month <= 4; month++) {
            expect(getSeasonMode(new Date(2026, month, 15))).toBe('spring');
        }
    });

    it('June (boundary — first autumn/summer month) → autumn', () => {
        // May 31 is the last spring day; June 1 flips to autumn (summer predicts autumn).
        expect(getSeasonMode(new Date(2026, 5, 1))).toBe('autumn');
    });

    it('summer months (Jun–Aug) fold into autumn — no study, predict autumn', () => {
        for (let month = 5; month <= 7; month++) {
            expect(getSeasonMode(new Date(2026, month, 15))).toBe('autumn');
        }
    });

    it('September through November → autumn', () => {
        for (let month = 8; month <= 10; month++) {
            expect(getSeasonMode(new Date(2026, month, 15))).toBe('autumn');
        }
    });

    it('November → autumn (boundary — last non-winter month before December)', () => {
        expect(getSeasonMode(new Date(2026, 10, 1))).toBe('autumn');
        expect(getSeasonMode(new Date(2026, 10, 30))).toBe('autumn');
    });

    it('defaults to the current date when no argument given', () => {
        const result = getSeasonMode();
        expect(['winter', 'spring', 'autumn']).toContain(result);
    });
});
