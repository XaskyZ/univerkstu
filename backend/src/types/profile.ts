/**
 * Profile Types - типы профиля студента и чистые хелперы нормализации.
 *
 * Раньше жили в parsers/profile.ts вместе с HTML-парсерами univer.kstu.kz.
 * Univer отключён навсегда, парсеры удалены; типы описывают форму данных,
 * которая по-прежнему лежит в кэше профиля (`profile_<userId>`) и отдаётся
 * фронтенду. Источник новых данных — только Platonus (services/profile.ts).
 */

export interface StudentProfile {
    fullName: string;
    formOfEducation: string;
    educationLevel: string;
    department: string;
    educationStep: string;
    faculty: string;
    specialty: string;
    course: number;
    transferGPA: number;
    questionnaire?: StudentQuestionnaire;
}

export interface ProfileDetailEntry {
    label: string;
    value: string;
}

export interface ProfileSection {
    key: string;
    title: string;
    entries: ProfileDetailEntry[];
}

export interface ProfileOrderRecord {
    course: string | null;
    numberAndDate: string;
    description: string | null;
}

export interface StudentQuestionnaireSummary {
    paymentForm: string | null;
    foreignLanguage: string | null;
    admissionType: string | null;
    grantIssueDate: string | null;
    grantNumber: string | null;
    specialization: string | null;
    studentStatus: string | null;
    studyState: string | null;
    iktCode: string | null;
    admissionBasis: string | null;
    workPosition: string | null;
    healthStatus: string | null;
    studentId: string | null;
    firstName: string | null;
    lastName: string | null;
    middleName: string | null;
    recordBookNumber: string | null;
    gender: string | null;
    country: string | null;
    localityStatus: string | null;
    residenceRegion: string | null;
    district: string | null;
    birthPlace: string | null;
    studentResidence: string | null;
    needsDormitory: string | null;
    arrivalAddress: string | null;
    mobilePhone: string | null;
    parentsContacts: string | null;
    birthDate: string | null;
    citizenship: string | null;
    nationality: string | null;
    familyStatus: string | null;
    financialCategory: string | null;
    workplace: string | null;
}

export interface StudentQuestionnaire {
    sections: ProfileSection[];
    orders: ProfileOrderRecord[];
    summary: StudentQuestionnaireSummary;
}

export interface Subject {
    name: string;
    credits: number;
    hours: number;
    lectureHours: number;
    seminarHours: number;
    labHours: number;
    srspHours: number;
    srsHours: number;
    teachers: {
        lecture?: string;
        seminar?: string;
        lab?: string;
        srsp?: string;
        practice?: string;
    };
    controlType: string;
}

export interface Semester {
    number: number;
    subjects: Subject[];
}

export interface IUP {
    semesters: Semester[];
}

export interface GradeRecord {
    subject: string;
    credits: number;
    rk1?: number;
    rk2?: number;
    pa?: number;
    total: number;
    gpa: number;
    letterGrade: string;
    description: string;
}

export interface Attestation {
    currentGPA: number;
    currentYear: string;
    creditsEarned: number;
    grades: GradeRecord[];
}

export interface TranscriptSubjectRecord {
    termLabel: string;
    code: string;
    subject: string;
    credits: number;
    hours: number;
    numericGrade: number | null;
    letterGrade: string | null;
    gpa: number | null;
}

export interface TranscriptYearSummary {
    label: string;
    creditsEarned: number | null;
    gpa: number | null;
}

export interface TranscriptPracticeRecord {
    practiceType: string;
    period: string;
    credits: number;
    hours: number;
    numericGrade: number | null;
    letterGrade: string | null;
    gpa: number | null;
}

export interface TranscriptFinalAttestationRecord {
    subject: string;
    protocolDate: string | null;
    credits: number;
    hours: number;
    grade: string | null;
}

export interface TranscriptSummary {
    fullName: string | null;
    faculty: string | null;
    educationStep: string | null;
    groupProgram: string | null;
    educationalProgram: string | null;
    formOfEducation: string | null;
    course: number | null;
    educationLevel: string | null;
    department: string | null;
    studyDuration: string | null;
    caseFileNumber: string | null;
}

export interface TranscriptStats {
    totalSubjects: number | null;
    excellent: number | null;
    good: number | null;
    satisfactory: number | null;
    unsatisfactory: number | null;
}

export interface StudentTranscript {
    summary: TranscriptSummary;
    subjects: TranscriptSubjectRecord[];
    yearSummaries: TranscriptYearSummary[];
    practices: TranscriptPracticeRecord[];
    finalAttestations: TranscriptFinalAttestationRecord[];
    stats: TranscriptStats;
    orders: ProfileOrderRecord[];
}

export interface RecbookSummary {
    fullName: string | null;
    faculty: string | null;
    educationStep: string | null;
    specialtyCode: string | null;
    specialty: string | null;
    formOfEducation: string | null;
    educationLevel: string | null;
    specialization: string | null;
    course: number | null;
    department: string | null;
    studyDuration: string | null;
    caseFileNumber: string | null;
}

