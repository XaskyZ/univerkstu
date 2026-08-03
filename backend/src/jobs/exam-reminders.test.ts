import { describe, it, expect, vi, beforeEach } from 'vitest';

// VAPID env vars BEFORE imports — push.ts читает их на этапе модуля.
vi.hoisted(() => {
    process.env.VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
        || 'BDfWBPyXKtLvDXY3sNGB-N7QbN5y2yj5G3RoMHaG5p3PXrA34CgI60dURm05Eh63qg-Ts7YgL5gxBl4OZmrlQYg';
    process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
        || 'iL66qNlD1q1KhO6Hh5ER_LF6JxhSv2OEt7eDtOcUBek';
    process.env.VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@univerkstu.app';
});

// -- In-memory tables that mimic the slice of Postgres used by the scheduler.
type Row = Record<string, unknown>;

interface CacheEntry {
    user_id: string;
    data_json: { exams: unknown[] };
}

const examsCache: CacheEntry[] = [];
const usersTable = new Map<string, Row>();      // key = user_id → { settings_json }
const subsTable = new Map<string, Row>();       // key = `${user_id}::${endpoint}`
const sendsTable = new Map<string, Row>();      // key = `${user_id}::${exam_id}::${kind}`

const fakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();

        // services/push.ts queries -----------------------------------------
        if (text.startsWith('insert into app_push_subscriptions')) {
            const [userId, endpoint, p256dh, auth, userAgent, now] = params as [
                string, string, string, string, string | null, Date
            ];
            const key = `${userId}::${endpoint}`;
            const existing = subsTable.get(key);
            if (existing) {
                existing.p256dh = p256dh;
                existing.auth = auth;
                existing.user_agent = userAgent ?? existing.user_agent;
                existing.last_seen_at = now;
                return { rows: [existing], rowCount: 1 };
            }
            const row: Row = {
                id: subsTable.size + 1,
                user_id: userId,
                endpoint,
                p256dh,
                auth,
                user_agent: userAgent,
                created_at: now,
                last_seen_at: now,
            };
            subsTable.set(key, row);
            return { rows: [row], rowCount: 1 };
        }
        if (text.startsWith('select id, user_id, endpoint, p256dh, auth, user_agent')) {
            const [userId] = params as [string];
            return {
                rows: Array.from(subsTable.values()).filter((r) => r.user_id === userId),
                rowCount: 0,
            };
        }
        if (text.startsWith('delete from app_push_subscriptions')) {
            const [userId, endpoint] = params as [string, string];
            const had = subsTable.delete(`${userId}::${endpoint}`);
            return { rows: [], rowCount: had ? 1 : 0 };
        }
        if (text.startsWith('insert into app_push_sends')) {
            const [userId, examId, kind, sentAt, status] = params as [
                string, string, string, Date, string
            ];
            const key = `${userId}::${examId}::${kind}`;
            if (sendsTable.has(key)) {
                return { rows: [], rowCount: 0 };
            }
            sendsTable.set(key, { user_id: userId, exam_id: examId, kind, sent_at: sentAt, status });
            return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('select exists(')) {
            const [userId, examId, kind] = params as [string, string, string];
            const exists = sendsTable.has(`${userId}::${examId}::${kind}`);
            return { rows: [{ exists }], rowCount: 1 };
        }

        // scheduler queries ------------------------------------------------
        if (text.startsWith('select user_id, data_json')
            && text.includes('from app_exams_cache')) {
            return { rows: examsCache, rowCount: examsCache.length };
        }
        if (text.startsWith('select user_id, settings_json')
            && text.includes('from app_users')) {
            const [ids] = params as [string[]];
            const rows = ids.map((id) => usersTable.get(id)).filter((row): row is Row => Boolean(row));
            return { rows, rowCount: rows.length };
        }

        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: typeof fakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

const mockSendNotification = vi.fn();
vi.mock('web-push', () => ({
    default: {
        setVapidDetails: vi.fn(),
        sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    },
}));

// ---- Imports must come AFTER mocks. ---------------------------------------
import {
    examIdFromExam,
    parseExamUtc,
    isInWindow,
    resolveExamReminders,
    shouldSendForKind,
    buildPayload,
    ONE_DAY_TOLERANCE_MS,
    ONE_HOUR_TOLERANCE_MS,
    __testing,
} from './exam-reminders.js';
import { DEFAULT_EXAM_REMINDERS } from '../types/index.js';
import { hasBeenSent, upsertSubscription } from '../services/push.js';

