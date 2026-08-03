/**
 * Pure helper: pull the first http(s) URL out of a free-form text body.
 *
 * Used by every social surface (PostCard, TaskCard, LessonCard, MessageBubble)
 * to decide whether to render a `LinkPreviewCard` under the body. The result
 * is then forwarded to the backend `/social/link-preview?url=...` route — the
 * backend re-normalizes the URL on its side, so this helper only has to find
 * the candidate substring.
 *
 * Mirrors the regex used in `backend/src/services/link-previews.ts` so the
 * two sides agree on what counts as "a URL".
 */
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCT_REGEX = /[).,;:!?'"`]+$/g;

export function extractFirstUrl(text: string | null | undefined): string | null {
    if (typeof text !== 'string' || text.length === 0) return null;
    const match = text.match(URL_REGEX);
    if (!match) return null;
    // Strip trailing punctuation that is almost never part of a URL
    // (e.g. "see https://foo.com." or "(https://foo.com)").
    const candidate = match[0].replace(TRAILING_PUNCT_REGEX, '');
    return candidate.length === 0 ? null : candidate;
}
