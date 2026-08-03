/**
 * Profile Parser - парсинг профиля и ИУП студента KSTU
 * Использует HTTP запросы вместо Playwright
 */

import * as cheerio from 'cheerio';
import { login, switchToRussian, httpGet, KSTUCookies, BASE_URL } from './http-client.js';

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

/**
 * Парсинг профиля студента из HTML
 */
function parseProfileHtml(html: string): StudentProfile {
    const $ = cheerio.load(html);
    const bodyText = $('body').text() || '';

    let fullName = '';
    const nameMatch = html.match(/Здравствуйте\s*<b>([^<]+)<\/b>/);
    if (nameMatch) {
        fullName = nameMatch[1].trim();
    }

    const profile: StudentProfile = {
        fullName,
        formOfEducation: '',
        educationLevel: '',
        department: '',
        educationStep: '',
        faculty: '',
        specialty: '',
        course: 0,
        transferGPA: 0
    };

    // Парсинг из таблицы
    $('table.inner tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
            const label = $(cells.get(0)).text().trim().toLowerCase();
            const value = $(cells.get(1)).text().trim();
            
            if (label && value) {
                if (label.includes('курс')) {
                    const courseNum = value.match(/\d+/);
                    profile.course = courseNum ? parseInt(courseNum[0]) : 0;
                }
                if (label.includes('факультет') || label.includes('факультеті')) profile.faculty = value;
                if (label.includes('специальность') || label.includes('мамандығы')) profile.specialty = value;
                if (label.includes('форма') || label.includes('оқу түрі')) profile.formOfEducation = value;
                if (label.includes('уровень') || label.includes('деңгей')) profile.educationLevel = value;
                if (label.includes('отделение') || label.includes('бөлім')) profile.department = value;
                if (label.includes('ступен') || label.includes('саты')) profile.educationStep = value;
            }
        }
    });

    // Дополнительный парсинг из текста
    if (!profile.specialty) {
        const specMatch = bodyText.match(/специальность[:\s]*([^\n\r]+)/i) || 
                          bodyText.match(/мамандығы[:\s]*([^\n\r]+)/i);
        if (specMatch) profile.specialty = specMatch[1].trim();
    }
    
    if (!profile.faculty) {
        const facMatch = bodyText.match(/факультет[:\s]*([^\n\r]+)/i) ||
                         bodyText.match(/факультеті[:\s]*([^\n\r]+)/i);
        if (facMatch) profile.faculty = facMatch[1].trim();
    }
    
    if (!profile.course) {
        const courseMatch = bodyText.match(/курс[:\s]*(\d+)/i) || bodyText.match(/(\d+)\s*курс/i);
        if (courseMatch) profile.course = parseInt(courseMatch[1]);
    }
    
    // GPA
    const gpaPatterns = [
        /GPA\s*=\s*(\d+[.,]?\d*)/i,
        /переводной уровень[^=]*=\s*(\d+[.,]?\d*)/i,
    ];
    for (const pattern of gpaPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
            profile.transferGPA = parseFloat(match[1].replace(',', '.'));
            break;
        }
    }
    
    // ФИО
    const fioMatch = bodyText.match(/Здравствуйте\s+([^.\n]+)/i) ||
                     bodyText.match(/Сәлеметсіз бе\s+([^.\n]+)/i);
    if (fioMatch && !profile.fullName) profile.fullName = fioMatch[1].trim();
    
    return profile;
}

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

function extractSectionEntries($: cheerio.CheerioAPI, sectionNodes: cheerio.Cheerio<any>): ProfileDetailEntry[] {
    const entries: ProfileDetailEntry[] = [];
    const seen = new Set<string>();

    sectionNodes.find('tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;

        for (let i = 0; i < cells.length - 1; i += 2) {
            const label = normalizeLabel($(cells.get(i)).text());
            const value = cleanText($(cells.get(i + 1)).text());
            if (!label) continue;

            const key = `${label}__${value}`;
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ label, value });
        }
    });

    return entries;
}

function extractOrders($: cheerio.CheerioAPI, sectionNodes: cheerio.Cheerio<any>): ProfileOrderRecord[] {
    const orders: ProfileOrderRecord[] = [];
    sectionNodes.find('table.inner tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length !== 3) return;

        const course = cleanText($(cells.get(0)).text()) || null;
        const numberAndDate = cleanText($(cells.get(1)).text());
        const description = cleanText($(cells.get(2)).text()) || null;
        if (!numberAndDate) return;

        orders.push({
            course,
            numberAndDate,
            description,
        });
    });
    return orders;
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

