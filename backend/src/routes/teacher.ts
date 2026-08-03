/**
 * Teacher Profile Route
 * GET /api/v3/teacher/profile?url=<person.kstu.kz URL>
 * Fetches and parses teacher profile page on-demand
 */

import type { FastifyInstance } from 'fastify';
import * as cheerio from 'cheerio';
import { createTeacher, getTeacherLeaderboard, getUserScheduleTeachers, saveTeacherRating, searchTeachers, type TeacherLeaderboardPeriod, type TeacherTier } from '../services/teacher-ratings.js';
import {
    deleteTeacherNote,
    getTeacherNote,
    listMyTeacherNotes,
    normalizeTeacherKey,
    setTeacherNote,
    TEACHER_KEY_MAX_LENGTH,
    TEACHER_NOTE_MAX_LENGTH,
} from '../services/teacherNotes.js';
import { consumeRateLimit } from '../utils/rateLimit.js';
import { logAction } from '../utils/actionLog.js';
import { validateTeacherName } from '../utils/teacherNameValidator.js';
import { findTeacherInDb, fuzzyMatchTeacherName } from '../utils/teacherMatcher.js';

interface TeacherProfile {
    name: string;
    photoUrl: string | null;
    position: string | null;
    degree: string | null;
    department: string | null;
    /**
     * Faculty extracted from `kstu_staff_data.json` (when the staff DB
     * recognizes the profile URL/name). Optional — old cache entries and
     * unknown URLs return null.
     */
    faculty: string | null;
    bio: string | null;
    contacts: {
        phone: string | null;
        email: string | null;
    };
    sourceUrl: string;
}

// Simple in-memory cache (URL -> { data, fetchedAt })
const profileCache = new Map<string, { data: TeacherProfile; fetchedAt: number }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const MAX_TEACHER_NAME_LENGTH = 200;
const MAX_TEACHER_ID_LENGTH = 100;
const MAX_TEACHER_TAG_LENGTH = 100;
const MAX_TEACHER_TAGS_COUNT = 50;

const teacherCreateBodySchema = {
    type: 'object',
    required: ['name'],
    properties: {
        name: { type: 'string', minLength: 3, maxLength: MAX_TEACHER_NAME_LENGTH },
        // Phase 2: `force=true` lets the client bypass the "not in your schedule"
        // soft warning after the user explicitly confirmed. The backend still
        // records the flag for audit visibility.
        force: { type: 'boolean' },
    },
} as const;

const teacherRatingBodySchema = {
    type: 'object',
    required: ['teacherId', 'tier'],
    properties: {
        teacherId: { type: 'string', minLength: 1, maxLength: MAX_TEACHER_ID_LENGTH },
        tier: { type: 'string', enum: ['S', 'A', 'B', 'C', 'D', 'E', 'F'] },
        tags: {
            type: 'array',
            maxItems: MAX_TEACHER_TAGS_COUNT,
            items: { type: 'string', minLength: 1, maxLength: MAX_TEACHER_TAG_LENGTH },
        },
    },
} as const;

const teacherNoteParamsSchema = {
    type: 'object',
    required: ['teacherKey'],
    properties: {
        teacherKey: { type: 'string', minLength: 1, maxLength: TEACHER_KEY_MAX_LENGTH * 2 },
    },
} as const;

const teacherNoteBodySchema = {
    type: 'object',
    required: ['note'],
    properties: {
        note: { type: 'string', maxLength: TEACHER_NOTE_MAX_LENGTH },
    },
} as const;

