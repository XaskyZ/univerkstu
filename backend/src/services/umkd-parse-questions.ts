/**
 * Inline exam-question parsing for UMKD files.
 *
 * Phase 1: extracts plain text from .docx (mammoth) and .pdf (pdfjs-dist),
 * splits it into discrete exam questions via a 5-step fallback heuristic,
 * and caches the result keyed by file content hash in `app_umkd_parsed_content`.
 *
 * Public surface is intentionally narrow and side-effect-free except for
 * `getOrParseExamQuestions`, which orchestrates download/extract/persist.
 */

import * as crypto from 'crypto';
import { withSupabasePostgres } from '../db/postgres.js';
import { downloadFromStorageByFileId } from '../storage/index.js';

export const PARSER_VERSION = 4;

export type ExtractorKind = 'mammoth' | 'pdfjs' | 'word-extractor' | 'unsupported';

export interface ParsedQuestion {
    index: number;
    text: string;
    section?: string;
}

export interface ExtractResult {
    text: string;
    extractor: ExtractorKind;
    ok: boolean;
    error?: string;
}

export interface ParseResult {
    fileId: string;
    extractor: ExtractorKind;
    ok: boolean;
    questions: ParsedQuestion[];
    parsedAt: string;
    parserVersion: number;
    errorReason?: string;
}

