/**
 * Lightweight client-side mirror of backend/src/utils/teacherNameValidator.ts.
 *
 * Only the basic checks are re-implemented to keep the "Add teacher" button
 * disabled on obviously bad input. The authoritative validator runs server-side,
 * including profanity rules — we deliberately do NOT ship the wordlist to the client.
 */

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;
const ALLOWED_CHARS = /^[A-Za-zА-ЯЁЇІЎҚҒҢӨҮҰҺӘа-яёїіўқғңөүұһә.\-' ]+$/;
const HAS_LOWERCASE = /[a-zа-яёїіўқғңөүұһә]/;
const SHOUTING_PATTERN = /[A-ZА-ЯЁҚҒҢӨҮҰҺӘЇІЎ]{4,}/;

export function isTeacherNameLikelyValid(raw: string): boolean {
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) return false;
    if (!ALLOWED_CHARS.test(trimmed)) return false;
    if (SHOUTING_PATTERN.test(trimmed)) return false;
    if (!HAS_LOWERCASE.test(trimmed)) return false;
    const alphaTokens = trimmed.split(/\s+/).filter((t) => /\p{Letter}/u.test(t));
    return alphaTokens.length >= 2;
}
