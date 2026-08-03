/**
 * Client helper for the inline exam-question parser API (Phase 1).
 *
 * Endpoint: `GET /api/v3/umkd/exam-questions/:fileId/parsed`
 *
 * The backend may not be deployed everywhere at the same time as this UI, so
 * the helper is intentionally tolerant: any non-success response collapses to
 * a stub `{ ok: false, questions: [] }` payload that the UI can still render
 * (it falls back to the existing file-row view in that case).
 */
import { fetchWithAuth, type ApiResponse } from './core';

export type ParsedExamExtractor = 'mammoth' | 'pdfjs' | 'unsupported';

export interface ParsedExamQuestion {
    index: number;
    text: string;
    section?: string;
}

export interface ParsedExamQuestionsResponse {
    fileId: string;
    extractor: ParsedExamExtractor;
    ok: boolean;
    questions: ParsedExamQuestion[];
    parsedAt: string;
    parserVersion: number;
    errorReason?: string;
}

function emptyResponse(fileId: string, errorReason?: string): ParsedExamQuestionsResponse {
    return {
        fileId,
        extractor: 'unsupported',
        ok: false,
        questions: [],
        parsedAt: new Date(0).toISOString(),
        parserVersion: 0,
        ...(errorReason ? { errorReason } : {}),
    };
}

function normalizeQuestion(raw: unknown): ParsedExamQuestion | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as { index?: unknown; text?: unknown; section?: unknown };
    if (typeof obj.index !== 'number' || !Number.isFinite(obj.index)) return null;
    if (typeof obj.text !== 'string') return null;
    const trimmed = obj.text.trim();
    if (!trimmed) return null;
    const out: ParsedExamQuestion = { index: obj.index, text: trimmed };
    if (typeof obj.section === 'string' && obj.section.trim()) {
        out.section = obj.section.trim();
    }
    return out;
}

function normalize(fileId: string, raw: unknown): ParsedExamQuestionsResponse {
    if (!raw || typeof raw !== 'object') return emptyResponse(fileId);
    const obj = raw as Partial<ParsedExamQuestionsResponse> & { questions?: unknown };
    const extractor: ParsedExamExtractor =
        obj.extractor === 'mammoth' || obj.extractor === 'pdfjs' || obj.extractor === 'unsupported'
            ? obj.extractor
            : 'unsupported';
    const questions = Array.isArray(obj.questions)
        ? obj.questions
            .map(normalizeQuestion)
            .filter((q): q is ParsedExamQuestion => q !== null)
        : [];
    return {
        fileId: typeof obj.fileId === 'string' && obj.fileId ? obj.fileId : fileId,
        extractor,
        ok: Boolean(obj.ok),
        questions,
        parsedAt: typeof obj.parsedAt === 'string' ? obj.parsedAt : new Date(0).toISOString(),
        parserVersion: typeof obj.parserVersion === 'number' ? obj.parserVersion : 0,
        ...(typeof obj.errorReason === 'string' ? { errorReason: obj.errorReason } : {}),
    };
}

/**
 * Fetch the parsed-question payload for a single UMKD exam-question file.
 *
 * Returns a normalized response even on failure (with `ok: false` and empty
 * `questions`). Callers should branch on `ok` rather than catching errors.
 */
export async function fetchParsedExamQuestions(
    fileId: string,
): Promise<ParsedExamQuestionsResponse> {
    if (!fileId) return emptyResponse('');
    const result: ApiResponse<ParsedExamQuestionsResponse> = await fetchWithAuth(
        `/api/v3/umkd/exam-questions/${encodeURIComponent(fileId)}/parsed`,
    );
    if (!result.success || !result.data) {
        return emptyResponse(fileId, result.error);
    }
    return normalize(fileId, result.data);
}