function parseTeacherPage(html: string, sourceUrl: string): TeacherProfile {
    const $ = cheerio.load(html);

    // Name from h1.entry-title
    const name = $('h1.entry-title').first().text().trim() || 'Неизвестный преподаватель';

    // Photo — look for the full-size image in lb-overlay, or fallback to lb-album img
    let photoUrl: string | null = null;
    const overlayImg = $('.lb-overlay img').first().attr('src');
    if (overlayImg) {
        photoUrl = overlayImg;
    } else {
        const albumImg = $('.lb-album img').first().attr('src');
        if (albumImg) photoUrl = albumImg;
    }

    // Parse entry-content paragraphs for structured data
    const contentPs = $('.entry-content p');
    const textBlocks: string[] = [];
    contentPs.each((_, el) => {
        const text = $(el).text().trim();
        if (text) textBlocks.push(text);
    });

    // Try to extract structured fields from the text blocks
    let position: string | null = null;
    let degree: string | null = null;
    let department: string | null = null;
    let phone: string | null = null;
    let email: string | null = null;

    const bioLines: string[] = [];

    for (const block of textBlocks) {
        const lower = block.toLowerCase();

        // Position detection
        if (lower.includes('должность') && block.includes('–')) {
            position = block.split('–').slice(1).join('–').trim();
            continue;
        }
        if (!position && (lower.includes('преподаватель') || lower.includes('профессор') || lower.includes('доцент') || lower.includes('ст. преподаватель')) && block.length < 80) {
            position = block;
            continue;
        }

        // Degree detection
        if (lower.includes('ученая степень') || lower.includes('степень/звание')) {
            degree = block.replace(/.*?:/, '').trim();
            continue;
        }
        if (!degree && (lower.includes('магистр') || lower.includes('кандидат') || lower.includes('доктор') || lower.includes('phd')) && block.length < 120) {
            degree = block;
            continue;
        }

        // Department / Faculty
        if (!department && (lower.includes('факультет') || lower.includes('кафедра')) && block.length < 150) {
            department = block;
            continue;
        }

        // Phone
        if (lower.includes('телефон') || lower.includes('тел.') || lower.includes('тел:')) {
            const phoneMatch = block.match(/[\d+][\d\s()-]{6,}/);
            if (phoneMatch) phone = phoneMatch[0].trim();
            continue;
        }

        // Email
        const emailInTag = $('.entry-content a[href^="mailto:"]').first().attr('href');
        if (emailInTag) {
            email = emailInTag.replace('mailto:', '');
        }
        if (!email && (lower.includes('mail') || lower.includes('почт') || lower.includes('@'))) {
            const emailMatch = block.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (emailMatch) email = emailMatch[0];
            continue;
        }

        // Everything else that is long enough is bio
        if (block.length > 50) {
            bioLines.push(block);
        }
    }

    // Fallback email from anchor
    if (!email) {
        const mailAnchor = $('.entry-content a[href^="mailto:"]').first().attr('href');
        if (mailAnchor) email = mailAnchor.replace('mailto:', '');
    }

    const bio = bioLines.length > 0 ? bioLines.slice(0, 3).join('\n\n') : null;

    // Try to enrich faculty/department from the staff JSON DB. The on-page HTML
    // sometimes omits them (older profile pages just dump position + bio), but
    // the staff hierarchy still knows. We only override when the parser
    // produced nothing — page-derived values stay authoritative.
    let faculty: string | null = null;
    const dbHit = findTeacherInDb(name);
    if (dbHit) {
        if (dbHit.faculty) faculty = dbHit.faculty;
        if (!department && dbHit.department) department = dbHit.department;
    }

    return {
        name,
        photoUrl,
        position,
        degree,
        department,
        faculty,
        bio,
        contacts: { phone, email },
        sourceUrl,
    };
}