interface ParsedContentRow {
    file_id: string;
    content_hash: string;
    parsed_at: Date | string;
    parser_version: number;
    extractor: string;
    extract_ok: boolean;
    raw_text: string | null;
    questions_json: ParsedQuestion[];
    error_reason: string | null;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';
const PDF_MIME = 'application/pdf';
const MIN_TEXT_LENGTH = 50;
const MAX_QUESTION_TEXT = 4000;
const MIN_QUESTION_TEXT = 3;
const MIN_MATCH_COUNT = 5;
// Explicit "Вопрос N" / "Билет N" prefixes are highly specific and rarely
// produce false positives, so lower the floor for them — files with only a
// handful of such markers should still get split.
const MIN_PREFIX_MATCH_COUNT = 2;
// Heading phrases that consistently mark the start of the actual question
// list. Used by skipBoilerplate() and attemptUnnumberedAfterHeading().
//
// All patterns are case-insensitive and multi-line anchored. We use a
// generous `^[^\n]*?` prefix so headings can appear mid-line — many real
// docs spell them as "«Психология» пәні бойынша емтихан сұрақтары" or
// "Металл технологиясы емтиханға дайындық бойынша сұрақтар" rather than
// as a standalone phrase.
const QUESTION_LIST_HEADINGS: RegExp[] = [
    /^[^\n]*?Экзаменационные\s+вопросы/im,
    /^[^\n]*?Перечень\s+экзаменационных\s+вопросов/im,
    /^[^\n]*?Вопросы\s+к\s+экзамену/im,
    /^[^\n]*?Вопросы\s+(?:по|для)\s+(?:дисциплине|курсу|студентов|раздел)/im,
    /^[^\n]*?Вопросы\s+к\s+разделу/im,
    /^[^\n]*?Емтихан\s+сұрақтары/im,
    /^[^\n]*?Емтихан\s+бақылау\s+сұрақтары/im,
    /^[^\n]*?Емтиханға\s+арналған\s+сұрақтар/im,
    /^[^\n]*?Емтиханға\s+дайындық\s+бойынша\s+сұрақтар/im,
    /^[^\n]*?Сұрақтар\s+емтихан\s+үшін/im,
    /^[^\n]*?Аралық\s+және\s+емтихан\s+сұрақтары/im,
    /^[ \t]*Материалы\s+итогового\s+контроля/im,
    /^[ \t]*Қорытынды\s+бақылау\s+материалдары/im,
    // Generic phrase matching "...туралы сұрақтар(ы)" — "questions about X".
    // Used in legal/labour-code docs that don't say "емтихан" anywhere.
    /^[^\n]{0,150}туралы\s+сұрақтар(?:ы)?$/im,
];

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

function normalizeExtension(extension: string): string {
    const trimmed = extension.trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
}

function looksLikeDocx(mimeType: string, extension: string): boolean {
    return mimeType === DOCX_MIME || normalizeExtension(extension) === 'docx';
}

function looksLikePdf(mimeType: string, extension: string): boolean {
    return mimeType === PDF_MIME || normalizeExtension(extension) === 'pdf';
}

function looksLikeLegacyDoc(mimeType: string, extension: string): boolean {
    return mimeType === DOC_MIME || normalizeExtension(extension) === 'doc';
}

/**
 * Extracts plain text from a legacy binary .doc buffer using `word-extractor`.
 *
 * Pure JS / no native deps, so safe for Railway. Concatenates the document body
 * with footnotes/endnotes/textboxes so heuristic question splitting still works
 * when the question list lives outside the main story (older Word templates).
 *
 * Throws on malformed input; callers must catch and translate into a graceful
 * `ExtractResult.ok=false`.
 */
async function extractDocLegacy(buffer: Buffer): Promise<string> {
    const mod = await import('word-extractor');
    // The package's CJS default export interop lands on `.default` under NodeNext ESM.
    const WordExtractorCtor =
        (mod as { default?: unknown }).default ?? (mod as unknown);
    const Ctor = WordExtractorCtor as new () => {
        extract: (src: Buffer) => Promise<{
            getBody: () => string;
            getFootnotes: () => string;
            getEndnotes: () => string;
            getTextboxes: () => string;
        }>;
    };
    const extractor = new Ctor();
    const doc = await extractor.extract(buffer);
    const parts = [
        doc.getBody(),
        doc.getFootnotes(),
        doc.getEndnotes(),
        doc.getTextboxes(),
    ].filter((segment) => typeof segment === 'string' && segment.length > 0);
    return parts.join('\n');
}

/**
 * Reconstructs page text from pdfjs `textContent.items` while preserving line
 * breaks. The default `.map(i => i.str).join(' ')` flattens the entire page to
 * a single line, which silently kills downstream regex splitters that anchor on
 * `^\d+\.`.
 *
 * Strategy (belt-and-suspenders):
 *   1. If the item carries `hasEOL: true` (pdfjs marks the last item on each
 *      visual line), emit a newline after its string. This is the cheap path
 *      and works for most well-formed PDFs.
 *   2. As a fallback for PDFs where `hasEOL` is missing/unreliable, compare the
 *      vertical baseline (`transform[5]`) against the previous item: a jump of
 *      more than 3 PDF units = new line.
 *
 * Items within the same line are joined with a single space so words don't
 * collide.
 */
export function renderPdfPageText(items: unknown[]): string {
    const parts: string[] = [];
    let prevY: number | null = null;
    let lineHasContent = false;
    for (const raw of items) {
        const item = raw as { str?: unknown; hasEOL?: unknown; transform?: unknown };
        const str = typeof item.str === 'string' ? item.str : '';
        const hasEOL = item.hasEOL === true;
        const transform = Array.isArray(item.transform) ? (item.transform as unknown[]) : null;
        const yRaw = transform ? transform[5] : undefined;
        const y = typeof yRaw === 'number' ? yRaw : null;

        // Y-coordinate fallback: detect implicit line breaks for items where
        // hasEOL isn't set. A vertical jump of more than ~3 PDF units indicates
        // a new line. Run BEFORE pushing the item so the break lands between
        // the previous and the current item.
        if (y !== null && prevY !== null && Math.abs(y - prevY) > 3 && lineHasContent) {
            // Strip trailing whitespace from the previous part chain.
            // We just append '\n' and let downstream `normalize()` collapse
            // any double-blank-line runs to 2.
            parts.push('\n');
            lineHasContent = false;
        }

        if (str.length > 0) {
            if (lineHasContent) {
                parts.push(' ');
            }
            parts.push(str);
            lineHasContent = true;
        }

        if (hasEOL) {
            parts.push('\n');
            lineHasContent = false;
        }

        if (y !== null) {
            prevY = y;
        }
    }
    return parts.join('');
}

export async function extractTextFromBuffer(
    buffer: Buffer,
    mimeType: string,
    extension: string,
): Promise<ExtractResult> {
    if (looksLikeDocx(mimeType, extension)) {
        try {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            const text = (result?.value ?? '').toString();
            if (text.length < MIN_TEXT_LENGTH) {
                return { text, extractor: 'mammoth', ok: false, error: 'no text layer' };
            }
            return { text, extractor: 'mammoth', ok: true };
        } catch (error) {
            return {
                text: '',
                extractor: 'mammoth',
                ok: false,
                error: error instanceof Error ? error.message : 'mammoth extraction failed',
            };
        }
    }

    if (looksLikeLegacyDoc(mimeType, extension)) {
        try {
            const text = await extractDocLegacy(buffer);
            if (!text || text.length < MIN_TEXT_LENGTH) {
                return {
                    text: text ?? '',
                    extractor: 'word-extractor',
                    ok: false,
                    error: 'doc has no extractable text',
                };
            }
            return { text, extractor: 'word-extractor', ok: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            console.warn('[umkd-parse-questions] legacy .doc extraction failed:', message);
            return {
                text: '',
                extractor: 'word-extractor',
                ok: false,
                error: `doc parse failed: ${message}`,
            };
        }
    }

    if (looksLikePdf(mimeType, extension)) {
        try {
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const data = new Uint8Array(buffer);
            const loadingTask = pdfjs.getDocument({
                data,
                useSystemFonts: true,
            });
            const doc = await loadingTask.promise;
            const pageTexts: string[] = [];
            for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
                const page = await doc.getPage(pageNum);
                const textContent = await page.getTextContent();
                pageTexts.push(renderPdfPageText(textContent.items));
                page.cleanup();
            }
            await doc.cleanup();
            await doc.destroy();
            // Page boundary always inserts a blank line so splitters that anchor
            // on line starts (^\d+\.) keep working across pages.
            const text = pageTexts.join('\n\n');
            if (text.trim().length < MIN_TEXT_LENGTH) {
                return { text, extractor: 'pdfjs', ok: false, error: 'no text layer' };
            }
            return { text, extractor: 'pdfjs', ok: true };
        } catch (error) {
            return {
                text: '',
                extractor: 'pdfjs',
                ok: false,
                error: error instanceof Error ? error.message : 'pdfjs extraction failed',
            };
        }
    }

    return {
        text: '',
        extractor: 'unsupported',
        ok: false,
        error: 'unsupported format',
    };
}

// ---------------------------------------------------------------------------
// Pure text helpers
// ---------------------------------------------------------------------------

export function normalize(text: string): string {
    if (!text) return '';
    let out = text.normalize('NFC');
    out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    out = out.replace(/­/g, '');
    out = out
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out;
}

/**
 * Lenient sibling of `isMonotonic` used for explicit prefix matchers
 * ("Вопрос N", "Билет N") where the prefix word itself is so specific
 * that 2 monotone matches are already conclusive. The strict version
 * requires `increments >= 2` and refuses to commit on the bare minimum.
 */
export function isMonotonicLenient(numbers: number[]): boolean {
    if (numbers.length < 2) return numbers.length === 1;
    let increments = 0;
    let otherAnomalies = 0;
    for (let i = 1; i < numbers.length; i++) {
        const prev = numbers[i - 1];
        const cur = numbers[i];
        if (cur > prev) increments++;
        else if (cur <= 2 && prev >= 3) { /* section restart, ignore */ }
        else otherAnomalies++;
    }
    // Accept 2-element [1,2] as monotonic (the strict version would reject).
    return increments >= 1 && otherAnomalies <= 2;
}

export function isMonotonic(numbers: number[]): boolean {
    if (numbers.length < 2) return numbers.length === 1;
    let increments = 0;
    let restartAnomalies = 0;
    let otherAnomalies = 0;
    for (let i = 1; i < numbers.length; i++) {
        const prev = numbers[i - 1];
        const cur = numbers[i];
        if (cur > prev) {
            increments++;
        } else if (cur <= 2 && prev >= 3) {
            // Section restart: e.g. "...37. 38. 1. 2..." — a list that runs
            // out and then starts a new section at 1 or 2. These are NOT bugs
            // in the splitter, they just mean the document is multi-section.
            restartAnomalies++;
        } else {
            otherAnomalies++;
        }
    }
    // Small lists: tolerate up to 2 non-restart anomalies (legacy behaviour
    // for tests that gap from 2 to 7).
    if (numbers.length <= 10) {
        return otherAnomalies <= 2 && increments >= 2;
    }
    // Larger lists: allow many restarts (one per section) plus a handful of
    // other anomalies (e.g. footnote numbers, repeated headers).
    const totalAnomalies = restartAnomalies + otherAnomalies;
    const goodFraction = increments / (increments + totalAnomalies);
    return increments >= 5 && goodFraction >= 0.7;
}

function isDecorativeAllCaps(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length >= 50) return false;
    if (trimmed.endsWith('?')) return false;
    const letters = trimmed.replace(/[^\p{L}]/gu, '');
    if (letters.length < 3) return false;
    return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

function cleanQuestionBody(raw: string): string {
    const lines = raw.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
        if (isDecorativeAllCaps(line)) continue;
        kept.push(line);
    }
    let body = kept.join('\n').trim();
    body = body.replace(/([^\n])\n(?!\n)([^\n])/g, '$1 $2');
    body = body.replace(/\s{2,}/g, ' ').trim();
    if (body.length > MAX_QUESTION_TEXT) {
        body = body.slice(0, MAX_QUESTION_TEXT).trimEnd();
    }
    return body;
}

