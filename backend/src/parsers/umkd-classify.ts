/**
 * UMKD exam-questions classifier.
 *
 * Pure function: given a UMKD material's title / filename / KSTU "type" cell,
 * returns whether the material is an exam-questions document and how confident
 * we are. No I/O, no DB, no logging of file content.
 */

export type ExamQuestionConfidence = 'strong' | 'medium' | 'weak' | 'none';

export interface ClassificationInput {
    title?: string;
    filename?: string;
    type?: string; // KSTU's free-form file-kind cell (often "PDF" / "Лекция" / "doc")
}

export interface ClassificationResult {
    kind: 'exam-questions' | 'other';
    confidence: ExamQuestionConfidence;
    reason: string;
}

// Most specific phrases first; substring matches against the normalised hay.
const STRONG_PHRASE: readonly string[] = [
    // RU
    'перечень экзаменационных вопросов',
    'перечень вопросов к экзамену',
    'вопросы для подготовки к экзамену',
    'примерные вопросы к экзамену',
    'примерный перечень вопросов',
    'вопросы к экзамену',
    'вопросы на экзамен',
    'экзаменационные вопросы',
    // KZ
    'емтиханға арналған сұрақтар',
    'емтихан сұрақтары',
    'емтихан сурактары',
    // EN
    'examination questions',
    'questions for the exam',
    'questions for exam',
    'exam questions',
];

// Filename slug-style markers (we check these against a punctuation-stripped
// filename, where separators have been collapsed to underscores).
const STRONG_FILENAME_PATTERN: readonly string[] = [
    'ekz_voprosy', 'ekz-voprosy', 'ekzvoprosy',
    'voprosy_k_ekzamenu', 'voprosy_ekzamen',
    'examquestions', 'exam_questions', 'exam-questions',
    'emtihan_suraktari', 'emtihan-suraktari',
];

const EXAM_TOKEN: readonly string[] = ['экзамен', 'экзаменацион', 'exam', 'examinat', 'емтихан'];
const QUESTION_TOKEN: readonly string[] = ['вопрос', 'question', 'сұрақ', 'сурак'];

const NEGATIVE_TOKEN: readonly string[] = [
    'лекци', 'лаборатор', 'практик', 'силабус', 'syllabus',
    'программа курса', 'тестов', 'расписание', 'ведомост',
    'методическ', 'рабочая программа',
];

/**
 * Normalise text for matching: lowercase, ё→е, strip punctuation (keep spaces),
 * collapse whitespace.
 */
function normalise(text: string): string {
    return text
        .toLowerCase()
        .replace(/ё/g, 'е')
        // Keep word chars + Cyrillic/Kazakh letters + spaces; replace everything else with space.
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Build a slug-style representation of a filename so that "ekz_voprosy_2024.pdf"
 * matches the STRONG_FILENAME_PATTERN list. Lowercase, ё→е, non-alphanumerics
 * collapsed to underscores.
 */
function slugifyForFilename(text: string): string {
    return text
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function containsAny(hay: string, needles: readonly string[]): string | null {
    for (const n of needles) {
        if (hay.includes(n)) return n;
    }
    return null;
}

export function classifyUmkdMaterial(input: ClassificationInput): ClassificationResult {
    const title = input.title ?? '';
    const filename = input.filename ?? '';
    const type = input.type ?? '';

    const hay = normalise(`${title} ${filename} ${type}`);

    if (!hay) {
        return { kind: 'other', confidence: 'none', reason: 'no match' };
    }

    // 1. Strong phrase match (most reliable).
    const phraseHit = containsAny(hay, STRONG_PHRASE);
    if (phraseHit) {
        return { kind: 'exam-questions', confidence: 'strong', reason: `phrase:${phraseHit}` };
    }

    // 2. Strong filename slug pattern.
    const fnameSlug = slugifyForFilename(filename);
    const fnameHit = containsAny(fnameSlug, STRONG_FILENAME_PATTERN);
    if (fnameHit) {
        return { kind: 'exam-questions', confidence: 'strong', reason: `filename:${fnameHit}` };
    }

    // 3. Exam + question token combo (separately present).
    const examTok = containsAny(hay, EXAM_TOKEN);
    const questionTok = containsAny(hay, QUESTION_TOKEN);
    if (examTok && questionTok) {
        return { kind: 'exam-questions', confidence: 'medium', reason: 'exam+question' };
    }

    // 4. Lone exam token, short title, no negative tokens.
    // Note on "Программа экзамена": the negative list contains the *phrase*
    // 'программа курса', not the bare word 'программа'. That's deliberate —
    // blocking 'программа' alone would also reject legitimate items such as
    // "Программа экзаменационных вопросов". So "Программа экзамена" passes
    // through as a 'weak' match (lone exam token, short title), and consumers
    // can filter by confidence if they want stricter results.
    if (examTok) {
        const titleNorm = normalise(title);
        const titleWordCount = titleNorm ? titleNorm.split(' ').length : 0;
        const negativeHit = containsAny(hay, NEGATIVE_TOKEN);
        if (!negativeHit && titleWordCount > 0 && titleWordCount <= 4) {
            return { kind: 'exam-questions', confidence: 'weak', reason: 'exam word only' };
        }
    }

    return { kind: 'other', confidence: 'none', reason: 'no match' };
}
