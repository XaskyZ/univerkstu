/**
 * Exam reminders scheduler — Phase 2 of web-push notifications.
 *
 * Каждые 5 минут проходит по `app_exams_cache`, для каждого экзамена смотрит
 * близость к окнам -1 день / -1 час и пушит уведомление через
 * `services/push.ts`. Журнал отправок (`app_push_sends`) делает идемпотентность.
 *
 * Тайм-зона: KZ = Asia/Almaty, UTC+5, без DST. Все ISO строки из парсера
 * читаются как локальное KZ-время и нормализуются добавлением суффикса `+05:00`.
 *
 * Контракт устойчивости:
 * - Один сбойный пользователь не валит весь цикл.
 * - Если VAPID не сконфигурирован — scheduler стартует, но цикл сразу выходит
 *   с предупреждением (subscription CRUD продолжает работать).
 * - Если postgres недоступен — цикл логирует warning и пропускает тик.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import {
    deleteSubscription,
    getUserSubscriptions,
    hasBeenSent,
    isPushConfigured,
    recordSend,
    sendPushNotification,
    type PushKind,
    type PushPayload,
} from '../services/push.js';
import {
    buildExamReminderBody,
    buildExamReminderTitle,
    type ExamReminderKind,
} from '../services/push-i18n.js';
import {
    DEFAULT_EXAM_REMINDERS,
    type Exam,
    type ExamRemindersSettings,
    type UserSettings,
} from '../types/index.js';

// === Constants ===
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;       // 5 минут
const WARMUP_DELAY_MS = 30_000;                    // 30 секунд после startup
const LOOK_AHEAD_MS = 25 * 60 * 60 * 1000;         // 25 часов (запас за окно 1day)

export const ONE_DAY_TOLERANCE_MS = 5 * 60 * 1000;  // ±5 минут
export const ONE_HOUR_TOLERANCE_MS = 3 * 60 * 1000; // ±3 минуты
const KZ_OFFSET_SUFFIX = '+05:00';

const PUSH_KINDS: readonly ExamReminderKind[] = ['1day', '1hour'] as const;

// === Module state ===
let timer: NodeJS.Timeout | null = null;
let warmupTimer: NodeJS.Timeout | null = null;
let running = false;
let started = false;

// === Pure helpers (exported for tests) ===

/**
 * Детерминированный ID экзамена: sha1(`iso|subject|room`) → первые 16 hex-символов.
 *
 * Берём именно эти три поля: ISO-время + предмет + аудитория — этого достаточно
 * чтобы различить два разных экзамена и стабильно сопоставить один и тот же
 * экзамен между прогонами scheduler-а (даже после ре-парсинга).
 */
export function examIdFromExam(exam: Pick<Exam, 'subject' | 'room' | 'datetime'>): string {
    const iso = exam.datetime?.iso ?? '';
    const subject = exam.subject ?? '';
    const room = exam.room ?? '';
    return createHash('sha1').update(`${iso}|${subject}|${room}`).digest('hex').slice(0, 16);
}

/**
 * Парсинг ISO-строки экзамена как локального KZ-времени.
 *
 * Парсер платонуса отдаёт строки вида `2026-05-20T09:00:00` без TZ-суффикса.
 * KZ = UTC+5 (DST нет), поэтому достаточно дописать `+05:00`.
 * Если строка уже содержит таймзону — оставляем как есть.
 *
 * Возвращает `null` для пустой/мусорной строки, чтобы вызывающий код мог
 * безопасно пропустить экзамен без даты.
 */
