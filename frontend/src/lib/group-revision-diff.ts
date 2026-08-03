import type {
    GroupContentRevisionView,
    GroupContentType,
    GroupExtraLessonView,
    GroupPostView,
    GroupTaskView,
} from './api';
import type { AppLanguage } from './language-context';

type SnapshotRecord = Record<string, unknown>;

export interface RevisionDiffEntry {
    key: string;
    label: string;
    before: string;
    after: string;
}

function getPriorityLabels(language: AppLanguage): Record<string, string> {
    if (language === 'kz') {
        return { low: 'Төмен', medium: 'Орташа', high: 'Жоғары' };
    }
    if (language === 'en') {
        return { low: 'Low', medium: 'Medium', high: 'High' };
    }
    return { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
}

function getFieldConfig(language: AppLanguage): Record<GroupContentType, Array<{ key: string; label: string }>> {
    if (language === 'kz') {
        return {
            post: [
                { key: 'title', label: 'Тақырып' },
                { key: 'body', label: 'Мәтін' },
                { key: 'pinned', label: 'Бекітілген' },
            ],
            task: [
                { key: 'title', label: 'Тақырып' },
                { key: 'subject', label: 'Пән' },
                { key: 'description', label: 'Сипаттама' },
                { key: 'deadline', label: 'Дедлайн' },
                { key: 'priority', label: 'Басымдық' },
                { key: 'completed', label: 'Күйі' },
                { key: 'completedAt', label: 'Жабылған уақыты' },
                { key: 'completedBy', label: 'Жапқан адам' },
            ],
            extra_lesson: [
                { key: 'title', label: 'Атауы' },
                { key: 'date', label: 'Күні' },
                { key: 'startTime', label: 'Басталуы' },
                { key: 'endTime', label: 'Аяқталуы' },
                { key: 'teacher', label: 'Оқытушы' },
                { key: 'room', label: 'Аудитория' },
                { key: 'note', label: 'Ескертпе' },
            ],
        };
    }
    if (language === 'en') {
        return {
            post: [
                { key: 'title', label: 'Title' },
                { key: 'body', label: 'Text' },
                { key: 'pinned', label: 'Pinned' },
            ],
            task: [
                { key: 'title', label: 'Title' },
                { key: 'subject', label: 'Subject' },
                { key: 'description', label: 'Description' },
                { key: 'deadline', label: 'Deadline' },
                { key: 'priority', label: 'Priority' },
                { key: 'completed', label: 'Status' },
                { key: 'completedAt', label: 'Closed at' },
                { key: 'completedBy', label: 'Closed by' },
            ],
            extra_lesson: [
                { key: 'title', label: 'Title' },
                { key: 'date', label: 'Date' },
                { key: 'startTime', label: 'Start' },
                { key: 'endTime', label: 'End' },
                { key: 'teacher', label: 'Teacher' },
                { key: 'room', label: 'Room' },
                { key: 'note', label: 'Note' },
            ],
        };
    }
    return {
        post: [
            { key: 'title', label: 'Заголовок' },
            { key: 'body', label: 'Текст' },
            { key: 'pinned', label: 'Закреп' },
        ],
        task: [
            { key: 'title', label: 'Заголовок' },
            { key: 'subject', label: 'Предмет' },
            { key: 'description', label: 'Описание' },
            { key: 'deadline', label: 'Дедлайн' },
            { key: 'priority', label: 'Приоритет' },
            { key: 'completed', label: 'Статус' },
            { key: 'completedAt', label: 'Закрыто в' },
            { key: 'completedBy', label: 'Закрыл' },
        ],
        extra_lesson: [
            { key: 'title', label: 'Название' },
            { key: 'date', label: 'Дата' },
            { key: 'startTime', label: 'Начало' },
            { key: 'endTime', label: 'Конец' },
            { key: 'teacher', label: 'Преподаватель' },
            { key: 'room', label: 'Аудитория' },
            { key: 'note', label: 'Заметка' },
        ],
    };
}

function getCommonFields(language: AppLanguage) {
    if (language === 'kz') {
        return [
            { key: 'deletedAt', label: 'Жойылған уақыты' },
            { key: 'deletedBy', label: 'Жойған адам' },
        ];
    }
    if (language === 'en') {
        return [
            { key: 'deletedAt', label: 'Deleted at' },
            { key: 'deletedBy', label: 'Deleted by' },
        ];
    }
    return [
        { key: 'deletedAt', label: 'Удалено в' },
        { key: 'deletedBy', label: 'Удалил' },
    ];
}

function formatDateTime(value: string, language: AppLanguage): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const locale = language === 'kz' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU';
    return date.toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDate(value: string, language: AppLanguage): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const locale = language === 'kz' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU';
    return date.toLocaleDateString(locale);
}

