'use client';

import type { PlatonusGradesData } from './api';

export interface GradeSnapshotValue {
    name: string;
    rk1: string;
    rk2: string;
    rating: string;
    exam: string;
    total: string;
}

export interface GradeChange {
    subject: string;
    preview: string;
}

export interface GradeDeltaResult {
    count: number;
    sample: string | null;
    changes: GradeChange[];
}

const GRADE_FIELDS = ['rk1', 'rk2', 'rating', 'exam', 'total'] as const;

type NotificationLang = 'ru' | 'kz' | 'en';

function getNotificationLanguage(): NotificationLang {
    if (typeof window === 'undefined') return 'ru';
    const value = localStorage.getItem('app-language');
    return value === 'kz' || value === 'en' ? value : 'ru';
}

function getNotificationMessages(language: NotificationLang) {
    if (language === 'kz') {
        return {
            labels: { rk1: 'РК1', rk2: 'РК2', rating: 'Рейтинг', exam: 'Емтихан', total: 'Қорытынды' },
            removed: '{label} өшірілді',
            single: 'Жаңа баға: {sample}',
            many: '{count} пән бойынша өзгеріс бар. Мысалы: {sample}',
            title: 'Platonus: жаңа бағалар',
        };
    }

    if (language === 'en') {
        return {
            labels: { rk1: 'RK1', rk2: 'RK2', rating: 'Rating', exam: 'Exam', total: 'Total' },
            removed: '{label} removed',
            single: 'New grade: {sample}',
            many: 'Changes in {count} subjects. For example: {sample}',
            title: 'Platonus: new grades',
        };
    }

    return {
        labels: { rk1: 'РК1', rk2: 'РК2', rating: 'Рейтинг', exam: 'Экзамен', total: 'Итог' },
        removed: '{label} удалена',
        single: 'Новая оценка: {sample}',
        many: 'Изменения по {count} предметам. Например: {sample}',
        title: 'Platonus: новые оценки',
    };
}

function normalizeGradeValue(value?: string): string {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : '-';
}

function serializeSnapshot(snapshot: Record<string, GradeSnapshotValue>): string {
    const sortedEntries = Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(sortedEntries));
}