export function parseExamUtc(iso: string | null | undefined): Date | null {
    if (!iso || typeof iso !== 'string') return null;
    const trimmed = iso.trim();
    if (!trimmed) return null;

    // Уже есть TZ-суффикс (Z или ±HH:MM)?
    const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
    const normalized = hasTz ? trimmed : `${trimmed}${KZ_OFFSET_SUFFIX}`;

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

/**
 * Проверка попадания `now` в окно срабатывания пуша для конкретного `kind`.
 *
 * Окна:
 *   1day  → 24 часа до экзамена, допуск ±5 минут
 *   1hour → 1 час до экзамена,   допуск ±3 минуты
 */
export function isInWindow(now: Date, examUtc: Date, kind: PushKind): boolean {
    const offsetMs = kind === '1day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    const tolerance = kind === '1day' ? ONE_DAY_TOLERANCE_MS : ONE_HOUR_TOLERANCE_MS;
    const target = examUtc.getTime() - offsetMs;
    return Math.abs(now.getTime() - target) <= tolerance;
}

/**
 * Извлекает настройки уведомлений с дефолтами (всё включено).
 */
export function resolveExamReminders(settings: UserSettings | null | undefined): ExamRemindersSettings {
    return settings?.examReminders ?? DEFAULT_EXAM_REMINDERS;
}

/**
 * Должны ли мы отправлять пуш данного `kind` при текущих настройках юзера?
 */
export function shouldSendForKind(reminders: ExamRemindersSettings, kind: PushKind): boolean {
    if (!reminders.enabled) return false;
    if (kind === '1day') return reminders.oneDay;
    return reminders.oneHour;
}

/**
 * Сборка payload web-push уведомления. Тексты берутся из `services/push-i18n.ts`
 * по `user.settings.language` (ru/kz/en). Неизвестный язык → ru (fallback).
 */
export function buildPayload(
    exam: Pick<Exam, 'subject' | 'room' | 'datetime'>,
    kind: ExamReminderKind,
    examId: string,
    language: UserSettings['language'] = 'ru'
): PushPayload {
    const subject = exam.subject?.trim() || 'Экзамен';
    const time = exam.datetime?.displayTime || exam.datetime?.time || '';
    const room = exam.room?.trim() || '';

    const title = buildExamReminderTitle(kind, language);
    const body = buildExamReminderBody(kind, language, { subject, time, room });

    return {
        title,
        body,
        url: '/exams',
        tag: `exam-${examId}-${kind}`,
    };
}

// === DB helpers ===

interface CacheRow {
    user_id: string;
    data_json: unknown;
}

interface UserSettingsRow {
    user_id: string;
    settings_json: unknown;
}

interface ExamCacheEntry {
    userId: string;
    exams: Exam[];
}

function parseExamsPayload(raw: unknown): Exam[] | null {
    if (!raw || typeof raw !== 'object') return null;
    const exams = (raw as { exams?: unknown }).exams;
    if (!Array.isArray(exams)) return null;
    return exams as Exam[];
}

function parseSettingsJson(raw: unknown): UserSettings | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as UserSettings;
        } catch {
            return null;
        }
    }
    if (typeof raw === 'object') {
        return raw as UserSettings;
    }
    return null;
}

/**
 * Достаёт все пользователи, у которых есть кеш экзаменов с актуальным сроком
 * (cached_at в пределах последних 30 дней — отсекаем явный мусор).
 * Малое окно ограничивает количество строк, которые надо проверять.
 */
async function fetchExamCacheRows(client: PoolClient): Promise<ExamCacheEntry[]> {
    const result = await client.query<CacheRow>(
        `
            select user_id, data_json
            from app_exams_cache
            where cached_at > now() - interval '30 days'
        `
    );

    const entries: ExamCacheEntry[] = [];
    for (const row of result.rows) {
        const exams = parseExamsPayload(row.data_json);
        if (!exams) {
            console.warn(`[ExamReminders] Malformed app_exams_cache row for user, skipping (user_id hash=${hashUserId(row.user_id)})`);
            continue;
        }
        entries.push({ userId: row.user_id, exams });
    }
    return entries;
}

async function fetchUserSettings(client: PoolClient, userIds: string[]): Promise<Map<string, UserSettings | null>> {
    const map = new Map<string, UserSettings | null>();
    if (userIds.length === 0) return map;

    const result = await client.query<UserSettingsRow>(
        `select user_id, settings_json from app_users where user_id = any($1::text[])`,
        [userIds]
    );
    for (const row of result.rows) {
        map.set(row.user_id, parseSettingsJson(row.settings_json));
    }
    return map;
}

/**
 * Короткий хеш userId для логов: не палим логин в логах, но даём корреляцию.
 */
function hashUserId(userId: string): string {
    return createHash('sha1').update(userId).digest('hex').slice(0, 8);
}

// === Main run loop ===

/**
 * Обработка экзаменов одного пользователя. Изолирована в try/catch снаружи —
 * один сбойный пользователь не должен валить весь тик.
 */