function buildQuestionnaireSummary(sections: ProfileSection[]): StudentQuestionnaireSummary {
    const inSection = (needle: string) => (_title: string, key: string) => key.includes(needle);
    const labelIncludes = (needle: string) => (label: string) => label.toLowerCase().includes(needle);

    return {
        paymentForm: pickSectionValue(sections, inSection('обучение'), labelIncludes('форма оплаты')),
        foreignLanguage: pickSectionValue(sections, inSection('обучение'), labelIncludes('иностранный язык')),
        admissionType: pickSectionValue(sections, inSection('обучение'), labelIncludes('тип поступления')),
        grantIssueDate: pickSectionValue(sections, inSection('обучение'), labelIncludes('дата выдачи гранта')),
        grantNumber: pickSectionValue(sections, inSection('обучение'), labelIncludes('номер гранта')),
        specialization: pickSectionValue(sections, inSection('обучение'), labelIncludes('специализация')),
        studentStatus: pickSectionValue(sections, inSection('обучение'), labelIncludes('статус студента')),
        studyState: pickSectionValue(sections, inSection('обучение'), labelIncludes('состояние учебы')),
        iktCode: pickSectionValue(sections, inSection('обучение'), labelIncludes('код икт')),
        admissionBasis: pickSectionValue(sections, inSection('обучение'), labelIncludes('основание для поступления')),
        workPosition: pickSectionValue(sections, inSection('обучение'), labelIncludes('должность студента')),
        healthStatus: pickSectionValue(sections, inSection('обучение'), labelIncludes('состояние здоровья')),
        studentId: pickSectionValue(sections, inSection('студент'), (label) => label.toLowerCase() === 'id'),
        firstName: pickSectionValue(sections, inSection('студент'), labelIncludes('имя')),
        lastName: pickSectionValue(sections, inSection('студент'), labelIncludes('фамилия')),
        middleName: pickSectionValue(sections, inSection('студент'), labelIncludes('отчество')),
        recordBookNumber: pickSectionValue(sections, inSection('студент'), labelIncludes('зачетки')),
        gender: pickSectionValue(sections, inSection('студент'), labelIncludes('пол')),
        country: pickSectionValue(sections, inSection('контактные'), labelIncludes('страна')),
        localityStatus: pickSectionValue(sections, inSection('контактные'), labelIncludes('статус населенного пункта')),
        residenceRegion: pickSectionValue(sections, inSection('контактные'), labelIncludes('область проживания')),
        district: pickSectionValue(sections, inSection('контактные'), (label) => label.toLowerCase() === 'район'),
        birthPlace: pickSectionValue(sections, inSection('контактные'), labelIncludes('место рождения')),
        studentResidence: pickSectionValue(sections, inSection('контактные'), labelIncludes('место проживания студента')),
        needsDormitory: pickSectionValue(sections, inSection('контактные'), labelIncludes('общежитие')),
        arrivalAddress: pickSectionValue(sections, inSection('контактные'), labelIncludes('адрес прибытия')),
        mobilePhone: pickSectionValue(sections, inSection('контактные'), labelIncludes('мобильного телефона')),
        parentsContacts: pickSectionValue(sections, inSection('контактные'), labelIncludes('контакты родителей')),
        birthDate: pickSectionValue(sections, (title, key) => key.includes('персональные') || title.toLowerCase().includes('персональные'), labelIncludes('дата рождения')),
        citizenship: pickSectionValue(sections, (title, key) => key.includes('персональные') || title.toLowerCase().includes('персональные'), labelIncludes('гражданство')),
        nationality: pickSectionValue(sections, (title, key) => key.includes('персональные') || title.toLowerCase().includes('персональные'), labelIncludes('национальность')),
        familyStatus: pickSectionValue(sections, (title, key) => key.includes('персональные') || title.toLowerCase().includes('персональные'), labelIncludes('семейное положение')),
        financialCategory: pickSectionValue(sections, (title, key) => key.includes('персональные') || title.toLowerCase().includes('персональные'), labelIncludes('категория обеспеченности')),
        workplace: pickSectionValue(sections, (title, key) => key.includes('персональные') || title.toLowerCase().includes('персональные'), labelIncludes('место работы студента')),
    };
}