// ---- Helpers --------------------------------------------------------------
function makeExam(overrides: Partial<{
    subject: string;
    room: string;
    iso: string;
    displayTime: string;
}> = {}) {
    const iso = overrides.iso ?? '2026-05-20T09:00:00';
    return {
        subject: overrides.subject ?? 'Математика',
        teacher: 'Иванов И.И.',
        type: 'Экзамен',
        format: 'письменный',
        building: 'ГК',
        room: overrides.room ?? '5-208',
        locationRaw: 'ГК 5-208',
        groupType: '',
        datetime: {
            date: iso.slice(0, 10),
            time: iso.slice(11, 16),
            displayDate: iso.slice(0, 10),
            displayTime: overrides.displayTime ?? iso.slice(11, 16),
            iso,
        },
    };
}

beforeEach(() => {
    examsCache.length = 0;
    usersTable.clear();
    subsTable.clear();
    sendsTable.clear();
    mockSendNotification.mockReset();
    fakeClient.query.mockClear();
});

// ============================================================================
describe('examIdFromExam', () => {
    it('is deterministic for the same (iso, subject, room) tuple', () => {
        const exam = makeExam();
        const a = examIdFromExam(exam);
        const b = examIdFromExam(exam);
        expect(a).toBe(b);
    });

    it('returns a 16-char sha1 prefix', () => {
        const id = examIdFromExam(makeExam());
        expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('matches the documented formula sha1(`${iso}|${subject}|${room}`).slice(0, 16)', async () => {
        const { createHash } = await import('node:crypto');
        const exam = makeExam({ iso: '2026-06-01T14:30:00', subject: 'Физика', room: '3-101' });
        const expected = createHash('sha1')
            .update('2026-06-01T14:30:00|Физика|3-101')
            .digest('hex')
            .slice(0, 16);
        expect(examIdFromExam(exam)).toBe(expected);
    });

    it('differs when subject, room, or iso differ', () => {
        const base = examIdFromExam(makeExam());
        expect(examIdFromExam(makeExam({ subject: 'Физика' }))).not.toBe(base);
        expect(examIdFromExam(makeExam({ room: '5-209' }))).not.toBe(base);
        expect(examIdFromExam(makeExam({ iso: '2026-05-20T10:00:00' }))).not.toBe(base);
    });
});

// ============================================================================
describe('parseExamUtc', () => {
    it('treats naive ISO as Asia/Almaty (UTC+5) — pins KZ timezone, no DST', () => {
        // 2026-05-20T09:00 в Алматы (UTC+5) == 2026-05-20T04:00 UTC
        const parsed = parseExamUtc('2026-05-20T09:00:00');
        expect(parsed).not.toBeNull();
        expect(parsed!.toISOString()).toBe('2026-05-20T04:00:00.000Z');
    });

    it('respects existing timezone suffix if present (Z)', () => {
        const parsed = parseExamUtc('2026-05-20T09:00:00Z');
        expect(parsed!.toISOString()).toBe('2026-05-20T09:00:00.000Z');
    });

    it('respects existing timezone suffix if present (+HH:MM)', () => {
        const parsed = parseExamUtc('2026-05-20T09:00:00+03:00');
        expect(parsed!.toISOString()).toBe('2026-05-20T06:00:00.000Z');
    });

    it('returns null for empty / invalid input', () => {
        expect(parseExamUtc('')).toBeNull();
        expect(parseExamUtc(null)).toBeNull();
        expect(parseExamUtc(undefined)).toBeNull();
        expect(parseExamUtc('not-a-date')).toBeNull();
    });
});

// ============================================================================
describe('isInWindow', () => {
    const examUtc = new Date('2026-05-20T04:00:00.000Z');

    it('1day: returns true exactly 24h before exam', () => {
        const now = new Date(examUtc.getTime() - 24 * 60 * 60 * 1000);
        expect(isInWindow(now, examUtc, '1day')).toBe(true);
    });

    it('1day: returns true within ±5 min of target', () => {
        const t = examUtc.getTime() - 24 * 60 * 60 * 1000;
        expect(isInWindow(new Date(t - ONE_DAY_TOLERANCE_MS), examUtc, '1day')).toBe(true);
        expect(isInWindow(new Date(t + ONE_DAY_TOLERANCE_MS), examUtc, '1day')).toBe(true);
    });

    it('1day: returns false just outside ±5 min', () => {
        const t = examUtc.getTime() - 24 * 60 * 60 * 1000;
        expect(isInWindow(new Date(t - ONE_DAY_TOLERANCE_MS - 1_000), examUtc, '1day')).toBe(false);
        expect(isInWindow(new Date(t + ONE_DAY_TOLERANCE_MS + 1_000), examUtc, '1day')).toBe(false);
    });

    it('1hour: returns true exactly 1h before exam', () => {
        const now = new Date(examUtc.getTime() - 60 * 60 * 1000);
        expect(isInWindow(now, examUtc, '1hour')).toBe(true);
    });

    it('1hour: returns true within ±3 min of target', () => {
        const t = examUtc.getTime() - 60 * 60 * 1000;
        expect(isInWindow(new Date(t - ONE_HOUR_TOLERANCE_MS), examUtc, '1hour')).toBe(true);
        expect(isInWindow(new Date(t + ONE_HOUR_TOLERANCE_MS), examUtc, '1hour')).toBe(true);
    });

    it('1hour: returns false just outside ±3 min', () => {
        const t = examUtc.getTime() - 60 * 60 * 1000;
        expect(isInWindow(new Date(t - ONE_HOUR_TOLERANCE_MS - 1_000), examUtc, '1hour')).toBe(false);
        expect(isInWindow(new Date(t + ONE_HOUR_TOLERANCE_MS + 1_000), examUtc, '1hour')).toBe(false);
    });

    it('confirms the documented tolerances (±5min / ±3min)', () => {
        expect(ONE_DAY_TOLERANCE_MS).toBe(5 * 60 * 1000);
        expect(ONE_HOUR_TOLERANCE_MS).toBe(3 * 60 * 1000);
    });
});

// ============================================================================
describe('shouldSendForKind / resolveExamReminders', () => {
    it('defaults all-enabled when settings missing', () => {
        expect(resolveExamReminders(null)).toEqual(DEFAULT_EXAM_REMINDERS);
        expect(resolveExamReminders(undefined)).toEqual(DEFAULT_EXAM_REMINDERS);
        expect(resolveExamReminders({ language: 'ru', notifications: true, theme: 'system' }))
            .toEqual(DEFAULT_EXAM_REMINDERS);
    });

    it('master enabled=false blocks both kinds', () => {
        const r = { enabled: false, oneDay: true, oneHour: true };
        expect(shouldSendForKind(r, '1day')).toBe(false);
        expect(shouldSendForKind(r, '1hour')).toBe(false);
    });

    it('per-kind flags respected when master is on', () => {
        expect(shouldSendForKind({ enabled: true, oneDay: false, oneHour: true }, '1day')).toBe(false);
        expect(shouldSendForKind({ enabled: true, oneDay: true, oneHour: false }, '1hour')).toBe(false);
        expect(shouldSendForKind({ enabled: true, oneDay: true, oneHour: true }, '1day')).toBe(true);
        expect(shouldSendForKind({ enabled: true, oneDay: true, oneHour: true }, '1hour')).toBe(true);
    });
});

// ============================================================================
describe('buildPayload (i18n via services/push-i18n.ts)', () => {
    it('1day payload contains "Завтра" + subject + time + room (default lang=ru)', () => {
        const exam = makeExam({ subject: 'Высшая математика II', room: 'Ауд. 5-208', displayTime: '09:00' });
        const payload = buildPayload(exam, '1day', 'abc123');
        expect(payload.title).toBe('Завтра экзамен');
        expect(payload.body).toContain('Высшая математика II');
        expect(payload.body).toContain('09:00');
        expect(payload.body).toContain('Ауд. 5-208');
        expect(payload.url).toBe('/exams');
        expect(payload.tag).toBe('exam-abc123-1day');
    });

    it('1hour payload contains "Через час" (default lang=ru)', () => {
        const exam = makeExam({ subject: 'Физика', room: '', displayTime: '14:00' });
        const payload = buildPayload(exam, '1hour', 'def456');
        expect(payload.title).toBe('Через час экзамен');
        expect(payload.body).toContain('Физика');
        expect(payload.body).toContain('14:00');
        // Когда room пустой — не добавляем " · ".
        expect(payload.body).not.toContain(' · ');
        expect(payload.tag).toBe('exam-def456-1hour');
    });

    it('uses Kazakh title when user language is kz', () => {
        const exam = makeExam({ subject: 'Математика', room: '5-208', displayTime: '09:00' });
        const payload = buildPayload(exam, '1day', 'kz-tag', 'kz');
        expect(payload.title).toBe('Ертең емтихан');
        expect(payload.body).toContain('ертең сағат 09:00');
    });

    it('uses English title when user language is en', () => {
        const exam = makeExam({ subject: 'Mathematics', room: '5-208', displayTime: '09:00' });
        const payload = buildPayload(exam, '1hour', 'en-tag', 'en');
        expect(payload.title).toBe('Exam in one hour');
        expect(payload.body).toBe('At 09:00 — Mathematics · 5-208');
    });
});

// ============================================================================
describe('processUser', () => {
    it('skips sending when already recorded in app_push_sends', async () => {
        // Готовим экзамен ровно через 24 часа от now.
        const now = new Date('2026-05-19T04:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' }); // UTC=04:00 → +24h от now
        const examId = examIdFromExam(exam);

        // Активная подписка есть.
        await upsertSubscription('alice', {
            endpoint: 'https://fcm.example/alice-1',
            keys: { p256dh: 'P', auth: 'A' },
        });

        // Помечаем как уже отправленный (1day).
        sendsTable.set(`alice::${examId}::1day`, {
            user_id: 'alice',
            exam_id: examId,
            kind: '1day',
            sent_at: now,
            status: 'sent',
        });

        await __testing.processUser('alice', [exam], null, now);

        // hasBeenSent должен был сработать — sendNotification не вызывается.
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('sends push when in 1day window and not previously sent', async () => {
        const now = new Date('2026-05-19T04:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' });

        await upsertSubscription('bob', {
            endpoint: 'https://fcm.example/bob-1',
            keys: { p256dh: 'P', auth: 'A' },
        });
        mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });

        await __testing.processUser('bob', [exam], null, now);

        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        const examId = examIdFromExam(exam);
        expect(await hasBeenSent('bob', examId, '1day')).toBe(true);
    });

    it('skips when master reminders disabled', async () => {
        const now = new Date('2026-05-19T04:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' });
        await upsertSubscription('carol', {
            endpoint: 'https://fcm.example/carol-1',
            keys: { p256dh: 'P', auth: 'A' },
        });

        await __testing.processUser(
            'carol',
            [exam],
            { language: 'ru', notifications: true, theme: 'system',
                examReminders: { enabled: false, oneDay: true, oneHour: true } },
            now
        );

        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('records "no_subscriptions" status when user has no subs', async () => {
        const now = new Date('2026-05-19T04:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' });

        await __testing.processUser('dave', [exam], null, now);

        const examId = examIdFromExam(exam);
        const rec = sendsTable.get(`dave::${examId}::1day`);
        expect(rec).toBeDefined();
        expect((rec as Row).status).toBe('no_subscriptions');
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('deletes subscription when push returns expired (410)', async () => {
        const now = new Date('2026-05-19T04:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' });
        await upsertSubscription('erin', {
            endpoint: 'https://fcm.example/erin-stale',
            keys: { p256dh: 'P', auth: 'A' },
        });
        const err: Error & { statusCode?: number } = new Error('Gone');
        err.statusCode = 410;
        mockSendNotification.mockRejectedValueOnce(err);

        await __testing.processUser('erin', [exam], null, now);

        expect(subsTable.has('erin::https://fcm.example/erin-stale')).toBe(false);
    });

    it('skips past exams (already happened)', async () => {
        const now = new Date('2026-05-21T00:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' });
        await upsertSubscription('frank', {
            endpoint: 'https://fcm.example/frank',
            keys: { p256dh: 'P', auth: 'A' },
        });
        await __testing.processUser('frank', [exam], null, now);
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('skips exams more than 25h ahead', async () => {
        const now = new Date('2026-05-01T00:00:00.000Z');
        const exam = makeExam({ iso: '2026-05-20T09:00:00' });
        await upsertSubscription('grace', {
            endpoint: 'https://fcm.example/grace',
            keys: { p256dh: 'P', auth: 'A' },
        });
        await __testing.processUser('grace', [exam], null, now);
        expect(mockSendNotification).not.toHaveBeenCalled();
    });
});
