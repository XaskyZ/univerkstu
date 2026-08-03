import 'dotenv/config';
import * as cheerio from 'cheerio';
import { BASE_URL, httpGet, isLoggedIn, login, switchToRussian } from '../parsers/http-client.js';

type PagePriority = 'covered' | 'high' | 'medium' | 'low' | 'deprioritized' | 'unknown';

interface PageMetadata {
    priority: PagePriority;
    notes: string[];
    missingData?: string[];
}

interface PageSignals {
    hasForms: boolean;
    hasTables: boolean;
    hasDownloadLinks: boolean;
    hasStudentDataWords: boolean;
    categories: string[];
}

interface CoveragePageReport {
    path: string;
    title: string;
    covered: boolean;
    status: number | 'ERR';
    forms: number;
    tables: number;
    headings: string[];
    signals: PageSignals;
    priority: PagePriority;
    notes: string[];
    missingData: string[];
    error?: string;
}

interface CoverageAuditReport {
    generatedAt: string;
    source: string;
    usingAccount: string;
    coverageAllowlist: string[];
    totalStudentLinks: number;
    coveredCount: number;
    uncoveredCount: number;
    highValueUncovered: string[];
    lowValueUncovered: string[];
    pages: CoveragePageReport[];
    summary: {
        covered: string[];
        uncovered: string[];
        priorityBuckets: Record<PagePriority, string[]>;
        notes: string[];
    };
}

const CURRENT_COVERAGE_ALLOWLIST = [
    '/student/bachelor/',
    '/student/iup/0/',
    '/student/attestation/',
    '/student/myschedule/',
    '/student/myexam/schedule/',
    '/student/umkd/',
];

const PAGE_METADATA: Record<string, PageMetadata> = {
    '/student/bachelor/': {
        priority: 'covered',
        notes: ['Currently parsed as the main univer profile entry page.'],
    },
    '/student/iup/0/': {
        priority: 'covered',
        notes: ['Currently parsed as IUP data.'],
    },
    '/student/attestation/': {
        priority: 'covered',
        notes: ['Currently parsed as attestation data.'],
    },
    '/student/myschedule/': {
        priority: 'covered',
        notes: ['Currently parsed as class schedule.'],
    },
    '/student/myexam/schedule/': {
        priority: 'covered',
        notes: ['Currently parsed as exam schedule.'],
    },
    '/student/umkd/': {
        priority: 'covered',
        notes: ['Currently parsed as UMKD content.'],
    },
    '/student/profile/': {
        priority: 'high',
        notes: ['Student questionnaire contains a large amount of identity, enrollment, contact, and document metadata that is not collected now.'],
        missingData: [
            'payment form',
            'foreign language',
            'admission type',
            'grant issue date and grant number',
            'specialization',
            'student status and study condition',
            'student ID and IKT code',
            'sex',
            'birth date',
            'citizenship and nationality',
            'home and registration addresses',
            'phones',
            'parents contacts',
            'ID document fields',
            'previous education institution fields',
            'orders',
            'awards, quotas, social vulnerabilities',
        ],
    },
    '/student/transcript/': {
        priority: 'high',
        notes: ['Transcript contains richer long-term academic history than current attestation parsing.'],
        missingData: [
            'full subject history',
            'year GPA values',
            'credits mastered per year',
            'education program group',
            'study duration',
            'personal file number',
        ],
    },
    '/student/recbook/': {
        priority: 'high',
        notes: ['Gradebook contains granular exam and control data not represented in current profile payload.'],
        missingData: [
            'RK and MT values',
            'PA values',
            'exam dates',
            'examiners',
            'continuous credit-book history',
        ],
    },
    '/student/practik/indexlist/': {
        priority: 'high',
        notes: ['Practice page contains unique internship/practice assignment state.'],
        missingData: [
            'practice type',
            'practice period',
            'practice supervisor',
            'organization',
            'practice status',
        ],
    },
    '/student/advicer/': {
        priority: 'high',
        notes: ['Advisor page contains unique advisor identity and contacts.'],
        missingData: [
            'advisor full name',
            'advisor email',
            'advisor work phone',
        ],
    },
    '/student/educplan/': {
        priority: 'medium',
        notes: ['Educational plan overlaps with IUP, but still exposes richer metadata and practice/control details.'],
        missingData: [
            'admission year',
            'semester count',
            'discipline cycle',
            'type of control',
            'language group',
            'practice items',
        ],
    },
    '/student/academcalendar/': {
        priority: 'medium',
        notes: ['Academic calendar may be useful, but is less critical than profile/transcript/practice.'],
    },
    '/student/advfiles/': {
        priority: 'medium',
        notes: ['Advisor files may contain useful documents, but are secondary relative to structured profile data.'],
    },
    '/student/mymidterm/schedule/': {
        priority: 'medium',
        notes: ['Midterm schedule is structurally separate from exam schedule.'],
    },
    '/student/fail/': {
        priority: 'medium',
        notes: ['Retake debt flow is potentially useful, but lower value than transcript/profile.'],
    },
    '/student/failfx/': {
        priority: 'medium',
        notes: ['FX retake flow is potentially useful, but lower value than transcript/profile.'],
    },
    '/student/gpaincrease/': {
        priority: 'medium',
        notes: ['GPA increase page may be useful later, but is not a first-wave parser target.'],
    },
    '/student/TestList/': {
        priority: 'low',
        notes: ['Testing section exists but is not a strong product priority right now.'],
    },
    '/student/discussion/index/': {
        priority: 'low',
        notes: ['Distance courses section is low priority for current product scope.'],
    },
    '/student/mydata/edit/': {
        priority: 'low',
        notes: ['Personal data edit page is interactive and low value for read-only product parsing.'],
    },
    '/student/attendance/full/': {
        priority: 'deprioritized',
        notes: ['Attendance/grade journal should not be treated as the primary grades source after migration to Platonus.'],
    },
};

