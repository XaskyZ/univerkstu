/**
 * Teacher name validator + profanity filter (Phase 1 anti-abuse hardening).
 *
 * Rules:
 *  - Trim whitespace, then enforce length in [3, 80]
 *  - Allowed characters: Russian + Kazakh letters + Latin letters + dot/hyphen/apostrophe/space
 *  - Reject digits and ASCII punctuation like !@#$%^&*
 *  - Reject SHOUTING (4+ consecutive uppercase letters)
 *  - Reject ALL-CAPS (no lowercase letters anywhere)
 *  - Require at least two alphabetic tokens (e.g. surname + initial)
 *  - Profanity check (ru-only, substring match) — rejects obvious slurs
 *
 * The profanity list is conservative on purpose: short tokens that could collide with
 * Kazakh/Turkic surnames are intentionally excluded.
 *
 * Public API:
 *   validateTeacherName(raw) — return { ok, reason? }
 *   containsProfanity(raw)   — used by tag normalizer to silently drop tagged slurs
 */

export type TeacherNameValidationReason =
    | 'too_short'
    | 'too_long'
    | 'bad_format'
    | 'profanity'
    | 'no_tokens';

export interface TeacherNameValidationResult {
    ok: boolean;
    reason?: TeacherNameValidationReason;
}

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;

// Allowed characters: Russian alphabet (incl. ё), Kazakh extra letters (ӘҒҚҢӨҰҮҺІЇЎ),
// Latin A-Z/a-z, dot, hyphen, ASCII apostrophe, space.
// Anything else (digits, punctuation like !@#$%^&*, brackets, slashes) is rejected.
const ALLOWED_CHARS = /^[A-Za-zА-ЯЁЇІЎҚҒҢӨҮҰҺӘа-яёїіўқғңөүұһә.\-' ]+$/;

// SHOUTING detector — 4 or more consecutive uppercase Latin/Cyrillic letters.
// Russian uppercase range covers А-Я plus the Kazakh capitals.
const SHOUTING_PATTERN = /[A-ZА-ЯЁҚҒҢӨҮҰҺӘЇІЎ]{4,}/;

// Lowercase Cyrillic/Latin presence — used to reject pure uppercase strings.
const HAS_LOWERCASE = /[a-zа-яёїіўқғңөүұһә]/;

// Profanity wordlist — ~20 obvious Russian slurs. Conservative substring matching.
// extend with care: do NOT add short tokens that occur inside Kazakh/Turkic surnames
// (e.g. "хан", "бек", "тай" etc. would create false positives).
const PROFANITY_TOKENS = [
    'хуй',
    'хуе',
    'хуя',
    'пизд',
    'еба',
    'ёба',
    'ебать',
    'сук',
    'хер',
    'мудак',
    'мудил',
    'гондон',
    'чмо',
    'далбое',
    'долбое',
    'шлюх',
    'выеб',
    'пидор',
    'пидар',
    'huy',
    'pizd',
    'ebat',
];

export function containsProfanity(value: string): boolean {
    const lower = value.toLowerCase();
    for (const token of PROFANITY_TOKENS) {
        if (lower.includes(token)) return true;
    }
    return false;
}

export function validateTeacherName(raw: string): TeacherNameValidationResult {
    if (typeof raw !== 'string') {
        return { ok: false, reason: 'bad_format' };
    }
    const trimmed = raw.trim().replace(/\s+/g, ' ');

    if (trimmed.length < MIN_NAME_LENGTH) {
        return { ok: false, reason: 'too_short' };
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
        return { ok: false, reason: 'too_long' };
    }

    if (!ALLOWED_CHARS.test(trimmed)) {
        return { ok: false, reason: 'bad_format' };
    }

    if (SHOUTING_PATTERN.test(trimmed)) {
        return { ok: false, reason: 'bad_format' };
    }

    if (!HAS_LOWERCASE.test(trimmed)) {
        return { ok: false, reason: 'bad_format' };
    }

    const alphaTokens = trimmed
        .split(/\s+/)
        .filter((t) => /\p{Letter}/u.test(t));
    if (alphaTokens.length < 2) {
        return { ok: false, reason: 'no_tokens' };
    }

    if (containsProfanity(trimmed)) {
        return { ok: false, reason: 'profanity' };
    }

    return { ok: true };
}