interface SplitMatch {
    position: number;
    captureNumber: number | null;
}

function collectSectionHeaders(text: string): Array<{ position: number; title: string }> {
    const sections: Array<{ position: number; title: string }> = [];
    const lineRegex = /^[ \t]*(?:Раздел|Тема|Модуль|Часть)\s+[IVX\d]+[^\n]*/gim;
    let m: RegExpExecArray | null;
    while ((m = lineRegex.exec(text)) !== null) {
        sections.push({ position: m.index, title: m[0].trim() });
    }
    return sections;
}

function sectionForPosition(
    sections: Array<{ position: number; title: string }>,
    position: number,
): string | undefined {
    let current: string | undefined;
    for (const s of sections) {
        if (s.position <= position) {
            current = s.title;
        } else {
            break;
        }
    }
    return current;
}

function splitAt(text: string, matches: SplitMatch[]): ParsedQuestion[] {
    if (matches.length === 0) return [];
    const sections = collectSectionHeaders(text);
    const sorted = [...matches].sort((a, b) => a.position - b.position);
    const slices: Array<{ raw: string; section?: string }> = [];
    for (let i = 0; i < sorted.length; i++) {
        const start = sorted[i].position;
        const end = i + 1 < sorted.length ? sorted[i + 1].position : text.length;
        const slice = text.slice(start, end);
        const section = sectionForPosition(sections, start);
        slices.push({ raw: slice, section });
    }
    const questions: ParsedQuestion[] = [];
    let index = 1;
    for (const slice of slices) {
        const stripped = slice.raw
            // Ticket headers ("Билет №3", "Емтихандық билет", etc.). Strip
            // the whole line because nothing on it is question content.
            .replace(/^[ \t]*(?:Емтихан\s+билеті|Емтихандық\s+билет|Билет|Ticket)(?:[ \t]+№?\s*\d{1,3})?[^\n]*\n?/i, '')
            // Match "Вопрос 5: ", "Вопрос 5\n", "Вопрос 5)\n" — the trailing
            // separator must be at least one whitespace char (incl. newline).
            .replace(/^[ \t]*(?:Вопрос|Question|Сұрақ|Сурак|В)[ \t]*№?\s*\d{1,3}[.:)]?\s+/i, '')
            .replace(/^[ \t]*\d{1,3}[.)][ \t]+/, '')
            // "1   foo" / "23 bar" — digit + whitespace without punctuation
            // (Pattern 1 splitter creates these).
            .replace(/^[ \t]*\d{1,3}[ \t]+(?=\S)/, '')
            .replace(/^[ \t]*[•\-—–][ \t]+/, '');
        const body = cleanQuestionBody(stripped);
        if (body.length < MIN_QUESTION_TEXT) continue;
        const entry: ParsedQuestion = { index, text: body };
        if (slice.section) entry.section = slice.section;
        questions.push(entry);
        index++;
    }
    return questions;
}