function parseStudentQuestionnaireHtml(html: string): StudentQuestionnaire {
    const $ = cheerio.load(html);
    const sections: ProfileSection[] = [];
    let orders: ProfileOrderRecord[] = [];

    $('tr.brk').each((_, breakRow) => {
        const rawTitle = $(breakRow).find('td.ct').first().text();
        const title = normalizeSectionTitle(rawTitle);
        if (!title) return;

        let nodes = $();
        let cursor = $(breakRow).next();
        while (cursor.length) {
            if (cursor.hasClass('brk') || cursor.hasClass('bot')) break;
            nodes = nodes.add(cursor);
            cursor = cursor.next();
        }

        const key = sectionKey(title);
        if (key.includes('приказы')) {
            orders = extractOrders($, nodes);
            sections.push({
                key,
                title,
                entries: orders.map((order, index) => ({
                    label: order.course ? `Курс ${order.course}` : `Приказ ${index + 1}`,
                    value: [order.numberAndDate, order.description].filter(Boolean).join(' — '),
                })),
            });
            return;
        }

        sections.push({
            key,
            title,
            entries: extractSectionEntries($, nodes),
        });
    });

    return {
        sections,
        orders,
        summary: buildQuestionnaireSummary(sections),
    };
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

function normalizeCellTexts($: cheerio.CheerioAPI, row: unknown): string[] {
    return $(row as any).find('td,th').map((_, cell) => cleanText($(cell).text())).get();
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

function parseTranscriptHtml(html: string): StudentTranscript {
    const $ = cheerio.load(html);
    const tables = $('table');

    const summaryRows = tables.eq(1).find('tr').toArray().map((row) => normalizeCellTexts($, row));
    const summaryPairs = readPairTableSummary(summaryRows);

    const subjects: TranscriptSubjectRecord[] = [];
    const yearSummaries: TranscriptYearSummary[] = [];
    let currentTermLabel = '';

    tables.eq(2).find('tr').each((_, row) => {
        const cells = normalizeCellTexts($, row);
        if (cells.length === 0) return;
        const rowText = cells.join(' ').trim();
        if (!rowText) return;
        if (cells[0] === '№' || cells[0] === '1') return;

        if (rowText.includes('Семестр')) {
            currentTermLabel = rowText.replace(/\s+/g, ' ').trim();
            return;
        }

        if (rowText.includes('Освоено кредитов за год')) {
            const creditsMatch = rowText.match(/Освоено кредитов за год\s*-\s*(\d+)/i);
            const gpaMatch = rowText.match(/GPA\s*\(([^)]+)\)\s*:\s*([\d.,]+)/i);
            yearSummaries.push({
                label: gpaMatch?.[1]?.trim() || currentTermLabel || 'Год обучения',
                creditsEarned: creditsMatch ? parseIntSafe(creditsMatch[1]) : null,
                gpa: gpaMatch ? parseNumberSafe(gpaMatch[2]) : null,
            });
            return;
        }

        const halves: string[][] = cells.length >= 16
            ? [cells.slice(0, 8), cells.slice(8, 16)]
            : [cells];

        for (const half of halves) {
            if (half.length < 8) continue;
            const [index, code, subject, credits, hours, numericGrade, letterGrade, gpa] = half;
            if (!index || !subject || subject === 'Наименование дисциплины') continue;

            subjects.push({
                termLabel: currentTermLabel,
                code,
                subject,
                credits: parseIntSafe(credits),
                hours: parseIntSafe(hours),
                numericGrade: parseNumberSafe(numericGrade),
                letterGrade: cleanText(letterGrade) || null,
                gpa: parseNumberSafe(gpa),
            });
        }
    });

    const practices: TranscriptPracticeRecord[] = [];
    tables.eq(3).find('tr').slice(2).each((_, row) => {
        const cells = normalizeCellTexts($, row);
        if (cells.length < 7 || !cells[0] || cells[0].includes('Виды профессиональных практик')) return;
        practices.push({
            practiceType: cells[0],
            period: cells[1],
            credits: parseIntSafe(cells[2]),
            hours: parseIntSafe(cells[3]),
            numericGrade: parseNumberSafe(cells[4]),
            letterGrade: cleanText(cells[5]) || null,
            gpa: parseNumberSafe(cells[6]),
        });
    });

    const finalAttestations: TranscriptFinalAttestationRecord[] = [];
    tables.eq(4).find('tr').slice(1).each((_, row) => {
        const cells = normalizeCellTexts($, row);
        if (cells.length < 5 || !cells[0] || cells[0].includes('Наименование дисциплины')) return;
        finalAttestations.push({
            subject: cells[0],
            protocolDate: cleanText(cells[1]) || null,
            credits: parseIntSafe(cells[2]),
            hours: parseIntSafe(cells[3]),
            grade: cleanText(cells[4]) || null,
        });
    });

    const statsRows = tables.eq(5).find('tr').toArray().map((row) => normalizeCellTexts($, row));
    const stats: TranscriptStats = {
        totalSubjects: null,
        excellent: null,
        good: null,
        satisfactory: null,
        unsatisfactory: null,
    };
    const statsText = statsRows.map((row) => row.join(' ')).join(' ');
    const totalMatch = statsText.match(/Всего предметов\s+(\d+)/i);
    const excellentMatch = statsText.match(/Из них\s+(\d+)\s+Отлично/i);
    stats.totalSubjects = totalMatch ? parseIntSafe(totalMatch[1]) : null;
    stats.excellent = excellentMatch ? parseIntSafe(excellentMatch[1]) : null;
    for (const row of statsRows) {
        if (row.length < 2) continue;
        const value = parseIntSafe(row[0]);
        const label = row[1]?.toLowerCase() || '';
        if (label.includes('хорошо')) stats.good = value;
        if (label.includes('удовлетворительно')) stats.satisfactory = value;
        if (label.includes('неудовлетворительно')) stats.unsatisfactory = value;
    }

    const orders: ProfileOrderRecord[] = [];
    tables.eq(6).find('tr').slice(1).each((_, row) => {
        const cells = normalizeCellTexts($, row);
        if (cells.length < 3) return;
        const numberAndDate = cleanText(cells[1]);
        const description = cleanText(cells[2]);
        if (!numberAndDate && !description) return;
        orders.push({
            course: cleanText(cells[0]) || null,
            numberAndDate,
            description: description || null,
        });
    });

    return {
        summary: {
            fullName: summaryPairs['Ф.И.О.'] || null,
            faculty: summaryPairs['Факультет'] || null,
            educationStep: summaryPairs['Ступень обучения'] || null,
            groupProgram: summaryPairs['Группа образовательных программ'] || null,
            educationalProgram: summaryPairs['Образовательная программа'] || null,
            formOfEducation: summaryPairs['Форма обучения'] || null,
            course: parseCourseValue(summaryPairs['Курс обучения']) || null,
            educationLevel: summaryPairs['Уровень обучения'] || null,
            department: summaryPairs['Отделение'] || null,
            studyDuration: summaryPairs['Срок обучения'] || null,
            caseFileNumber: summaryPairs['Личное дело №'] || null,
        },
        subjects,
        yearSummaries,
        practices,
        finalAttestations,
        stats,
        orders,
    };
}

function parseRecbookHtml(html: string): StudentRecbook {
    const $ = cheerio.load(html);
    const tables = $('table');
    const summaryRows = tables.eq(1).find('tr').toArray().map((row) => normalizeCellTexts($, row));
    const summaryPairs = readPairTableSummary(summaryRows);

    const records: RecbookRecord[] = [];
    let currentTermLabel = '';
    tables.eq(2).find('tr').each((_, row) => {
        const cells = normalizeCellTexts($, row);
        if (cells.length === 0) return;
        const rowText = cells.join(' ').trim();
        if (!rowText) return;
        if (cells[0] === '№' || cells[0] === '1') return;
        if (rowText.includes('Семестр')) {
            currentTermLabel = rowText.replace(/\s+/g, ' ').trim();
            return;
        }
        if (cells.length < 11 || !cells[0] || !cells[1]) return;

        records.push({
            termLabel: currentTermLabel,
            subject: cells[1],
            credits: parseIntSafe(cells[2]),
            rk: parseNumberSafe(cells[3]),
            mt: parseNumberSafe(cells[4]),
            teacher: cleanText(cells[5]) || null,
            pa: parseNumberSafe(cells[6]),
            examDate: cleanText(cells[7]) || null,
            examiner: cleanText(cells[8]) || null,
            numericGrade: parseNumberSafe(cells[9]),
            letterGrade: cleanText(cells[10]) || null,
        });
    });

    return {
        summary: {
            fullName: summaryPairs['Ф.И.О.'] || null,
            faculty: summaryPairs['Факультет'] || null,
            educationStep: summaryPairs['Ступень обучения'] || null,
            specialtyCode: summaryPairs['Шифр специальности'] || null,
            specialty: summaryPairs['Специальность'] || null,
            formOfEducation: summaryPairs['Форма обучения'] || null,
            educationLevel: summaryPairs['Уровень обучения'] || null,
            specialization: summaryPairs['Специализация'] || null,
            course: parseCourseValue(summaryPairs['Курс обучения']) || null,
            department: summaryPairs['Отделение'] || null,
            studyDuration: summaryPairs['Срок обучения'] || null,
            caseFileNumber: summaryPairs['Личное дело №'] || null,
        },
        records,
    };
}

function parsePracticeHtml(html: string): StudentPractice {
    const $ = cheerio.load(html);
    const groups: StudentPracticeGroup[] = [];

    $('table').each((_, table) => {
        const rows = $(table).find('tr');
        let headerIndex = -1;
        rows.each((rowIndex, row) => {
            const cells = normalizeCellTexts($, row);
            if (
                cells[0] === 'Номер группы'
                && cells[1] === 'Тип практики'
                && cells[2]?.includes('Период')
            ) {
                headerIndex = rowIndex;
            }
        });
        if (headerIndex === -1) return;

        rows.slice(headerIndex + 1).each((_, row) => {
            const cells = normalizeCellTexts($, row);
            if (cells.length < 6) return;
            if (!cells[0] || !/^\d+$/.test(cells[0])) return;
            groups.push({
                groupNumber: cells[0],
                practiceType: cells[1],
                period: cells[2],
                supervisor: cleanText(cells[3]) || null,
                organization: cleanText(cells[4]) || null,
                status: cleanText(cells[5]) || null,
            });
        });
    });

    return { groups };
}

function parseAdvisorHtml(html: string): StudentAdvisor {
    const $ = cheerio.load(html);
    const pairs = new Map<string, string>();

    $('table').each((_, table) => {
        $(table).find('tr').each((_, row) => {
            const cells = normalizeCellTexts($, row);
            for (let i = 0; i < cells.length - 1; i += 2) {
                const label = normalizeLabel(cells[i]);
                const value = cleanText(cells[i + 1]);
                if (!label) continue;
                pairs.set(label, value);
            }
        });
    });

    return {
        fullName: pairs.get('Ф.И.О.') || null,
        email: pairs.get('E-mail') || null,
        workPhone: pairs.get('Рабочий телефон') || null,
    };
}

export function parseEducPlanValue(text: string, label: string): string | null {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Note on the trailing `(?=\\s|$)` instead of `\\b`: JS regex `\\b` is defined on the
    // ASCII word-char class, so "Семестр\\b" never matches (Cyrillic letters aren't \\w).
    // The whitespace-or-end lookahead achieves the same intent without relying on \\b.
    const match = text.match(new RegExp(`${escaped}:\\s*(.+?)(?=\\s+[А-ЯA-ZЁІҚҢҒҮҰӨҺ][^:]{1,60}:|\\s+\\d+\\s+Семестр(?=\\s|$)|$)`));
    return match?.[1]?.trim() || null;
}

function parseEducPlanHtml(html: string): StudentEducPlan {
    const $ = cheerio.load(html);
    const bodyText = cleanText($('body').text() || '');

    const summary: StudentEducPlanSummary = {
        formOfEducation: parseEducPlanValue(bodyText, 'Форма обучения'),
        educationStep: parseEducPlanValue(bodyText, 'Ступень обучения'),
        educationLevel: parseEducPlanValue(bodyText, 'Уровень/направление обучения'),
        specialty: parseEducPlanValue(bodyText, 'Специальность'),
        totalSemesters: parseNumberSafe(parseEducPlanValue(bodyText, 'Количество семестров')) ?? null,
        admissionYear: parseNumberSafe(parseEducPlanValue(bodyText, 'Год поступления')) ?? null,
    };

    const cycleHeading = $('td.ct, th.ct, h1, h2, h3')
        .map((_, el) => cleanText($(el).text()))
        .get()
        .find((text) => text.includes('ООД:') && text.includes('БД:') && text.includes('ПД:')) || bodyText;

    const cycleCounts: StudentEducPlanCycleCounts = {
        ood: parseNumberSafe((cycleHeading.match(/ООД:\s*(\d+)/i) || [])[1]) ?? null,
        bd: parseNumberSafe((cycleHeading.match(/БД:\s*(\d+)/i) || [])[1]) ?? null,
        pd: parseNumberSafe((cycleHeading.match(/ПД:\s*(\d+)/i) || [])[1]) ?? null,
        additionalDisciplines: parseNumberSafe((cycleHeading.match(/Дополнительные дисциплины:\s*(\d+)/i) || [])[1]) ?? null,
        additionalLearning: parseNumberSafe((cycleHeading.match(/Дополнительные виды обучения:\s*(\d+)/i) || [])[1]) ?? null,
    };

    const semesters: StudentEducPlanSemesterOverview[] = [];
    $('table').each((_, table) => {
        const rows = $(table).find('tr');
        const headerRow = rows.first();
        const headerText = cleanText(headerRow.text());
        const semesterMatch = headerText.match(/^(\d+)\s+Семестр/i);
        if (!semesterMatch) return;

        let totalSubjects = 0;
        let totalCredits = 0;
        const controlTypes = new Set<string>();

        rows.slice(2).each((_, row) => {
            const cells = normalizeCellTexts($, row);
            if (cells.length < 12) return;
            const subject = cleanText(cells[1]);
            if (!subject || subject === 'Дисциплины') return;

            totalSubjects += 1;
            totalCredits += parseIntSafe(cells[3]);
            const controlType = cleanText(cells[10]);
            if (controlType) {
                controlTypes.add(controlType);
            }
        });

        semesters.push({
            semesterNumber: Number.parseInt(semesterMatch[1], 10),
            totalSubjects,
            totalCredits,
            controlTypes: [...controlTypes],
        });
    });

    return {
        summary,
        cycleCounts,
        semesters,
    };
}

function countDataRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>, minimumCells: number): number {
    let count = 0;
    table.find('tr').each((_, row) => {
        const cells = normalizeCellTexts($, row);
        if (cells.length < minimumCells) return;
        const rowText = cells.join(' ').trim();
        if (!rowText || rowText.includes('Нет данных')) return;
        if (cells.every((cell) => !cell || /^№$|^Заявка$|^Дисциплина$|^Стоимость$|^Дата подачи заявки$|^Статус$|^Заявление$|^Сумма$/i.test(cell))) {
            return;
        }
        count += 1;
    });
    return count;
}