export async function teacherRoutes(app: FastifyInstance) {
    app.get('/teacher/profile', {
        preHandler: [app.authenticate],
        handler: async (request, reply) => {
            const { url } = request.query as { url?: string };

            if (!url || !url.includes('person.kstu.kz')) {
                return reply.status(400).send({
                    success: false,
                    error: 'Некорректный URL профиля преподавателя',
                });
            }

            // Check cache
            const cached = profileCache.get(url);
            if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
                return reply.send({ success: true, data: cached.data, cached: true });
            }

            try {
                console.log(`[Teacher] Fetching profile: ${url}`);
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                    signal: AbortSignal.timeout(10000),
                });

                if (!response.ok) {
                    return reply.status(502).send({
                        success: false,
                        error: `Сайт person.kstu.kz вернул ошибку: ${response.status}`,
                    });
                }

                const html = await response.text();
                const profile = parseTeacherPage(html, url);

                // Cache it
                profileCache.set(url, { data: profile, fetchedAt: Date.now() });

                return reply.send({ success: true, data: profile, cached: false });
            } catch (error: any) {
                console.error(`[Teacher] Error fetching profile:`, error.message);
                return reply.status(502).send({
                    success: false,
                    error: 'Не удалось загрузить профиль преподавателя',
                });
            }
        },
    });

    app.get('/teacher/ratings/leaderboard', {
        preHandler: [app.authenticate],
        handler: async (request: any, reply) => {
            const rawPeriod = typeof request.query?.period === 'string' ? request.query.period : 'day';
            const period: TeacherLeaderboardPeriod = rawPeriod === 'week' || rawPeriod === 'all' ? rawPeriod : 'day';

            try {
                const data = await getTeacherLeaderboard(request.user.userId, period);
                return { success: true, data };
            } catch (error: any) {
                request.log.warn({ error, userId: request.user.userId }, '[teacher] teacher leaderboard unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher leaderboard is temporarily unavailable',
                });
            }
        },
    });

    app.get('/teacher/ratings/search', {
        preHandler: [app.authenticate],
        handler: async (request: any, reply) => {
            const query = typeof request.query?.q === 'string' ? request.query.q.trim() : '';
            if (query.length < 2) {
                return { success: true, results: [] };
            }

            try {
                const results = await searchTeachers(request.user.userId, query);
                return { success: true, data: { results } };
            } catch (error: any) {
                request.log.warn({ error, userId: request.user.userId }, '[teacher] teacher search unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher search is temporarily unavailable',
                });
            }
        },
    });

    app.post('/teacher/ratings/teachers', {
        preHandler: [app.authenticate],
        schema: { body: teacherCreateBodySchema },
        attachValidation: true,
        handler: async (request: any, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: 'teacher name is too short',
                });
            }
            const userId = request.user.userId as string;
            const rawName = (request.body.name as string);

            // Phase 1 S1: per-user rate limit (3/day) on teacher creation.
            const rate = consumeRateLimit(`teacher-create:${userId}`, 3, 24 * 60 * 60 * 1000);
            if (!rate.allowed) {
                reply.header('Retry-After', String(rate.retryAfterSec));
                return reply.status(429).send({
                    success: false,
                    error: 'Слишком много добавлений преподавателей. Попробуйте позже.',
                    errorCode: 'TEACHER_CREATE_RATE_LIMITED',
                    retryAfterSec: rate.retryAfterSec,
                });
            }

            // Phase 1 S3: name validator + profanity filter (runs BEFORE persistence).
            const validation = validateTeacherName(rawName);
            if (!validation.ok) {
                return reply.status(400).send({
                    success: false,
                    error: 'Некорректное ФИО преподавателя',
                    errorCode: 'TEACHER_NAME_INVALID',
                    reason: validation.reason,
                });
            }

            const name = rawName.trim().replace(/\s+/g, ' ');
            const force = request.body?.force === true;

            // Phase 2: fuzzy cross-check against the user's own cached schedule.
            // Only runs when the staff JSON did NOT recognize the literal text — if it
            // did, that's already the strongest signal we have.
            //
            // Outcomes:
            //  - staff JSON matched     → notInSchedule=false, no suggestion
            //  - fuzzy matched schedule → notInSchedule=false, canonicalSuggestion set
            //                              (and createTeacher marks the entry verified)
            //  - neither matched        → notInSchedule=true, soft warning to UI
            const staffMatched = Boolean(findTeacherInDb(name));
            let notInSchedule = false;
            let canonicalSuggestion: string | null = null;
            let createOptions: { source?: string; forceVerified?: boolean } | undefined;

            if (!staffMatched) {
                let scheduleTeachers: string[] = [];
                try {
                    scheduleTeachers = await getUserScheduleTeachers(userId);
                } catch (error) {
                    // Schedule lookup is non-blocking — fail open if cache is unavailable.
                    request.log.warn({ error, userId }, '[teacher] schedule lookup failed during cross-check');
                }

                if (scheduleTeachers.length > 0) {
                    const fuzzy = fuzzyMatchTeacherName(name, scheduleTeachers);
                    if (fuzzy.matched && fuzzy.canonicalCandidate) {
                        canonicalSuggestion = fuzzy.canonicalCandidate;
                        createOptions = { source: 'schedule-match', forceVerified: true };
                        request.log.info(
                            { userId, input: name, matched: fuzzy.canonicalCandidate, similarity: fuzzy.similarity },
                            '[teacher] schedule fuzzy match',
                        );
                    } else {
                        notInSchedule = true;
                    }
                } else {
                    // No cached schedule at all → can't soft-check. Don't flag.
                    notInSchedule = false;
                }
            }

            // Phase 2: when the input isn't in the user's own schedule and they
            // haven't confirmed with `force`, return 409 so the client can show
            // the soft-warning modal. On `force: true` we proceed and record the
            // override in the audit log. This is intentionally a soft block —
            // never a permanent reject; `force: true` always unblocks.
            if (notInSchedule && !force) {
                logAction(userId, 'teacher_directory_create', name, {
                    result: 'rejected',
                    metadata: { source: 'user', reason: 'not_in_schedule', softBlock: true },
                });
                return reply.status(409).send({
                    success: false,
                    error: 'Этот преподаватель не найден в вашем расписании',
                    errorCode: 'TEACHER_NOT_IN_SCHEDULE',
                    notInSchedule: true,
                    canonicalSuggestion: null,
                });
            }

            try {
                const teacher = await createTeacher(userId, name, createOptions);
                // Phase 1 S2: audit log every successful directory create.
                logAction(userId, 'teacher_directory_create', name, {
                    result: 'success',
                    entityId: teacher.teacherId,
                    metadata: {
                        source: createOptions?.source || 'user',
                        verified: teacher.isVerified,
                        notInSchedule,
                        forced: notInSchedule && force,
                        canonicalSuggestion,
                    },
                });
                return {
                    success: true,
                    data: { teacher },
                    notInSchedule,
                    canonicalSuggestion,
                };
            } catch (error: any) {
                request.log.warn({ error, userId }, '[teacher] create teacher unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher directory is temporarily unavailable',
                });
            }
        },
    });

    app.post('/teacher/ratings/mine', {
        preHandler: [app.authenticate],
        schema: { body: teacherRatingBodySchema },
        attachValidation: true,
        handler: async (request: any, reply) => {
            if (request.validationError) {
                return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid rating payload' });
            }
            const userId = request.user.userId as string;

            // Phase 1 S1: rating rate limit (20/min/user) to dampen spam.
            const rate = consumeRateLimit(`teacher-rate:${userId}`, 20, 60 * 1000);
            if (!rate.allowed) {
                reply.header('Retry-After', String(rate.retryAfterSec));
                return reply.status(429).send({
                    success: false,
                    error: 'Слишком частые оценки. Попробуйте позже.',
                    errorCode: 'TEACHER_RATE_RATE_LIMITED',
                    retryAfterSec: rate.retryAfterSec,
                });
            }

            const teacherId = (request.body.teacherId as string).trim();
            const tier = (request.body.tier as string).trim().toUpperCase();
            const tags = Array.isArray(request.body.tags) ? request.body.tags : [];

            if (!teacherId) {
                return reply.status(400).send({ success: false, error: 'teacherId is required' });
            }

            try {
                const rating = await saveTeacherRating(userId, {
                    teacherId,
                    tier: tier as TeacherTier,
                    tags,
                });
                return { success: true, data: { rating } };
            } catch (error: any) {
                const message = String(error?.message || '');
                if (message.includes('teacher not found')) {
                    return reply.status(404).send({ success: false, error: 'teacher not found' });
                }
                request.log.warn({ error, userId }, '[teacher] save rating unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher ratings are temporarily unavailable',
                });
            }
        },
    });

    // -------------------------------------------------------------------
    // Private Teacher Notes — strictly per-user, never shared.
    // See backend/src/services/teacherNotes.ts and the migration in
    // backend/src/db/postgres.ts (user_teacher_notes table). The route
    // surface is intentionally tiny: read, upsert, delete, and a "mine"
    // listing for the current user. There is NO admin/cross-user read
    // path — note privacy is a hard guarantee of this feature.
    // -------------------------------------------------------------------

    app.get('/teacher/notes/mine', {
        preHandler: [app.authenticate],
        handler: async (request: any, reply) => {
            const userId = request.user.userId as string;
            try {
                const notes = await listMyTeacherNotes(userId);
                return { success: true, data: { notes } };
            } catch (error: any) {
                request.log.warn({ error, userId }, '[teacher] list notes unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher notes are temporarily unavailable',
                });
            }
        },
    });

    app.get('/teacher/:teacherKey/note', {
        preHandler: [app.authenticate],
        schema: { params: teacherNoteParamsSchema },
        handler: async (request: any, reply) => {
            const userId = request.user.userId as string;
            const rawKey = String(request.params?.teacherKey || '');
            const key = normalizeTeacherKey(rawKey);
            if (!key) {
                return reply.status(400).send({ success: false, error: 'invalid teacher key' });
            }
            try {
                const result = await getTeacherNote(userId, key);
                return {
                    success: true,
                    data: {
                        note: result?.note ?? null,
                        updatedAt: result?.updatedAt ?? null,
                    },
                };
            } catch (error: any) {
                request.log.warn({ error, userId }, '[teacher] get note unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher notes are temporarily unavailable',
                });
            }
        },
    });

    app.put('/teacher/:teacherKey/note', {
        preHandler: [app.authenticate],
        schema: { params: teacherNoteParamsSchema, body: teacherNoteBodySchema },
        attachValidation: true,
        handler: async (request: any, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: request.validationError.message || 'invalid note payload',
                });
            }
            const userId = request.user.userId as string;
            const rawKey = String(request.params?.teacherKey || '');
            const key = normalizeTeacherKey(rawKey);
            if (!key) {
                return reply.status(400).send({ success: false, error: 'invalid teacher key' });
            }
            const note = String(request.body?.note ?? '');
            try {
                await setTeacherNote(userId, key, note);
                return reply.status(204).send();
            } catch (error: any) {
                const message = String(error?.message || '');
                if (message.includes('too long')) {
                    return reply.status(400).send({ success: false, error: 'note too long' });
                }
                if (message.includes('storage unavailable')) {
                    request.log.warn({ error, userId }, '[teacher] save note unavailable');
                    return reply.status(503).send({
                        success: false,
                        error: 'teacher notes are temporarily unavailable',
                    });
                }
                request.log.warn({ error, userId }, '[teacher] save note failed');
                return reply.status(400).send({ success: false, error: 'invalid note payload' });
            }
        },
    });

    app.delete('/teacher/:teacherKey/note', {
        preHandler: [app.authenticate],
        schema: { params: teacherNoteParamsSchema },
        handler: async (request: any, reply) => {
            const userId = request.user.userId as string;
            const rawKey = String(request.params?.teacherKey || '');
            const key = normalizeTeacherKey(rawKey);
            if (!key) {
                return reply.status(400).send({ success: false, error: 'invalid teacher key' });
            }
            try {
                await deleteTeacherNote(userId, key);
                return reply.status(204).send();
            } catch (error: any) {
                request.log.warn({ error, userId }, '[teacher] delete note unavailable');
                return reply.status(503).send({
                    success: false,
                    error: 'teacher notes are temporarily unavailable',
                });
            }
        },
    });
}