function attemptStrictNumbered(text: string): SplitMatch[] | null {
    const re = /^[ \t]*(\d{1,3})[.)][ \t]+(?=\S)/gm;
    const matches: SplitMatch[] = [];
    const numbers: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const n = Number(m[1]);
        matches.push({ position: m.index, captureNumber: n });
        numbers.push(n);
    }
    if (matches.length >= MIN_MATCH_COUNT && isMonotonic(numbers)) {
        return matches;
    }
    return null;
}

function attemptVoprosPrefix(text: string): SplitMatch[] | null {
    // Accepts both inline ("Вопрос 5: ...") and standalone-line ("Вопрос 5\n
    // V1   ...") variants. The trailing separator can be whitespace including
    // newline OR a punctuation mark like : or ) immediately followed by a
    // newline. The lookahead requires content (not just EOF or another digit).
    //
    // Uses MIN_PREFIX_MATCH_COUNT (2) rather than MIN_MATCH_COUNT (5) because
    // the prefix word is highly specific — false positives are unlikely.
    const re = /^[ \t]*(?:Вопрос|Question|Сұрақ|Сурак|В)[ \t]*№?\s*(\d{1,3})[.:)]?(?=$|[ \t\n])/gim;
    const matches: SplitMatch[] = [];
    const numbers: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const n = Number(m[1]);
        matches.push({ position: m.index, captureNumber: n });
        numbers.push(n);
    }
    if (matches.length >= MIN_PREFIX_MATCH_COUNT && isMonotonicLenient(numbers)) {
        return matches;
    }
    return null;
}