function parseAcademicOptionsHtml(
    retakeHtml: string,
    fxHtml: string,
    gpaHtml: string
): StudentAcademicOptions {
    const $retake = cheerio.load(retakeHtml);
    const $fx = cheerio.load(fxHtml);
    const $gpa = cheerio.load(gpaHtml);
    const gpaText = cleanText($gpa('body').text() || '');

    const retakeTables = $retake('table.mt');
    const fxTables = $fx('table.mt');
    const gpaTables = $gpa('table.mt');

    const annualCostMatch = gpaText.match(/Стоимость обучения за 1 год составляет:\s*([^G]+?)\s+GPA/i);
    const currentGpaMatch = gpaText.match(/GPA-\s*([\d.,]+)/i);
    const earnedCreditsMatch = gpaText.match(/Освоено кредитов[^\d]*(\d+)/i);

    return {
        retake: {
            availableCount: retakeTables.length > 1 ? countDataRows($retake, retakeTables.eq(1), 5) : 0,
            submittedCount: retakeTables.length > 2 ? countDataRows($retake, retakeTables.eq(2), 6) : 0,
        },
        fx: {
            availableCount: fxTables.length > 1 ? countDataRows($fx, fxTables.eq(1), 5) : 0,
            submittedCount: fxTables.length > 2 ? countDataRows($fx, fxTables.eq(2), 6) : 0,
        },
        gpaIncrease: {
            availableCount: gpaTables.length > 1 ? countDataRows($gpa, gpaTables.eq(1), 8) : 0,
            submittedCount: gpaTables.length > 2 ? countDataRows($gpa, gpaTables.eq(2), 6) : 0,
            annualCost: annualCostMatch?.[1]?.trim() || null,
            currentGpa: currentGpaMatch ? parseNumberSafe(currentGpaMatch[1]) : null,
            earnedCredits: earnedCreditsMatch ? parseNumberSafe(earnedCreditsMatch[1]) : null,
        },
    };
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

/**
 * Парсинг ИУП из HTML
 */
function parseIUPHtml(html: string): IUP {
    const $ = cheerio.load(html);
    const semesters: Semester[] = [];

    $('table.inner').each((_, table) => {
        const $table = $(table);
        const headerText = $table.find('tr th').first().text() || '';
        
        const semMatch = headerText.match(/(\d+)\s*семестр/i);
        if (!semMatch) return;
        
        const semNumber = parseInt(semMatch[1]);
        const currentSemester: Semester = { number: semNumber, subjects: [] };
        
        $table.find('tr').each((_, row) => {
            const cells = $(row).find('td');
            
            if (cells.length >= 10) {
                const getCellText = (index: number) => $(cells.get(index)).text().trim();

                const name = getCellText(1);
                if (!name || name.includes('№')) return;

                const subject: Subject = {
                    name: name.replace(/^\([ЭE]\)\s*/, '').replace(/^\[\[?[ЭE]\]?\]\s*/, ''),
                    credits: parseInt(getCellText(2)) || 0,
                    hours: parseInt(getCellText(3)) || 0,
                    lectureHours: parseInt(getCellText(4)) || 0,
                    seminarHours: parseInt(getCellText(5)) || 0,
                    labHours: parseInt(getCellText(6)) || 0,
                    srspHours: parseInt(getCellText(7)) || 0,
                    srsHours: parseInt(getCellText(8)) || 0,
                    teachers: {},
                    controlType: getCellText(10)
                };

                const teachersCell = getCellText(9);
                const teacherLines = teachersCell.split(/\n|<br>/);
                for (const line of teacherLines) {
                    const match = line.match(/(Лек|Сем|Лаб|СРСП|Практика):\s*(.+)/i);
                    if (match) {
                        const type = match[1].toLowerCase();
                        const teacher = match[2].trim();
                        if (type.startsWith('лек')) subject.teachers.lecture = teacher;
                        else if (type.startsWith('сем')) subject.teachers.seminar = teacher;
                        else if (type.startsWith('лаб')) subject.teachers.lab = teacher;
                        else if (type.startsWith('срсп')) subject.teachers.srsp = teacher;
                        else if (type.startsWith('практ')) subject.teachers.practice = teacher;
                    }
                }

                currentSemester.subjects.push(subject);
            }
        });

        if (currentSemester.subjects.length > 0) {
            semesters.push(currentSemester);
        }
    });

    const uniqueSemesters = semesters.filter((sem, index, self) =>
        index === self.findIndex(s => s.number === sem.number)
    );

    return { semesters: uniqueSemesters.sort((a, b) => a.number - b.number) };
}

/**
 * Парсинг аттестации из HTML
 */
function parseAttestationHtml(html: string): Attestation {
    const $ = cheerio.load(html);
    const pageText = $('body').text() || '';

    const grades: GradeRecord[] = [];
    let currentGPA = 0;
    let currentYear = '';
    let creditsEarned = 0;

    // GPA
    const gpaPatterns = [
        /GPA\s*\(([^)]+)\)[^\d]*(\d+[.,]\d+)/i,
        /GPA\s*=\s*(\d+[.,]\d+)/i,
        /Итоговый GPA[:\s]*(\d+[.,]\d+)/i,
        /Средний балл[:\s]*(\d+[.,]\d+)/i,
        /(\d+[.,]\d+)\s*GPA/i,
    ];
    
    for (const pattern of gpaPatterns) {
        const match = pageText.match(pattern);
        if (match) {
            if (match[2]) {
                currentYear = match[1].trim();
                currentGPA = parseFloat(match[2].replace(',', '.'));
            } else {
                currentGPA = parseFloat(match[1].replace(',', '.'));
            }
            break;
        }
    }

    // Кредиты
    const creditsPatterns = [
        /Освоено кредитов[^\d]*(\d+)/i,
        /Кредиттер саны[^\d]*(\d+)/i,
        /Всего кредитов[^\d]*(\d+)/i,
    ];
    
    for (const pattern of creditsPatterns) {
        const match = pageText.match(pattern);
        if (match) {
            creditsEarned = parseInt(match[1]);
            break;
        }
    }

    // Оценки из таблицы
    $('table.inner tr').each((_, row) => {
        const cells = $(row).find('td, th');
        const text = $(row).text() || '';

        // GPA из таблицы
        if (currentGPA === 0) {
            const gpaMatch = text.match(/GPA\s*\(([^)]+)\)[^\d]*(\d+[.,]\d+)/);
            if (gpaMatch) {
                currentYear = gpaMatch[1].trim();
                currentGPA = parseFloat(gpaMatch[2].replace(',', '.'));
            }
        }

        // Кредиты из таблицы
        if (creditsEarned === 0) {
            const creditsMatch = text.match(/Освоено кредитов[^\d]*(\d+)/);
            if (creditsMatch) {
                creditsEarned = parseInt(creditsMatch[1]);
            }
        }

        if (cells.length >= 8) {
            const getCellText = (index: number) => $(cells.get(index)).text().trim();

            const subject = getCellText(0);
            if (subject && !subject.includes('Дисциплина') && !subject.includes('GPA')) {
                const grade: GradeRecord = {
                    subject,
                    credits: parseInt(getCellText(1)) || 0,
                    rk1: parseInt(getCellText(2)) || undefined,
                    rk2: parseInt(getCellText(3)) || undefined,
                    pa: parseInt(getCellText(4)) || undefined,
                    total: parseInt(getCellText(5)) || 0,
                    gpa: parseFloat(getCellText(6).replace(',', '.')) || 0,
                    letterGrade: getCellText(7),
                    description: getCellText(8)
                };
                grades.push(grade);
            }
        }
    });

    return {
        currentGPA,
        currentYear,
        creditsEarned,
        grades
    };
}