async function processUser(
    userId: string,
    exams: Exam[],
    settings: UserSettings | null,
    now: Date
): Promise<void> {
    const reminders = resolveExamReminders(settings);
    if (!reminders.enabled) return;

    const lookAheadCutoff = now.getTime() + LOOK_AHEAD_MS;

    for (const exam of exams) {
        const examUtc = parseExamUtc(exam.datetime?.iso ?? null);
        if (!examUtc) continue;

        // Уже состоялся — пуш бессмыслен.
        if (examUtc.getTime() <= now.getTime()) continue;
        // Слишком далеко — не входит ни в одно окно.
        if (examUtc.getTime() > lookAheadCutoff) continue;

        const examId = examIdFromExam(exam);

        for (const kind of PUSH_KINDS) {
            if (!isInWindow(now, examUtc, kind)) continue;
            if (!shouldSendForKind(reminders, kind)) continue;

            // Идемпотентность: уже отправляли?
            const sentBefore = await hasBeenSent(userId, examId, kind);
            if (sentBefore) continue;

            const subs = await getUserSubscriptions(userId);
            if (subs.length === 0) {
                // Регистрируем "нечего слать" — чтобы не дёргать БД на каждом тике
                // в течение всего окна допуска. Статус отличается от 'sent'.
                await recordSend(userId, examId, kind, 'no_subscriptions');
                continue;
            }

            const payload = buildPayload(
                exam,
                kind,
                examId,
                settings?.language ?? 'ru'
            );

            let anyDelivered = false;
            let anyFailed = false;
            for (const sub of subs) {
                const result = await sendPushNotification(sub, payload);
                if (result.ok) {
                    anyDelivered = true;
                } else if (result.expired) {
                    // Чистим мёртвый endpoint, чтобы он не плодил ошибки.
                    try {
                        await deleteSubscription(userId, sub.endpoint);
                    } catch (cleanupError) {
                        console.warn(
                            `[ExamReminders] Failed to delete expired subscription for user=${hashUserId(userId)}:`,
                            cleanupError instanceof Error ? cleanupError.message : 'unknown'
                        );
                    }
                } else {
                    anyFailed = true;
                }
            }

            const status = anyDelivered ? 'sent' : (anyFailed ? 'failed' : 'expired');
            await recordSend(userId, examId, kind, status);
        }
    }
}

/**
 * Один цикл scheduler-а. Защищён от перекрытия флагом `running`.
 */
async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
        if (!isPushConfigured()) {
            // Тихо — push.ts уже залогировал warning при загрузке модуля.
            return;
        }

        const result = await withSupabasePostgres<{
            entries: ExamCacheEntry[];
            settingsMap: Map<string, UserSettings | null>;
        }>(async (client) => {
            const entries = await fetchExamCacheRows(client);
            const settingsMap = await fetchUserSettings(
                client,
                entries.map((entry) => entry.userId)
            );
            return { entries, settingsMap };
        });

        if (result === null) {
            console.warn('[ExamReminders] Postgres unavailable, skipping cycle');
            return;
        }

        const now = new Date();
        for (const entry of result.entries) {
            try {
                await processUser(
                    entry.userId,
                    entry.exams,
                    result.settingsMap.get(entry.userId) ?? null,
                    now
                );
            } catch (error) {
                console.error(
                    `[ExamReminders] Failed processing user=${hashUserId(entry.userId)}:`,
                    error instanceof Error ? error.message : 'unknown'
                );
            }
        }
    } catch (error) {
        console.error(
            '[ExamReminders] Unhandled cycle error:',
            error instanceof Error ? error.message : 'unknown'
        );
    } finally {
        running = false;
    }
}

// === Public lifecycle ===

export function startExamRemindersScheduler(): void {
    if (started) return;
    started = true;

    if (!isPushConfigured()) {
        console.warn('[ExamReminders] VAPID not configured — scheduler will idle (no sends).');
    }

    // Warmup: первый прогон через 30 секунд (даёт серверу подняться).
    warmupTimer = setTimeout(() => {
        warmupTimer = null;
        void run();
    }, WARMUP_DELAY_MS);

    // Регулярный цикл каждые 5 минут.
    timer = setInterval(() => {
        void run();
    }, SCHEDULER_INTERVAL_MS);
}

export function stopExamRemindersScheduler(): void {
    if (warmupTimer) {
        clearTimeout(warmupTimer);
        warmupTimer = null;
    }
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    started = false;
}

// === Test-only exports ===
// Не помечаем как internal: используются только из exam-reminders.test.ts.
export const __testing = {
    processUser,
    run,
    parseExamsPayload,
    parseSettingsJson,
};