/**
 * Pattern 1: numbered list where the separator is whitespace, not punctuation.
 * Example: "1 АКТ анықтамасы\n2 Қоғам дамуы\n3 АКТ стандарттары"
 *
 * Distinguished from `attemptStrictNumbered` (which needs `.` or `)`) and
 * `attemptVoprosPrefix` (which needs a word like "Вопрос"). Relies entirely
 * on isMonotonic() to reject false positives like years (2023, 2024) since
 * those don't form an ascending 1..N sequence.
 */
function attemptDigitWhitespace(text: string): SplitMatch[] | null {
    // Requires:
    //   - line start (with optional indent)
    //   - 1..3 digits
    //   - at least one space/tab
    //   - then a non-space character (the question body)
    // Negative lookahead prevents matching "1." / "1)" / "1)" — those are
    // handled by attemptStrictNumbered with higher priority and finer
    // post-processing.
    const re = /^[ \t]*(\d{1,3})(?![.):])[ \t]+(?=\S)/gm;
    const matches: SplitMatch[] = [];
    const numbers: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const n = Number(m[1]);
        matches.push({ position: m.index, captureNumber: n });
        numbers.push(n);
    }
    if (matches.length >= MIN_MATCH_COUNT && isMonotonic(numbers)) {
        return matches;
    }
    return null;
}

/**
 * Pattern 3: exam-ticket blocks. Each ticket starts with a heading like
 * "Емтихан билеті №1" / "Билет №1" / "Ticket 1" and may contain several
 * sub-questions. We split per ticket and keep the entire ticket body as
 * one ParsedQuestion (the UI shows the whole ticket as the unit of study).
 *
 * Falls back to the un-numbered "Емтихандық билет" header when no number
 * appears — repeating the same exact header phrase 5+ times is itself a
 * reliable split signal.
 */
function attemptTicketBlocks(text: string): SplitMatch[] | null {
    // Note: JavaScript's `\b` is ASCII-only and does not match between Cyrillic
    // letters and whitespace. We use explicit lookaheads on `[ \t\n]` instead.
    //
    // Numbered variant (highest precision).
    const numbered = /^[ \t]*(?:Емтихан\s+билеті|Емтихандық\s+билет|Билет|Ticket)[ \t]+№?\s*(\d{1,3})(?=$|[ \t\n.,)])/gim;
    const numberedMatches: SplitMatch[] = [];
    const numbers: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = numbered.exec(text)) !== null) {
        const n = Number(m[1]);
        numberedMatches.push({ position: m.index, captureNumber: n });
        numbers.push(n);
    }
    if (numberedMatches.length >= MIN_PREFIX_MATCH_COUNT && isMonotonicLenient(numbers)) {
        return numberedMatches;
    }

    // Un-numbered repeated header variant. Need at least 5 to be confident
    // (otherwise random phrase repetition could trigger this).
    const unnumbered = /^[ \t]*(?:Емтихандық\s+билет|Емтихан\s+билеті|Билет|Ticket)(?=$|[ \t\n])/gim;
    const unMatches: SplitMatch[] = [];
    while ((m = unnumbered.exec(text)) !== null) {
        unMatches.push({ position: m.index, captureNumber: null });
    }
    if (unMatches.length >= MIN_MATCH_COUNT) {
        return unMatches;
    }
    return null;
}