/**
 * Парсинг профиля через HTTP
 */
export async function parseProfile(cookies: KSTUCookies): Promise<StudentProfile> {
    const [bachelorResponse, questionnaireResponse] = await Promise.all([
        httpGet(`${BASE_URL}/student/bachelor/`, cookies),
        httpGet(`${BASE_URL}/student/profile/`, cookies, { referer: `${BASE_URL}/student/bachelor/` }),
    ]);

    const profile = parseProfileHtml(bachelorResponse.data);
    const questionnaire = parseStudentQuestionnaireHtml(questionnaireResponse.data);

    const fullNameFromQuestionnaire = [
        questionnaire.summary.lastName,
        questionnaire.summary.firstName,
        questionnaire.summary.middleName,
    ].filter(Boolean).join(' ').trim();
    const courseFromQuestionnaire = parseCourseValue(
        pickEducationSectionValue(questionnaire, 'номер курса')
        || pickEducationSectionValue(questionnaire, 'курс')
    );

    return {
        ...profile,
        fullName: profile.fullName || fullNameFromQuestionnaire,
        formOfEducation: profile.formOfEducation || pickEducationSectionValue(questionnaire, 'форма обучения') || '',
        educationLevel: profile.educationLevel || pickEducationSectionValue(questionnaire, 'уровень обучения') || '',
        department: profile.department || pickEducationSectionValue(questionnaire, 'отделение') || '',
        educationStep: profile.educationStep || pickEducationSectionValue(questionnaire, 'ступень обучения') || '',
        faculty: profile.faculty || pickEducationSectionValue(questionnaire, 'факультет') || '',
        specialty: profile.specialty || pickEducationSectionValue(questionnaire, 'специальность') || '',
        course: typeof profile.course === 'number' && profile.course > 0
            ? profile.course
            : (courseFromQuestionnaire ?? 0),
        questionnaire,
    };
}