const KEYWORDS: Array<{ category: string; terms: string[] }> = [
    { category: 'profile', terms: ['анкета', 'студент id', 'гражданство', 'национальность', 'контактные данные'] },
    { category: 'transcript', terms: ['транскрипт', 'освоено кредитов', 'gpa'] },
    { category: 'gradebook', terms: ['зачетная книжка', 'экзаменатор', 'рк, %', 'па, %'] },
    { category: 'advisor', terms: ['эдвайзер', 'рабочий телефон'] },
    { category: 'practice', terms: ['практика', 'руководитель практики', 'организация'] },
    { category: 'attendance', terms: ['посещений', 'успеваемости', 'журнал'] },
    { category: 'calendar', terms: ['академический календарь'] },
    { category: 'midterm', terms: ['midterm'] },
    { category: 'debts', terms: ['retake', 'fx', 'задолженности', 'пересдача'] },
];

function normalizePath(value: string): string | null {
    if (!value) return null;

    try {
        const url = new URL(value, BASE_URL);
        if (url.origin !== BASE_URL) return null;
        let pathname = url.pathname;
        if (!pathname.endsWith('/')) pathname += '/';
        return pathname;
    } catch {
        return null;
    }
}

function cleanText(value: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function titleOf(html: string): string {
    const $ = cheerio.load(html);
    return cleanText($('title').text());
}

function extractPrimaryContentText(html: string): string {
    const $ = cheerio.load(html);

    $('#tools').remove();
    $('#auth_modal').remove();
    $('#modal_pass_empty_wait').remove();
    $('#copyright').remove();
    $('#window-resize-icon').remove();
    $('#l1, #l2, #l3, #l5').remove();
    $('script, style, noscript').remove();
    $('.sociallink-div').remove();

    return cleanText($('body').text() || '');
}

function detectSignals(html: string): PageSignals {
    const $ = cheerio.load(html);
    const body = extractPrimaryContentText(html).toLowerCase();
    const categories = KEYWORDS
        .filter(({ terms }) => terms.some((term) => body.includes(term.toLowerCase())))
        .map(({ category }) => category);

    return {
        hasForms: $('form').length > 0,
        hasTables: $('table').length > 0,
        hasDownloadLinks: $('a[href*="download"], a[href*="/get/"], a.downLoad').length > 0,
        hasStudentDataWords: categories.length > 0,
        categories,
    };
}

function headingsOf(html: string): string[] {
    const $ = cheerio.load(html);
    return $('h1,h2,h3,.ct,.bottom-center,.brk td.ct')
        .map((_, el) => cleanText($(el).text()))
        .get()
        .filter(Boolean)
        .slice(0, 10);
}

function silenceModuleLogs(): () => void {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
        process.stderr.write(`${args.join(' ')}\n`);
    };
    console.warn = (...args: unknown[]) => {
        process.stderr.write(`${args.join(' ')}\n`);
    };
    console.error = (...args: unknown[]) => {
        process.stderr.write(`${args.join(' ')}\n`);
    };

    return () => {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    };
}