/**
 * Returns true if the line looks like decoration (page numbers, dates,
 * signature lines, all-caps headers, etc.) rather than a real question.
 */
function isParagraphNoise(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 10) return true;
    if (trimmed.length > 700) return true;

    // Pure numbers, dates, signatures.
    if (/^[\d\s.,/():№-]+$/.test(trimmed)) return true;

    // Signature / footer lines containing underscores or many dots.
    if (/_{3,}/.test(trimmed)) return true;
    if (/\.{4,}/.test(trimmed)) return true;

    // Lines that are just a year.
    if (/^(?:19|20)\d{2}\s*(?:ж\.?|г\.?)?$/.test(trimmed)) return true;

    // Page boilerplate.
    if (/^(?:Хаттама|Протокол|Кафедра|Әзірлеген|Утверждена?|Бекіт|Зав\.|Председатель|Көрсеткен|Аға\s+оқытушы|БЕКІТ|УТВЕРЖД|Құрастырған|Подпись)/i.test(trimmed)) return true;

    // Discipline/program code lines like "6В07201 – «Геология...»" — they
    // accidentally look like questions because they contain letters and
    // punctuation, but never actually represent exam content.
    if (/^[67][BВ]\d{5}\b/i.test(trimmed)) return true;

    // Decorative ALL-CAPS short header lines.
    const letters = trimmed.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 3 && letters.length < 60
        && letters === letters.toUpperCase()
        && letters !== letters.toLowerCase()
        && !trimmed.endsWith('?')) {
        return true;
    }

    // Must contain at least 3 alphabetic word chars to count as content.
    const wordChars = trimmed.match(/[\p{L}]/gu) || [];
    if (wordChars.length < 3) return true;

    return false;
}

/**
 * Pattern 2 — biggest broken category in the audit: unnumbered question
 * list, one question per paragraph or per line. Only activates when a
 * recognisable heading phrase is present in the document (skipBoilerplate
 * already trimmed it to start at that heading, so we recognise it on the
 * first non-empty line).
 *
 * Splitting policy:
 *   1. Drop the heading line itself.
 *   2. Prefer paragraph splitting (blank line separator); fall back to
 *      single-line splitting if too few paragraphs are produced.
 *   3. Filter out signature/footer noise.
 */
function attemptUnnumberedAfterHeading(text: string): ParsedQuestion[] | null {
    // Heading must be present (skipBoilerplate ensures it sits near the top).
    let headingMatch: RegExpExecArray | null = null;
    for (const re of QUESTION_LIST_HEADINGS) {
        const r = new RegExp(re.source, re.flags);
        const m = r.exec(text);
        if (m) {
            if (!headingMatch || m.index < headingMatch.index) {
                headingMatch = m;
            }
        }
    }
    if (!headingMatch) return null;

    // Heading must be near the start of the text. If skipBoilerplate ran
    // earlier, this will already be true; the guard prevents accidental
    // mid-document false positives.
    if (headingMatch.index > 2000) return null;

    // Skip everything through the end of the heading line.
    const headingLineEnd = text.indexOf('\n', headingMatch.index + headingMatch[0].length);
    const body = headingLineEnd >= 0 ? text.slice(headingLineEnd + 1) : '';
    if (!body.trim()) return null;

    // Strategy A: split by blank lines.
    const byParagraph = body
        .split(/\n\s*\n+/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => !isParagraphNoise(p));

    // Strategy B: split by single newlines (for docs without blank-line
    // paragraph breaks, like the геология .doc files).
    const byLine = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => !isParagraphNoise(l));

    const chosen = byParagraph.length >= 5 ? byParagraph : byLine;
    if (chosen.length < 5) return null;

    return chosen.slice(0, 1000).map((raw, i) => {
        // Strip leading numbering if it accidentally crept in.
        const stripped = raw
            .replace(/^[ \t]*\d{1,3}[.)][ \t]+/, '')
            .replace(/^[ \t]*\d{1,3}[ \t]+(?=\S)/, '')
            .replace(/^[ \t]*[•\-—–][ \t]+/, '')
            .trim();
        const text = cleanQuestionBody(stripped);
        return { index: i + 1, text } as ParsedQuestion;
    }).filter((q) => q.text.length >= MIN_QUESTION_TEXT);
}