/**
 * Парсинг ИУП через HTTP
 */
export async function parseIUP(cookies: KSTUCookies): Promise<IUP> {
    const { data: html } = await httpGet(`${BASE_URL}/student/iup/0`, cookies);
    return parseIUPHtml(html);
}

/**
 * Парсинг аттестации через HTTP
 */
export async function parseAttestation(cookies: KSTUCookies): Promise<Attestation> {
    const { data: html } = await httpGet(`${BASE_URL}/student/attestation/`, cookies);
    return parseAttestationHtml(html);
}

/**
 * Парсинг транскрипта через HTTP
 */
export async function parseTranscript(cookies: KSTUCookies): Promise<StudentTranscript> {
    const { data: html } = await httpGet(
        `${BASE_URL}/student/transcript/`,
        cookies,
        { referer: `${BASE_URL}/student/bachelor/` }
    );
    return parseTranscriptHtml(html);
}

/**
 * Парсинг зачетной книжки через HTTP
 */
export async function parseRecbook(cookies: KSTUCookies): Promise<StudentRecbook> {
    const { data: html } = await httpGet(
        `${BASE_URL}/student/recbook/`,
        cookies,
        { referer: `${BASE_URL}/student/bachelor/` }
    );
    return parseRecbookHtml(html);
}

