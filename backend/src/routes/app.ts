import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getCacheEntry } from '../db/mongo.js';
import { withSupabasePostgres } from '../db/postgres.js';
import { getAnyExams } from '../services/exams.js';
import { getAnySchedule } from '../services/schedule.js';
import { getUser } from '../services/users.js';
import { findTeacherInDb } from '../utils/teacherMatcher.js';
import type { Schedule } from '../types/index.js';

export type BootstrapFreshness = 'warm' | 'cached' | 'stale' | 'missing';

interface CachedProfilePayload {
    profile?: {
        fullName?: string | null;
        faculty?: string | null;
        specialty?: string | null;
        groupName?: string | null;
        course?: number | null;
        educationLevel?: string | null;
        formOfEducation?: string | null;
        department?: string | null;
        transferGPA?: number | null;
    };
}

interface PlatonusSessionDoc {
    platonusLogin?: string | null;
    createdAt?: Date | null;
    expiresAt?: Date | null;
}

interface PlatonusGradesCacheDoc {
    year?: number | null;
    semester?: number | null;
    cachedAt?: Date | null;
    expiresAt?: Date | null;
    data?: {
        meta?: {
            gpa?: number | null;
            overallGpa?: number | null;
            groupName?: string | null;
        };
    };
}

interface BootstrapPlatonusSemesterDoc {
    year: number;
    semester: number;
    subjectCount: number;
}

async function loadBootstrapPlatonusSummary(userId: string): Promise<{
    session: PlatonusSessionDoc | null;
    latestGrades: PlatonusGradesCacheDoc | null;
    cachedSemesters: BootstrapPlatonusSemesterDoc[];
}> {
    const pgSummary = await withSupabasePostgres(async (client) => {
        const [sessionResult, gradesResult, cachedSemestersResult] = await Promise.all([
            client.query<{
                platonus_login: string | null;
                created_at: Date | null;
                expires_at: Date | null;
            }>(
                `
                    select platonus_login, created_at, expires_at
                    from app_platonus_sessions
                    where user_id = $1
                    limit 1
                `,
                [userId]
            ),
            client.query<{
                year: number | null;
                semester: number | null;
                cached_at: Date | null;
                expires_at: Date | null;
                data_json: {
                    meta?: {
                        gpa?: number | null;
                        overallGpa?: number | null;
                        groupName?: string | null;
                    };
                } | null;
            }>(
                `
                    select year, semester, cached_at, expires_at, data_json
                    from app_platonus_grades_cache
                    where user_id = $1
                    order by cached_at desc
                    limit 1
                `,
                [userId]
            ),
            client.query<{
                year: number;
                semester: number;
                subject_count: number;
            }>(
                `
                    select
                        year,
                        semester,
                        jsonb_array_length(coalesce(data_json->'subjects', '[]'::jsonb)) as subject_count
                    from app_platonus_grades_cache
                    where user_id = $1
                    order by year desc, semester desc
                `,
                [userId]
            ),
        ]);

        const session = sessionResult.rows[0]
            ? {
                platonusLogin: sessionResult.rows[0].platonus_login,
                createdAt: sessionResult.rows[0].created_at,
                expiresAt: sessionResult.rows[0].expires_at,
            }
            : null;

        const latestGrades = gradesResult.rows[0]
            ? {
                year: gradesResult.rows[0].year,
                semester: gradesResult.rows[0].semester,
                cachedAt: gradesResult.rows[0].cached_at,
                expiresAt: gradesResult.rows[0].expires_at,
                data: gradesResult.rows[0].data_json || undefined,
            }
            : null;

        const cachedSemesters = cachedSemestersResult.rows.map((row) => ({
            year: row.year,
            semester: row.semester,
            subjectCount: Number(row.subject_count || 0),
        }));

        return { session, latestGrades, cachedSemesters };
    });

    if (pgSummary === null) {
        throw new Error('[App Bootstrap] Supabase/Postgres is unavailable during platonus summary load');
    }
    return pgSummary;
}

export function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveFreshness(options: {
    cachedAt?: Date | string | null;
    expiresAt?: Date | string | null;
    warmReferenceAt?: Date | string | null;
    allowWarm?: boolean;
}): BootstrapFreshness {
    const cachedAt = toDate(options.cachedAt);
    const expiresAt = toDate(options.expiresAt);
    const warmReferenceAt = toDate(options.warmReferenceAt);
    const now = Date.now();

    if (!cachedAt && !expiresAt) {
        return 'missing';
    }

    if (
        options.allowWarm
        && cachedAt
        && warmReferenceAt
        && cachedAt.getTime() >= warmReferenceAt.getTime() - 30_000
        && now - cachedAt.getTime() <= 5 * 60 * 1000
    ) {
        return 'warm';
    }

    if (expiresAt && expiresAt.getTime() > now) {
        return 'cached';
    }

    return 'stale';
}