/**
 * If the text contains a recognisable "Экзаменационные вопросы" /
 * "Емтихан сұрақтары" heading reasonably deep into the document, strip
 * everything before it so noise (program-code lists, signature blocks,
 * title pages) doesn't poison the strict numbered splitter.
 *
 * Leaves the text untouched when no heading is found OR the heading is
 * right at the top — in those cases the prefix is already valuable
 * context and we don't want to lose it.
 */
function skipBoilerplate(text: string): string {
    let bestIdx = -1;
    for (const re of QUESTION_LIST_HEADINGS) {
        const r = new RegExp(re.source, re.flags);
        const m = r.exec(text);
        if (m && m.index > 100 && (bestIdx === -1 || m.index < bestIdx)) {
            bestIdx = m.index;
        }
    }
    return bestIdx > 0 ? text.slice(bestIdx) : text;
}

function attemptLooseNumbered(text: string): SplitMatch[] | null {
    const re = /(?:^|\n)[ \t]*(\d{1,3})[.)][ \t]+/g;
    const matches: SplitMatch[] = [];
    const numbers: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const n = Number(m[1]);
        // Skip the leading newline so the slice starts at the digit.
        const position = m.index + (m[0].startsWith('\n') ? 1 : 0);
        matches.push({ position, captureNumber: n });
        numbers.push(n);
    }
    if (matches.length >= MIN_MATCH_COUNT && isMonotonic(numbers)) {
        return matches;
    }
    return null;
}

function attemptBulleted(text: string): SplitMatch[] | null {
    const re = /^[ \t]*[•\-—–][ \t]+(?=\S)/gm;
    const matches: SplitMatch[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        matches.push({ position: m.index, captureNumber: null });
    }
    if (matches.length >= MIN_MATCH_COUNT) {
        return matches;
    }
    return null;
}

export function parseQuestionList(
    text: string,
    _hints?: { language?: 'ru' | 'kz' },
): ParsedQuestion[] {
    const normalized = normalize(text);
    if (!normalized.trim()) {
        return [];
    }
    // Strip title-page / signature noise before pattern matching so that
    // numeric splitters aren't confused by document chrome (Pattern 4 in
    // the audit). Falls through to the original text if no heading is
    // found.
    const trimmed = skipBoilerplate(normalized);

    // Order matters: most-specific to most-permissive. Tickets and explicit
    // prefixes are tried before strict numbered because some "Билет №1
    // 1. ..." documents would otherwise be split at the inner "1." instead
    // of the ticket boundary, losing the multi-question grouping.
    const strategies: Array<(t: string) => SplitMatch[] | null> = [
        attemptTicketBlocks,
        attemptStrictNumbered,
        attemptDigitWhitespace,
        attemptVoprosPrefix,
        attemptLooseNumbered,
        attemptBulleted,
    ];

    for (const strategy of strategies) {
        const matches = strategy(trimmed);
        if (matches && matches.length > 0) {
            const split = splitAt(trimmed, matches);
            if (split.length > 0) {
                return split;
            }
        }
    }

    // Final structured fallback: heading-anchored unnumbered paragraphs.
    // Only fires when *nothing* numeric matched; this is the path that
    // rescues the biggest broken category (Pattern 2 in the audit).
    const unnumbered = attemptUnnumberedAfterHeading(trimmed);
    if (unnumbered && unnumbered.length > 0) {
        return unnumbered;
    }

    // Fallback: single item with the whole text.
    const body = cleanQuestionBody(normalized);
    if (!body) return [];
    return [{ index: 1, text: body }];
}

// ---------------------------------------------------------------------------
// Persistence + orchestration
// ---------------------------------------------------------------------------

function computeContentHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extensionFromFilename(filename: string): string {
    if (!filename) return '';
    const dot = filename.lastIndexOf('.');
    if (dot === -1) return '';
    return filename.slice(dot + 1).toLowerCase();
}

async function loadCachedRow(fileId: string): Promise<ParsedContentRow | null> {
    return withSupabasePostgres(async (client) => {
        const result = await client.query<ParsedContentRow>(
            `
                select file_id, content_hash, parsed_at, parser_version,
                       extractor, extract_ok, raw_text, questions_json, error_reason
                from app_umkd_parsed_content
                where file_id = $1
                limit 1
            `,
            [fileId],
        );
        return result.rows[0] ?? null;
    });
}