function normalizeValue(key: string, value: unknown, language: AppLanguage): string {
    if (value == null || value === '') {
        return '—';
    }

    if (key === 'pinned') {
        if (language === 'kz') return value ? 'Иә' : 'Жоқ';
        if (language === 'en') return value ? 'Yes' : 'No';
        return value ? 'Да' : 'Нет';
    }

    if (key === 'priority' && typeof value === 'string') {
        return getPriorityLabels(language)[value] || value;
    }

    if (key === 'completed') {
        if (language === 'kz') return value ? 'Жабық' : 'Ашық';
        if (language === 'en') return value ? 'Closed' : 'Open';
        return value ? 'Закрыта' : 'Открыта';
    }

    if (key === 'deadline' || key === 'completedAt' || key === 'deletedAt') {
        if (typeof value === 'string') return formatDateTime(value, language);
        if (value instanceof Date) return formatDateTime(value.toISOString(), language);
    }

    if (key === 'date') {
        if (typeof value === 'string') return formatDate(value, language);
        if (value instanceof Date) return formatDate(value.toISOString(), language);
    }

    if (typeof value === 'boolean') {
        if (language === 'kz') return value ? 'Иә' : 'Жоқ';
        if (language === 'en') return value ? 'Yes' : 'No';
        return value ? 'Да' : 'Нет';
    }

    return String(value);
}

function toComparable(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

export function buildCurrentContentSnapshot(
    contentType: GroupContentType,
    entity: GroupPostView | GroupTaskView | GroupExtraLessonView
): SnapshotRecord {
    if (contentType === 'post') {
        const post = entity as GroupPostView;
        return {
            title: post.title,
            body: post.body,
            pinned: post.pinned,
            authorUserId: post.authorUserId,
            deletedAt: post.deletedAt ?? null,
            deletedBy: post.deletedBy ?? null,
        };
    }

    if (contentType === 'task') {
        const task = entity as GroupTaskView;
        return {
            title: task.title,
            subject: task.subject ?? null,
            description: task.description ?? null,
            deadline: task.deadline ?? null,
            priority: task.priority,
            completed: task.completed,
            completedAt: task.completedAt ?? null,
            completedBy: task.completedBy ?? null,
            deletedAt: task.deletedAt ?? null,
            deletedBy: task.deletedBy ?? null,
        };
    }

    const lesson = entity as GroupExtraLessonView;
    return {
        title: lesson.title,
        date: lesson.date,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        room: lesson.room ?? null,
        teacher: lesson.teacher ?? null,
        note: lesson.note ?? null,
        deletedAt: lesson.deletedAt ?? null,
        deletedBy: lesson.deletedBy ?? null,
    };
}

export function buildRevisionDiffEntries(
    contentType: GroupContentType,
    previousSnapshot: SnapshotRecord,
    nextSnapshot: SnapshotRecord,
    language: AppLanguage = 'ru'
): RevisionDiffEntry[] {
    const fieldConfig = [...getFieldConfig(language)[contentType], ...getCommonFields(language)];

    return fieldConfig
        .filter(({ key }) => toComparable(previousSnapshot[key]) !== toComparable(nextSnapshot[key]))
        .map(({ key, label }) => ({
            key,
            label,
            before: normalizeValue(key, previousSnapshot[key], language),
            after: normalizeValue(key, nextSnapshot[key], language),
        }));
}

export function buildRevisionDiffMap(
    contentType: GroupContentType,
    revisions: GroupContentRevisionView[],
    currentSnapshot: SnapshotRecord,
    language: AppLanguage = 'ru'
): Record<string, RevisionDiffEntry[]> {
    const result: Record<string, RevisionDiffEntry[]> = {};

    revisions.forEach((revision, index) => {
        const nextSnapshot = index === 0 ? currentSnapshot : revisions[index - 1]?.snapshot || currentSnapshot;
        result[revision.id] = buildRevisionDiffEntries(contentType, revision.snapshot, nextSnapshot, language);
    });

    return result;
}