export interface RecbookRecord {
    termLabel: string;
    subject: string;
    credits: number;
    rk: number | null;
    mt: number | null;
    teacher: string | null;
    pa: number | null;
    examDate: string | null;
    examiner: string | null;
    numericGrade: number | null;
    letterGrade: string | null;
}

export interface StudentRecbook {
    summary: RecbookSummary;
    records: RecbookRecord[];
}

export interface StudentPracticeGroup {
    groupNumber: string;
    practiceType: string;
    period: string;
    supervisor: string | null;
    organization: string | null;
    status: string | null;
}

export interface StudentPractice {
    groups: StudentPracticeGroup[];
}

export interface StudentAdvisor {
    fullName: string | null;
    email: string | null;
    workPhone: string | null;
}

export interface StudentEducPlanSummary {
    formOfEducation: string | null;
    educationStep: string | null;
    educationLevel: string | null;
    specialty: string | null;
    totalSemesters: number | null;
    admissionYear: number | null;
}

export interface StudentEducPlanCycleCounts {
    ood: number | null;
    bd: number | null;
    pd: number | null;
    additionalDisciplines: number | null;
    additionalLearning: number | null;
}

export interface StudentEducPlanSemesterOverview {
    semesterNumber: number;
    totalSubjects: number;
    totalCredits: number;
    controlTypes: string[];
}

export interface StudentEducPlan {
    summary: StudentEducPlanSummary;
    cycleCounts: StudentEducPlanCycleCounts;
    semesters: StudentEducPlanSemesterOverview[];
}

export interface StudentAcademicOptions {
    retake: {
        availableCount: number;
        submittedCount: number;
    };
    fx: {
        availableCount: number;
        submittedCount: number;
    };
    gpaIncrease: {
        availableCount: number;
        submittedCount: number;
        annualCost: string | null;
        currentGpa: number | null;
        earnedCredits: number | null;
    };
}

// === Чистые хелперы нормализации (без HTML/сети) ===

export function cleanText(value: string | undefined | null): string {
    return (value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeSectionTitle(title: string): string {
    return cleanText(title)
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[:：]\s*$/, '')
        .trim();
}

export function normalizeLabel(label: string): string {
    return cleanText(label)
        .replace(/^[•·\-\u2022]+/, '')
        .replace(/[:：]\s*$/, '')
        .trim();
}

export function sectionKey(title: string): string {
    return normalizeSectionTitle(title)
        .toLowerCase()
        .replace(/[^a-zа-яё0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '');
}

export function pickSectionValue(
    sections: ProfileSection[],
    sectionMatcher: (title: string, key: string) => boolean,
    labelMatcher: (label: string) => boolean
): string | null {
    for (const section of sections) {
        if (!sectionMatcher(section.title, section.key)) continue;
        for (const entry of section.entries) {
            if (labelMatcher(entry.label)) {
                return entry.value || null;
            }
        }
    }
    return null;
}

export function parseIntSafe(value: string | null | undefined): number {
    const cleaned = cleanText(value);
    const match = cleaned.match(/-?\d+/);
    if (!match) return 0;
    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNumberSafe(value: string | null | undefined): number | null {
    const cleaned = cleanText(value);
    if (!cleaned) return null;
    const normalized = cleaned.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

export function readPairTableSummary(rows: string[][]): Record<string, string> {
    const pairs: Record<string, string> = {};
    for (const cells of rows) {
        for (let i = 0; i < cells.length - 1; i += 2) {
            const label = normalizeLabel(cells[i]);
            const value = cleanText(cells[i + 1]);
            if (!label) continue;
            pairs[label] = value;
        }
    }
    return pairs;
}

export function parseEducPlanValue(text: string, label: string): string | null {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Note on the trailing `(?=\\s|$)` instead of `\\b`: JS regex `\\b` is defined on the
    // ASCII word-char class, so "Семестр\\b" never matches (Cyrillic letters aren't \\w).
    // The whitespace-or-end lookahead achieves the same intent without relying on \\b.
    const match = text.match(new RegExp(`${escaped}:\\s*(.+?)(?=\\s+[А-ЯA-ZЁІҚҢҒҮҰӨҺ][^:]{1,60}:|\\s+\\d+\\s+Семестр(?=\\s|$)|$)`));
    return match?.[1]?.trim() || null;
}

export function pickEducationSectionValue(questionnaire: StudentQuestionnaire, needle: string): string | null {
    return pickSectionValue(
        questionnaire.sections,
        (_title, key) => key.includes('обучение'),
        (label) => label.toLowerCase().includes(needle.toLowerCase())
    );
}

export function parseCourseValue(value: string | null): number | null {
    if (!value) return null;
    const match = value.match(/\d+/);
    if (!match) return null;
    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) ? parsed : null;
}
