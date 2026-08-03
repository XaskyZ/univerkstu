/**
 * Standalone GPA / grade calculator helpers.
 *
 * Independent from {@link ./goal-assistant.ts}: that one helps the student
 * understand a single Platonus subject (current RK1, what to score on the
 * exam, etc.). This module is a free-form calculator where the user types
 * any number of subjects, picks per-subject or shared weights and gets
 * back the weighted final score, GPA on the 4.0 scale and the letter grade.
 *
 * Formula (KSTU default):
 *     total = rk1 * wRk1 + rk2 * wRk2 + final * wFinal
 * where weights sum to 1 and default to 30 / 30 / 40.
 *
 * Letter grade table follows the standard KZ 4.0 scale used at KSTU:
 *
 *     95-100  A    4.00
 *     90- 94  A-   3.67
 *     85- 89  B+   3.33
 *     80- 84  B    3.00
 *     75- 79  B-   2.67
 *     70- 74  C+   2.33
 *     65- 69  C    2.00
 *     60- 64  C-   1.67
 *     55- 59  D+   1.33
 *     50- 54  D    1.00
 *      0- 49  F    0.00
 *
 * The GPA returned for a list of subjects is the simple mean of the
 * per-subject GPA values (assuming equal credits — Platonus does not
 * expose credit weight per subject in the local cache).
 */

export interface GpaSubjectWeights {
    rk1: number;
    rk2: number;
    final: number;
}

export interface GpaSubjectInput {
    id: string;
    name: string;
    rk1: number | null;
    rk2: number | null;
    final: number | null;
    weights: GpaSubjectWeights;
}

export interface GpaSubjectResult {
    total: number | null;
    letter: string;
    gpa: number | null;
}

export interface GpaSummary {
    averageTotal: number | null;
    averageGpa: number | null;
    subjects: GpaSubjectResult[];
}

export const DEFAULT_WEIGHTS: GpaSubjectWeights = {
    rk1: 0.3,
    rk2: 0.3,
    final: 0.4,
};

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/**
 * Returns true if the value is a finite number inside `[SCORE_MIN, SCORE_MAX]`.
 * `null` is treated as "not entered" and is valid (the caller decides what to
 * do with a missing score).
 */
export function isValidScore(value: number | null): boolean {
    if (value === null) return true;
    return Number.isFinite(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

/**
 * Compute the weighted total for a single subject.
 * Returns `null` when any of the three scores is missing — partial inputs
 * would be misleading because the chosen weights assume all three pieces.
 */
export function computeSubjectTotal(subject: GpaSubjectInput): number | null {
    const { rk1, rk2, final, weights } = subject;
    if (rk1 === null || rk2 === null || final === null) return null;
    if (!isValidScore(rk1) || !isValidScore(rk2) || !isValidScore(final)) return null;
    const total = rk1 * weights.rk1 + rk2 * weights.rk2 + final * weights.final;
    // Clamp defensively — bad weight inputs could push us out of [0, 100].
    return Math.max(SCORE_MIN, Math.min(SCORE_MAX, total));
}

interface LetterGradeEntry {
    min: number;
    letter: string;
    gpa: number;
}

const LETTER_GRADE_TABLE: readonly LetterGradeEntry[] = [
    { min: 95, letter: 'A', gpa: 4.0 },
    { min: 90, letter: 'A-', gpa: 3.67 },
    { min: 85, letter: 'B+', gpa: 3.33 },
    { min: 80, letter: 'B', gpa: 3.0 },
    { min: 75, letter: 'B-', gpa: 2.67 },
    { min: 70, letter: 'C+', gpa: 2.33 },
    { min: 65, letter: 'C', gpa: 2.0 },
    { min: 60, letter: 'C-', gpa: 1.67 },
    { min: 55, letter: 'D+', gpa: 1.33 },
    { min: 50, letter: 'D', gpa: 1.0 },
];

/**
 * Maps a 0..100 score onto the KSTU letter grade + GPA pair.
 * Anything below 50 is `F` (0.0) — that is the failing band.
 */
export function getLetterGrade(total: number | null): { letter: string; gpa: number | null } {
    if (total === null) return { letter: '—', gpa: null };
    if (!Number.isFinite(total)) return { letter: '—', gpa: null };
    if (total < 50) return { letter: 'F', gpa: 0 };
    for (const entry of LETTER_GRADE_TABLE) {
        if (total >= entry.min) return { letter: entry.letter, gpa: entry.gpa };
    }
    // Shouldn't reach here because the table covers down to 50 and `< 50` is
    // handled above, but keep a safe fallback.
    return { letter: 'F', gpa: 0 };
}

/**
 * Compute per-subject + summary view for a list of inputs.
 * - Subjects with missing scores are listed with `total: null` and excluded
 *   from the averages.
 * - When no subject is complete, averages are `null`.
 */
export function computeGpaSummary(subjects: GpaSubjectInput[]): GpaSummary {
    const results: GpaSubjectResult[] = subjects.map((subject) => {
        const total = computeSubjectTotal(subject);
        const { letter, gpa } = getLetterGrade(total);
        return { total, letter, gpa };
    });

    const completed = results.filter((r): r is GpaSubjectResult & { total: number; gpa: number } =>
        r.total !== null && r.gpa !== null
    );

    if (completed.length === 0) {
        return { averageTotal: null, averageGpa: null, subjects: results };
    }

    const totalSum = completed.reduce((acc, r) => acc + r.total, 0);
    const gpaSum = completed.reduce((acc, r) => acc + r.gpa, 0);

    return {
        averageTotal: totalSum / completed.length,
        averageGpa: gpaSum / completed.length,
        subjects: results,
    };
}

/**
 * Normalize a weights object so the three parts sum to 1.
 * Returns the input untouched when its sum is already 1 within a small
 * epsilon. Used to keep manual weight edits from drifting on save/replay.
 */
export function normalizeWeights(weights: GpaSubjectWeights): GpaSubjectWeights {
    const sum = weights.rk1 + weights.rk2 + weights.final;
    if (!Number.isFinite(sum) || sum <= 0) return { ...DEFAULT_WEIGHTS };
    if (Math.abs(sum - 1) < 1e-6) return { ...weights };
    return {
        rk1: weights.rk1 / sum,
        rk2: weights.rk2 / sum,
        final: weights.final / sum,
    };
}
