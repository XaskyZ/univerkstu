import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StaffProfile {
    name: string;
    url: string;
    /**
     * Source faculty label (e.g. "Горный факультет"). Optional — older
     * consumers that destructure only `{ name, url }` keep working unchanged.
     */
    faculty?: string;
    /**
     * Source department / kafedra label (e.g. "Кафедра «Разработка
     * месторождений полезных ископаемых»"). Optional, same reason.
     */
    department?: string;
}

const staffDb: StaffProfile[] = [];

// Initialize DB on first import
// Пробуем несколько путей: src/data (prod из git), __dirname/../data (dev с tsx)
const possiblePaths = [
    path.join(process.cwd(), 'src', 'data', 'kstu_staff_data.json'),  // prod: запуск из backend/
    path.join(__dirname, '..', 'data', 'kstu_staff_data.json'),        // dev: tsx запускает из src/
    path.join(process.cwd(), 'data', 'kstu_staff_data.json'),          // fallback
];

try {
    const dataPath = possiblePaths.find(p => fs.existsSync(p));
    if (dataPath) {
        const rawData = fs.readFileSync(dataPath, 'utf-8');
        const parsed = JSON.parse(rawData);

        for (const faculty of parsed) {
            const facultyName: string | undefined = typeof faculty?.name === 'string' ? faculty.name : undefined;
            for (const dept of faculty.departments || []) {
                const deptName: string | undefined = typeof dept?.name === 'string' ? dept.name : undefined;
                for (const person of dept.people || []) {
                    if (!person || typeof person.name !== 'string') continue;
                    staffDb.push({
                        name: person.name,
                        url: typeof person.url === 'string' ? person.url : '',
                        faculty: facultyName,
                        department: deptName,
                    });
                }
            }
        }
        console.log(`[TeacherMatcher] Loaded ${staffDb.length} teacher profiles from ${dataPath}`);
    } else {
        console.warn(`[TeacherMatcher] Data file not found! Tried paths:`, possiblePaths);
    }
} catch (error) {
    console.error(`[TeacherMatcher] Error loading staff data:`, error);
}

/**
 * Splits a full name from the DB into a surname and an array of initials.
 */
function parseDbName(fullName: string): { lastName: string, initials: string[] } {
    const parts = fullName.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { lastName: '', initials: [] };

    // First part is usually the surname
    const lastName = parts[0].toUpperCase();
    // Everything else gives an initial
    const initials = parts.slice(1).map(p => p[0].toUpperCase());

    return { lastName, initials };
}

/**
 * Splits a schedule name string into surname and initials.
 * E.g. "Қыдырғали ұлы Д." -> surname "ҚЫДЫРҒАЛИ ҰЛЫ", initials ["Д"]
 */
function parseScheduleName(schedName: string): { lastName: string, initials: string[] } {
    const parts = schedName.replace(/\./g, ' ').split(/\s+/).filter(Boolean);

    const lastNameParts: string[] = [];
    const initials: string[] = [];

    for (const p of parts) {
        if (p.length === 1) {
            initials.push(p.toUpperCase());
        } else {
            lastNameParts.push(p.toUpperCase());
        }
    }

    return { lastName: lastNameParts.join(' '), initials };
}

/**
 * Bounded Levenshtein distance. Returns Infinity if the true distance exceeds
 * `maxDistance` — this keeps cost O(min(m,n) * maxDistance) instead of O(m*n).
 *
 * Implementation details:
 *  - early-exit when every cell in a row exceeds the threshold
 *  - skip when |m - n| > maxDistance (impossible to reach)
 */
export function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > maxDistance) return Infinity;
    if (m === 0) return n <= maxDistance ? n : Infinity;
    if (n === 0) return m <= maxDistance ? m : Infinity;

    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,        // deletion
                curr[j - 1] + 1,    // insertion
                prev[j - 1] + cost, // substitution
            );
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        // Early-exit: if every cell in this row already exceeds maxDistance,
        // the final result must too.
        if (rowMin > maxDistance) return Infinity;
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }

    const result = prev[n];
    return result > maxDistance ? Infinity : result;
}

export interface FuzzyMatchResult {
    matched: boolean;
    canonicalCandidate: string | null;
    similarity: number;
    debugTokens?: { input: string[]; matched: string[] };
}

interface NormalizedName {
    tokens: string[];
    surname: string;
    initials: string[];
    joined: string;
}