/**
 * Парсинг практики через HTTP
 */
export async function parsePractice(cookies: KSTUCookies): Promise<StudentPractice> {
    const { data: html } = await httpGet(
        `${BASE_URL}/student/practik/indexlist/`,
        cookies,
        { referer: `${BASE_URL}/student/bachelor/` }
    );
    return parsePracticeHtml(html);
}

/**
 * Парсинг эдвайзера через HTTP
 */
export async function parseAdvisor(cookies: KSTUCookies): Promise<StudentAdvisor> {
    const { data: html } = await httpGet(
        `${BASE_URL}/student/advicer/`,
        cookies,
        { referer: `${BASE_URL}/student/bachelor/` }
    );
    return parseAdvisorHtml(html);
}

/**
 * Парсинг учебного плана через HTTP
 */
export async function parseEducPlan(cookies: KSTUCookies): Promise<StudentEducPlan> {
    const { data: html } = await httpGet(
        `${BASE_URL}/student/educplan/`,
        cookies,
        { referer: `${BASE_URL}/student/bachelor/` }
    );
    return parseEducPlanHtml(html);
}

export async function parseAcademicOptions(cookies: KSTUCookies): Promise<StudentAcademicOptions> {
    const [retakeResponse, fxResponse, gpaResponse] = await Promise.all([
        httpGet(`${BASE_URL}/student/fail/`, cookies, { referer: `${BASE_URL}/student/bachelor/` }),
        httpGet(`${BASE_URL}/student/failfx/`, cookies, { referer: `${BASE_URL}/student/bachelor/` }),
        httpGet(`${BASE_URL}/student/gpaincrease/`, cookies, { referer: `${BASE_URL}/student/bachelor/` }),
    ]);

    return parseAcademicOptionsHtml(retakeResponse.data, fxResponse.data, gpaResponse.data);
}