function enrichScheduleWithTeacherUrls(schedule: Schedule): Schedule {
    for (const day of schedule.days) {
        for (const slot of day.lessons) {
            for (const lesson of slot) {
                if (lesson.teacher && !lesson.teacherUrl) {
                    const matched = findTeacherInDb(lesson.teacher);
                    if (matched) {
                        lesson.teacherUrl = matched.url;
                        lesson.teacherName = matched.name;
                    }
                }
            }
        }
    }
    return schedule;
}

export async function appRoutes(app: FastifyInstance) {
    app.get('/app/bootstrap', {
        preHandler: [app.authenticate as any],
    }, async (request: FastifyRequest, reply) => {
        const userId = (request.user as { userId: string }).userId;
        const user = await getUser(userId);

        if (!user) {
            return reply.status(404).send({
                success: false,
                error: 'Пользователь не найден',
            });
        }

        const profileKey = `profile_${userId}`;

        const [schedule, exams, profileEntry, platonusSummary] = await Promise.all([
            getAnySchedule(userId),
            getAnyExams(userId),
            getCacheEntry<CachedProfilePayload>(profileKey),
            loadBootstrapPlatonusSummary(userId),
        ]);
        const platonusSession = platonusSummary.session;
        const latestPlatonusGrades = platonusSummary.latestGrades;
        const cachedPlatonusSemesters = platonusSummary.cachedSemesters;

        const scheduleFreshness = resolveFreshness({
            cachedAt: schedule?.cachedAt,
            expiresAt: schedule?.expiresAt,
            warmReferenceAt: user.lastLogin,
            allowWarm: true,
        });
        const examsFreshness = resolveFreshness({
            cachedAt: exams?.cachedAt,
            expiresAt: exams?.expiresAt,
        });
        const profileFreshness = resolveFreshness({
            cachedAt: profileEntry?.createdAt,
            expiresAt: profileEntry?.expiresAt,
        });
        const platonusFreshness = resolveFreshness({
            cachedAt: latestPlatonusGrades?.cachedAt || platonusSession?.createdAt,
            expiresAt: latestPlatonusGrades?.expiresAt || platonusSession?.expiresAt,
        });

        const profile = profileEntry?.data?.profile;
        const profileSummary = profile ? {
            fullName: profile.fullName ?? null,
            faculty: profile.faculty ?? null,
            specialty: profile.specialty ?? null,
            groupName: profile.groupName ?? null,
            course: typeof profile.course === 'number' ? profile.course : null,
            educationLevel: profile.educationLevel ?? null,
            formOfEducation: profile.formOfEducation ?? null,
            department: profile.department ?? null,
            transferGpa: typeof profile.transferGPA === 'number' ? profile.transferGPA : null,
        } : undefined;

        const latestSemester = latestPlatonusGrades?.year && latestPlatonusGrades?.semester
            ? {
                year: latestPlatonusGrades.year,
                semester: latestPlatonusGrades.semester,
            }
            : null;
        const preferredSemesterSource = cachedPlatonusSemesters.find((item) => item.subjectCount > 0)
            || cachedPlatonusSemesters[0]
            || null;
        const preferredSemester = preferredSemesterSource
            ? {
                year: preferredSemesterSource.year,
                semester: preferredSemesterSource.semester,
            }
            : latestSemester;

        return {
            success: true,
            data: {
                version: 1,
                user: {
                    userId,
                },
                schedule: schedule ? enrichScheduleWithTeacherUrls(schedule) : undefined,
                exams: exams || undefined,
                profileSummary,
                platonusSummary: platonusSession || latestPlatonusGrades ? {
                    connected: Boolean(platonusSession),
                    login: platonusSession?.platonusLogin || undefined,
                    gpa: latestPlatonusGrades?.data?.meta?.overallGpa
                        ?? latestPlatonusGrades?.data?.meta?.gpa
                        ?? null,
                    groupName: latestPlatonusGrades?.data?.meta?.groupName || null,
                    latestSemester,
                    preferredSemester,
                    availableSemesters: cachedPlatonusSemesters.map((item) => ({
                        year: item.year,
                        semester: item.semester,
                    })),
                } : undefined,
                freshness: {
                    schedule: scheduleFreshness,
                    exams: examsFreshness,
                    profileSummary: profileFreshness,
                    platonusSummary: platonusFreshness,
                },
                issuedAt: new Date().toISOString(),
            },
        };
    });
}