function normalizeNameForFuzzy(raw: string): NormalizedName {
    const cleaned = raw
        .normalize('NFC')
        .toLowerCase()
        .replace(/[.,-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokens = cleaned.split(' ').filter((t) => t.length > 0);
    let surname = '';
    const initials: string[] = [];

    for (const tok of tokens) {
        if (tok.length === 1) {
            initials.push(tok);
        } else if (tok.length >= 2 && tok.length > surname.length) {
            // longest 2+ char token becomes the surname; previous surname (if any) is
            // not an initial, drop it from initials consideration.
            surname = tok;
        }
    }

    return {
        tokens,
        surname,
        initials,
        joined: tokens.join(' '),
    };
}

function initialsOverlap(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return true; // "no initials on either side"
    for (const ch of a) {
        if (b.includes(ch)) return true;
    }
    return false;
}

/**
 * Fuzzy matches a user-typed teacher name against a list of candidate names
 * (typically extracted from the user's own schedule). Tolerates typos, case,
 * order swaps and missing dots.
 *
 * Returns `canonicalCandidate` = the original candidate string (NOT normalized)
 * so the UI can offer the schedule's canonical form.
 */
export function fuzzyMatchTeacherName(
    input: string,
    candidates: readonly string[],
): FuzzyMatchResult {
    if (!input || candidates.length === 0) {
        return { matched: false, canonicalCandidate: null, similarity: 0 };
    }

    const ni = normalizeNameForFuzzy(input);
    if (!ni.surname && ni.tokens.length === 0) {
        return { matched: false, canonicalCandidate: null, similarity: 0 };
    }

    let best: { candidate: string; similarity: number; matchedTokens: string[] } | null = null;

    for (const candidate of candidates) {
        if (!candidate) continue;
        const nc = normalizeNameForFuzzy(candidate);
        if (!nc.surname && nc.tokens.length === 0) continue;

        // Rule 1: exact normalized match.
        if (ni.joined && ni.joined === nc.joined) {
            return {
                matched: true,
                canonicalCandidate: candidate,
                similarity: 1,
                debugTokens: { input: ni.tokens, matched: nc.tokens },
            };
        }

        const surnameA = ni.surname;
        const surnameB = nc.surname;
        if (!surnameA || !surnameB) continue;

        const surnameDist = boundedLevenshtein(surnameA, surnameB, 2);
        if (surnameDist === Infinity) continue;

        const maxSurnameLen = Math.max(surnameA.length, surnameB.length, 1);
        const surnameSim = 1 - surnameDist / maxSurnameLen;

        // Rule 2: surname distance ≤ 2 AND initials overlap (or no initials on either side).
        const overlap = initialsOverlap(ni.initials, nc.initials);
        // Rule 3: surname distance ≤ 1 alone — handles surname-only variants.
        const rule3 = surnameDist <= 1;

        if (surnameDist <= 2 && overlap) {
            // Initials similarity boost: portion of input initials present in candidate.
            const sharedInitials = ni.initials.filter((ch) => nc.initials.includes(ch)).length;
            const totalInputInitials = ni.initials.length;
            const initialsSim = totalInputInitials === 0 ? 1 : sharedInitials / totalInputInitials;

            // Weighted blend: surname dominates (0.7), initials top it off (0.3).
            const similarity = Math.min(1, surnameSim * 0.7 + initialsSim * 0.3);
            if (!best || similarity > best.similarity) {
                best = { candidate, similarity, matchedTokens: nc.tokens };
            }
            continue;
        }

        if (rule3) {
            // Surname-only fallback — lower confidence ceiling.
            const similarity = Math.min(0.9, surnameSim);
            if (!best || similarity > best.similarity) {
                best = { candidate, similarity, matchedTokens: nc.tokens };
            }
        }
    }

    if (!best) {
        return { matched: false, canonicalCandidate: null, similarity: 0 };
    }

    return {
        matched: true,
        canonicalCandidate: best.candidate,
        similarity: best.similarity,
        debugTokens: { input: ni.tokens, matched: best.matchedTokens },
    };
}

/**
 * Matches a pre-parsed surname and initials against a DB name.
 */
export function findTeacherInDb(scheduleName: string): StaffProfile | null {
    if (!scheduleName || staffDb.length === 0) return null;

    const { lastName: schedLn, initials: schedInits } = parseScheduleName(scheduleName);
    if (!schedLn) return null;

    for (const person of staffDb) {
        const { initials: dbInits } = parseDbName(person.name);

        // 1. Check if the schedule surname is a substring of the DB full name (for complex surnames)
        if (person.name.toUpperCase().includes(schedLn)) {
            // 2. Check initials
            let isMatch = true;
            for (let i = 0; i < schedInits.length; i++) {
                if (i < dbInits.length) {
                    if (schedInits[i] !== dbInits[i]) {
                        isMatch = false;
                        break; // Mismatch in initial
                    }
                } else {
                    // Schedule provides more initials than DB has names — probably not a match
                    isMatch = false;
                    break;
                }
            }

            if (isMatch) {
                return person;
            }
        }
    }

    return null;
}