async function upsertParsedRow(
    fileId: string,
    contentHash: string,
    extractor: ExtractorKind,
    extractOk: boolean,
    rawText: string | null,
    questions: ParsedQuestion[],
    errorReason: string | null,
): Promise<string> {
    const persisted = await withSupabasePostgres(async (client) => {
        const result = await client.query<{ parsed_at: Date }>(
            `
                insert into app_umkd_parsed_content
                    (file_id, content_hash, parsed_at, parser_version,
                     extractor, extract_ok, raw_text, questions_json, error_reason)
                values ($1, $2, now(), $3, $4, $5, $6, $7::jsonb, $8)
                on conflict (file_id) do update set
                    content_hash   = excluded.content_hash,
                    parsed_at      = now(),
                    parser_version = excluded.parser_version,
                    extractor      = excluded.extractor,
                    extract_ok     = excluded.extract_ok,
                    raw_text       = excluded.raw_text,
                    questions_json = excluded.questions_json,
                    error_reason   = excluded.error_reason
                returning parsed_at
            `,
            [
                fileId,
                contentHash,
                PARSER_VERSION,
                extractor,
                extractOk,
                rawText,
                JSON.stringify(questions),
                errorReason,
            ],
        );
        return result.rows[0]?.parsed_at ?? new Date();
    });
    const ts = persisted instanceof Date ? persisted : new Date();
    return ts.toISOString();
}

function rowToParseResult(fileId: string, row: ParsedContentRow): ParseResult {
    const parsedAt = row.parsed_at instanceof Date
        ? row.parsed_at.toISOString()
        : new Date(row.parsed_at).toISOString();
    const questions = Array.isArray(row.questions_json) ? row.questions_json : [];
    const extractor = (row.extractor as ExtractorKind) || 'unsupported';
    const result: ParseResult = {
        fileId,
        extractor,
        ok: row.extract_ok,
        questions,
        parsedAt,
        parserVersion: row.parser_version,
    };
    if (row.error_reason) {
        result.errorReason = row.error_reason;
    }
    return result;
}

// In-process lock to dedupe concurrent parse requests per fileId.
const inFlightLocks = new Map<string, Promise<ParseResult>>();

export async function getOrParseExamQuestions(fileId: string): Promise<ParseResult> {
    const existingLock = inFlightLocks.get(fileId);
    if (existingLock) {
        return existingLock;
    }

    const task = (async (): Promise<ParseResult> => {
        const downloaded = await downloadFromStorageByFileId(fileId);
        if (!downloaded) {
            throw new Error(`File not found: ${fileId}`);
        }

        const contentHash = computeContentHash(downloaded.buffer);

        const cached = await loadCachedRow(fileId);
        if (cached && cached.parser_version === PARSER_VERSION && cached.content_hash === contentHash) {
            return rowToParseResult(fileId, cached);
        }

        const extension = extensionFromFilename(downloaded.filename);
        const extracted = await extractTextFromBuffer(
            downloaded.buffer,
            downloaded.contentType,
            extension,
        );

        if (!extracted.ok) {
            const parsedAt = await upsertParsedRow(
                fileId,
                contentHash,
                extracted.extractor,
                false,
                null,
                [],
                extracted.error ?? 'extraction failed',
            );
            const result: ParseResult = {
                fileId,
                extractor: extracted.extractor,
                ok: false,
                questions: [],
                parsedAt,
                parserVersion: PARSER_VERSION,
            };
            if (extracted.error) {
                result.errorReason = extracted.error;
            }
            return result;
        }

        const questions = parseQuestionList(extracted.text);
        const parsedAt = await upsertParsedRow(
            fileId,
            contentHash,
            extracted.extractor,
            true,
            extracted.text,
            questions,
            null,
        );

        return {
            fileId,
            extractor: extracted.extractor,
            ok: true,
            questions,
            parsedAt,
            parserVersion: PARSER_VERSION,
        };
    })();

    inFlightLocks.set(fileId, task);
    try {
        return await task;
    } finally {
        inFlightLocks.delete(fileId);
    }
}