function parseSnapshot(raw: string | null): Record<string, GradeSnapshotValue> {
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function describeFieldChange(
    field: (typeof GRADE_FIELDS)[number],
    previousValue: string,
    nextValue: string
): string {
    const messages = getNotificationMessages(getNotificationLanguage());
    const label = messages.labels[field];

    if (previousValue === '-' && nextValue !== '-') {
        return `${label}: ${nextValue}`;
    }

    if (previousValue !== '-' && nextValue === '-') {
        return messages.removed.replace('{label}', label);
    }

    return `${label}: ${nextValue}`;
}

export function gradesSnapshotKey(year: number, semester: number, user?: string | null): string {
    const suffix = user ? `_${user}` : '';
    return `platonus_grades_snapshot_${year}_${semester}${suffix}`;
}

export function gradesSeenSnapshotKey(year: number, semester: number, user?: string | null): string {
    const suffix = user ? `_${user}` : '';
    return `platonus_grades_seen_${year}_${semester}${suffix}`;
}

export function gradesNotifiedSnapshotKey(year: number, semester: number, user?: string | null): string {
    const suffix = user ? `_${user}` : '';
    return `platonus_grades_notified_${year}_${semester}${suffix}`;
}

export function buildGradesSnapshot(data: PlatonusGradesData): Record<string, GradeSnapshotValue> {
    const snapshot: Record<string, GradeSnapshotValue> = {};

    data.subjects.forEach((subject) => {
        const key = subject.code || subject.name;
        snapshot[key] = {
            name: subject.name,
            rk1: normalizeGradeValue(subject.rk1),
            rk2: normalizeGradeValue(subject.rk2),
            rating: normalizeGradeValue(subject.rating),
            exam: normalizeGradeValue(subject.exam),
            total: normalizeGradeValue(subject.total),
        };
    });

    return snapshot;
}

export function markGradesAsSeen(
    data: PlatonusGradesData,
    year: number,
    semester: number,
    user?: string | null
): void {
    if (typeof window === 'undefined') return;

    const snapshot = buildGradesSnapshot(data);
    const serialized = serializeSnapshot(snapshot);

    localStorage.setItem(gradesSnapshotKey(year, semester, user), serialized);
    localStorage.setItem(gradesSeenSnapshotKey(year, semester, user), serialized);
    localStorage.setItem(gradesNotifiedSnapshotKey(year, semester, user), serialized);
}

/**
 * «Реальная» ли это опубликованная оценка, о которой стоит слать уведомление.
 * Не начавшийся семестр Platonus размечает заглушками: рейтинг/итог = '0',
 * экзамен = 'недоп.', а неопубликованные РК приходят как '-'. Такие заглушки
 * НЕ должны считаться новой оценкой (иначе прилетает push «оценка 0»).
 *  - '-' / '' / 'недоп.' / прочие блок-маркеры → не реальная оценка;
 *  - РК1/РК2: любое число (включая честный 0 закрытой рубежки) — реальная;
 *  - рейтинг/экзамен/итог: 0 — это заглушка, реальной считается только > 0.
 */
function isRealGradeValue(field: (typeof GRADE_FIELDS)[number], value: string): boolean {
    const v = value.trim().toLowerCase();
    if (!v || v === '-' || v === '—') return false;
    if (v.includes('недоп') || v.includes('жіберілмеген') || v.includes('block')) return false;
    const num = Number.parseFloat(v.replace(',', '.'));
    if (Number.isNaN(num)) return false;
    if (field === 'rk1' || field === 'rk2') return true;
    return num > 0;
}

export function detectGradeChanges(
    previous: Record<string, GradeSnapshotValue>,
    next: Record<string, GradeSnapshotValue>
): GradeDeltaResult {
    const changes: GradeChange[] = [];

    for (const [subjectKey, nextValue] of Object.entries(next)) {
        const previousValue = previous[subjectKey];
        const subjectName = nextValue.name || subjectKey;

        if (!previousValue) {
            const firstVisibleField = GRADE_FIELDS.find((field) => isRealGradeValue(field, nextValue[field]));
            if (firstVisibleField) {
                changes.push({
                    subject: subjectName,
                    preview: describeFieldChange(firstVisibleField, '-', nextValue[firstVisibleField]),
                });
            }
            continue;
        }

        // Уведомляем, если реальная оценка появилась, изменилась или была убрана
        // (реальна новая ИЛИ старая). Переход заглушка→заглушка ('-'→'0' рейтинга)
        // — молчим, иначе прилетает ложная «оценка 0» на не начавшемся семестре.
        const changedField = GRADE_FIELDS.find(
            (field) =>
                previousValue[field] !== nextValue[field]
                && (isRealGradeValue(field, nextValue[field]) || isRealGradeValue(field, previousValue[field]))
        );
        if (changedField) {
            changes.push({
                subject: subjectName,
                preview: describeFieldChange(changedField, previousValue[changedField], nextValue[changedField]),
            });
        }
    }

    return {
        count: changes.length,
        sample: changes[0] ? `${changes[0].subject} — ${changes[0].preview}` : null,
        changes,
    };
}

export function detectAndStoreGradeChanges(
    data: PlatonusGradesData,
    year: number,
    semester: number,
    user?: string | null
): GradeDeltaResult {
    if (typeof window === 'undefined') {
        return { count: 0, sample: null, changes: [] };
    }

    const latestSnapshotKey = gradesSnapshotKey(year, semester, user);
    const seenSnapshotKey = gradesSeenSnapshotKey(year, semester, user);
    const notifiedSnapshotKey = gradesNotifiedSnapshotKey(year, semester, user);
    const seenSnapshot = parseSnapshot(localStorage.getItem(seenSnapshotKey));
    const notifiedSnapshot = parseSnapshot(localStorage.getItem(notifiedSnapshotKey));
    const nextSnapshot = buildGradesSnapshot(data);
    const serializedNextSnapshot = serializeSnapshot(nextSnapshot);
    const hasSeenSnapshot = Object.keys(seenSnapshot).length > 0;
    const hasNotifiedSnapshot = Object.keys(notifiedSnapshot).length > 0;

    localStorage.setItem(latestSnapshotKey, serializedNextSnapshot);

    // Seed baseline on the first ever observation to avoid spamming historical grades.
    if (!hasSeenSnapshot && !hasNotifiedSnapshot) {
        localStorage.setItem(seenSnapshotKey, serializedNextSnapshot);
        localStorage.setItem(notifiedSnapshotKey, serializedNextSnapshot);
        return { count: 0, sample: null, changes: [] };
    }

    const delta = detectGradeChanges(seenSnapshot, nextSnapshot);
    if (delta.count <= 0) {
        localStorage.setItem(notifiedSnapshotKey, serializedNextSnapshot);
        return delta;
    }

    if (hasNotifiedSnapshot && serializeSnapshot(notifiedSnapshot) === serializedNextSnapshot) {
        return { count: 0, sample: null, changes: [] };
    }

    localStorage.setItem(notifiedSnapshotKey, serializedNextSnapshot);
    return delta;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

    try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing?.active) return existing;

        const registered = existing || await navigator.serviceWorker.register('/sw.js');
        if (registered.active) return registered;

        return await navigator.serviceWorker.ready;
    } catch {
        return null;
    }
}

export async function showGradesNotification(delta: GradeDeltaResult, year: number, semester: number): Promise<void> {
    if (typeof window === 'undefined' || delta.count <= 0 || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const messages = getNotificationMessages(getNotificationLanguage());

    const body = delta.count === 1
        ? messages.single.replace('{sample}', String(delta.sample))
        : messages.many.replace('{count}', String(delta.count)).replace('{sample}', String(delta.sample));

    const options: NotificationOptions = {
        body,
        icon: '/android-chrome-192x192.png',
        badge: '/android-chrome-192x192.png',
        tag: `platonus-grades-${year}-${semester}`,
    };

    const registration = await getServiceWorkerRegistration();
    if (registration) {
        try {
            await registration.showNotification(messages.title, options);
            return;
        } catch {
            // fall through to Notification API
        }
    }

    new Notification(messages.title, options);
}