async function main() {
    const restoreLogs = silenceModuleLogs();

    try {
        const username = process.env.KSTU_USERNAME;
        const password = process.env.KSTU_PASSWORD;

        if (!username || !password) {
            throw new Error('KSTU_USERNAME and KSTU_PASSWORD must be set in backend/.env');
        }

        const cookies = await login(username, password);
        if (!cookies) {
            throw new Error('Failed to login to univer.kstu.kz using test credentials');
        }

        const cookiesRu = await switchToRussian(cookies);
        const bachelorPage = await httpGet(`${BASE_URL}/student/bachelor/`, cookiesRu);

        if (!isLoggedIn(bachelorPage.data)) {
            throw new Error('Authenticated session was not established for /student/bachelor/');
        }

        const $ = cheerio.load(bachelorPage.data);
        const studentLinks = new Set<string>();
        $('a[href]').each((_, el) => {
            const normalized = normalizePath($(el).attr('href') || '');
            if (normalized && normalized.startsWith('/student/')) {
                studentLinks.add(normalized);
            }
        });

        const coverageSet = new Set(CURRENT_COVERAGE_ALLOWLIST.map(normalizePath).filter(Boolean) as string[]);
        const pages: CoveragePageReport[] = [];

        for (const path of [...studentLinks].sort()) {
            const pageMeta = PAGE_METADATA[path];
            const covered = coverageSet.has(path);

            try {
                const response = await httpGet(`${BASE_URL}${path}`, cookiesRu, {
                    referer: `${BASE_URL}/student/bachelor/`,
                });
                const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
                const signals = detectSignals(html);

                pages.push({
                    path,
                    title: titleOf(html),
                    covered,
                    status: response.status,
                    forms: cheerio.load(html)('form').length,
                    tables: cheerio.load(html)('table').length,
                    headings: headingsOf(html),
                    signals,
                    priority: covered ? 'covered' : (pageMeta?.priority || 'unknown'),
                    notes: pageMeta?.notes || ['Discovered in navigation but not classified yet.'],
                    missingData: pageMeta?.missingData || [],
                });
            } catch (error) {
                pages.push({
                    path,
                    title: '',
                    covered,
                    status: 'ERR',
                    forms: 0,
                    tables: 0,
                    headings: [],
                    signals: {
                        hasForms: false,
                        hasTables: false,
                        hasDownloadLinks: false,
                        hasStudentDataWords: false,
                        categories: [],
                    },
                    priority: covered ? 'covered' : (pageMeta?.priority || 'unknown'),
                    notes: pageMeta?.notes || ['Discovered in navigation but not classified yet.'],
                    missingData: pageMeta?.missingData || [],
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const priorityBuckets: Record<PagePriority, string[]> = {
            covered: [],
            high: [],
            medium: [],
            low: [],
            deprioritized: [],
            unknown: [],
        };

        for (const page of pages) {
            priorityBuckets[page.priority].push(page.path);
        }

        const report: CoverageAuditReport = {
            generatedAt: new Date().toISOString(),
            source: 'univer.kstu.kz /student/bachelor/ navigation audit',
            usingAccount: username,
            coverageAllowlist: [...coverageSet].sort(),
            totalStudentLinks: pages.length,
            coveredCount: pages.filter((page) => page.covered).length,
            uncoveredCount: pages.filter((page) => !page.covered).length,
            highValueUncovered: pages.filter((page) => !page.covered && page.priority === 'high').map((page) => page.path),
            lowValueUncovered: pages.filter((page) => !page.covered && (page.priority === 'low' || page.priority === 'deprioritized')).map((page) => page.path),
            pages,
            summary: {
                covered: pages.filter((page) => page.covered).map((page) => page.path),
                uncovered: pages.filter((page) => !page.covered).map((page) => page.path),
                priorityBuckets,
                notes: [
                    'Audit is read-only and uses only current test credentials from backend/.env.',
                    'attendance/full is intentionally deprioritized as a primary grades source because grades moved to Platonus.',
                    'The largest current gap is /student/profile/, which contains student questionnaire and identity/contact metadata not present in current parsing.',
                ],
            },
        };

        restoreLogs();
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        restoreLogs();
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

void main();