async function safeParseOptional<T>(
    label: string,
    parser: () => Promise<T>
): Promise<T | null> {
    try {
        return await parser();
    } catch (error) {
        console.warn(`[Profile Parser] Optional ${label} parse failed:`, error);
        return null;
    }
}

/**
 * Полный парсинг профиля студента
 * Использует HTTP запросы вместо Playwright
 */
export async function parseFullProfile(
    username: string,
    password: string
): Promise<{
    profile: StudentProfile;
    iup: IUP;
    attestation: Attestation;
    transcript: StudentTranscript | null;
    recbook: StudentRecbook | null;
    practice: StudentPractice | null;
    advisor: StudentAdvisor | null;
    educPlan: StudentEducPlan | null;
    academicOptions: StudentAcademicOptions | null;
}> {
    console.log('[Profile Parser] Starting (HTTP mode)...');

    // Авторизация через HTTP
    const cookies = await login(username, password);
    if (!cookies) {
        throw new Error('Ошибка авторизации. Проверьте логин и пароль.');
    }

    // Переключаем на русский
    const cookiesRu = await switchToRussian(cookies);

    // Парсим все данные параллельно
    const [profile, iup, attestation, transcript, recbook, practice, advisor, educPlan, academicOptions] = await Promise.all([
        parseProfile(cookiesRu),
        parseIUP(cookiesRu),
        parseAttestation(cookiesRu),
        safeParseOptional('transcript', () => parseTranscript(cookiesRu)),
        safeParseOptional('recbook', () => parseRecbook(cookiesRu)),
        safeParseOptional('practice', () => parsePractice(cookiesRu)),
        safeParseOptional('advisor', () => parseAdvisor(cookiesRu)),
        safeParseOptional('educPlan', () => parseEducPlan(cookiesRu)),
        safeParseOptional('academicOptions', () => parseAcademicOptions(cookiesRu)),
    ]);

    console.log('[Profile Parser] Done!');

    return { profile, iup, attestation, transcript, recbook, practice, advisor, educPlan, academicOptions };
}
