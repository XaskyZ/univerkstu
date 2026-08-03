import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GroupTaskView } from './api';
import {
    detectAndStoreNewTaskDelta,
    getDeadlineReminderCandidate,
    markDeadlineReminderSent,
} from './group-task-notifications';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let storage: MemoryStorage;

beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('localStorage', storage);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-13T12:00:00Z'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function makeTask(overrides: Partial<GroupTaskView> = {}): GroupTaskView {
    return {
        id: 'task-1',
        groupKey: 'g',
        title: 'Lab 1',
        deadline: null,
        priority: 'medium',
        authorUserId: 'alice',
        completed: false,
        createdAt: '2025-05-01T00:00:00Z',
        updatedAt: '2025-05-01T00:00:00Z',
        ...overrides,
    };
}

describe('detectAndStoreNewTaskDelta', () => {
    it('returns 0 on first observation (seeds baseline)', () => {
        const result = detectAndStoreNewTaskDelta([makeTask()], 'g');
        expect(result.count).toBe(0);
        expect(result.sample).toBeNull();
        expect(storage.getItem('group_task_snapshot_g')).not.toBeNull();
    });

    it('detects newly added active task after baseline', () => {
        detectAndStoreNewTaskDelta([makeTask({ id: 'a' })], 'g');
        const result = detectAndStoreNewTaskDelta([
            makeTask({ id: 'a' }),
            makeTask({ id: 'b', title: 'Lab 2' }),
        ], 'g');
        expect(result.count).toBe(1);
        expect(result.sample?.id).toBe('b');
    });

    it('does not count completed tasks as new', () => {
        detectAndStoreNewTaskDelta([makeTask({ id: 'a' })], 'g');
        const result = detectAndStoreNewTaskDelta([
            makeTask({ id: 'a' }),
            makeTask({ id: 'b', completed: true }),
        ], 'g');
        expect(result.count).toBe(0);
    });

    it('does not count deleted tasks', () => {
        detectAndStoreNewTaskDelta([makeTask({ id: 'a' })], 'g');
        const result = detectAndStoreNewTaskDelta([
            makeTask({ id: 'a' }),
            makeTask({ id: 'b', deletedAt: '2025-05-12T00:00:00Z' }),
        ], 'g');
        expect(result.count).toBe(0);
    });

    it('keeps snapshots user-namespaced', () => {
        detectAndStoreNewTaskDelta([makeTask({ id: 'a' })], 'g', 'alice');
        // Bob never had a baseline — first call seeds his
        const bobFirst = detectAndStoreNewTaskDelta([makeTask({ id: 'x' })], 'g', 'bob');
        expect(bobFirst.count).toBe(0);
        expect(storage.getItem('group_task_snapshot_g_alice')).not.toBeNull();
        expect(storage.getItem('group_task_snapshot_g_bob')).not.toBeNull();
    });

    it('keeps snapshots groupKey-namespaced', () => {
        detectAndStoreNewTaskDelta([makeTask({ id: 'a' })], 'group-1');
        expect(storage.getItem('group_task_snapshot_group-1')).not.toBeNull();
        expect(storage.getItem('group_task_snapshot_group-2')).toBeNull();
    });

    it('reports the first new task as sample, not all', () => {
        detectAndStoreNewTaskDelta([makeTask({ id: 'a' })], 'g');
        const result = detectAndStoreNewTaskDelta([
            makeTask({ id: 'a' }),
            makeTask({ id: 'b', title: 'First new' }),
            makeTask({ id: 'c', title: 'Second new' }),
        ], 'g');
        expect(result.count).toBe(2);
        expect(result.sample?.title).toBe('First new');
    });
});

describe('getDeadlineReminderCandidate', () => {
    function deadlineFromNowMinutes(min: number): string {
        return new Date(Date.now() + min * 60 * 1000).toISOString();
    }

    it('returns null when no tasks have deadlines', () => {
        expect(getDeadlineReminderCandidate([makeTask()], 'g')).toBeNull();
    });

    it('returns null when deadlines are all in the past', () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        expect(getDeadlineReminderCandidate([makeTask({ deadline: past })], 'g')).toBeNull();
    });

    it('returns null when no deadline is within any threshold (60/180/1440 min)', () => {
        const farFuture = deadlineFromNowMinutes(2000); // ~33 hours, past 1440 max
        expect(getDeadlineReminderCandidate([makeTask({ deadline: farFuture })], 'g')).toBeNull();
    });

    it('returns task with 24h (1440) threshold for deadline 20 hours away', () => {
        const due = deadlineFromNowMinutes(20 * 60); // 1200 min
        const result = getDeadlineReminderCandidate([makeTask({ deadline: due })], 'g');
        expect(result?.threshold).toBe(1440);
    });

    it('returns task with 3h (180) threshold for deadline 2 hours away', () => {
        const due = deadlineFromNowMinutes(2 * 60); // 120 min
        const result = getDeadlineReminderCandidate([makeTask({ deadline: due })], 'g');
        expect(result?.threshold).toBe(180);
    });

    it('returns task with 1h (60) threshold for deadline 30 min away', () => {
        const due = deadlineFromNowMinutes(30);
        const result = getDeadlineReminderCandidate([makeTask({ deadline: due })], 'g');
        expect(result?.threshold).toBe(60);
    });

    it('picks the earliest upcoming deadline first', () => {
        const tasks = [
            makeTask({ id: 'late', deadline: deadlineFromNowMinutes(120) }), // 3h tier
            makeTask({ id: 'soon', deadline: deadlineFromNowMinutes(30) }),  // 1h tier
        ];
        const result = getDeadlineReminderCandidate(tasks, 'g');
        expect(result?.task.id).toBe('soon');
    });

    it('skips a deadline already in the notified set', () => {
        const due = deadlineFromNowMinutes(30);
        const task = makeTask({ id: 'a', deadline: due });
        markDeadlineReminderSent('g', task, 60);

        expect(getDeadlineReminderCandidate([task], 'g')).toBeNull();
    });

    it('still alerts when the threshold changes (e.g., 24h alert sent, now within 3h)', () => {
        const due = deadlineFromNowMinutes(120); // 3h tier
        const task = makeTask({ id: 'a', deadline: due });
        // mark 1440 (24h) tier sent — now we want 180 (3h) tier
        markDeadlineReminderSent('g', task, 1440);

        const result = getDeadlineReminderCandidate([task], 'g');
        expect(result?.threshold).toBe(180);
    });

    it('skips deleted and completed tasks even when deadline is near', () => {
        const due = deadlineFromNowMinutes(30);
        const tasks = [
            makeTask({ id: 'del', deadline: due, deletedAt: '2025-01-01T00:00:00Z' }),
            makeTask({ id: 'done', deadline: due, completed: true }),
        ];
        expect(getDeadlineReminderCandidate(tasks, 'g')).toBeNull();
    });

    it('handles malformed reminder set (corrupt JSON) gracefully', () => {
        storage.setItem('group_task_deadline_notifications_g', 'not-json{{');
        const due = deadlineFromNowMinutes(30);
        const result = getDeadlineReminderCandidate([makeTask({ deadline: due })], 'g');
        // Should not throw — treat as empty set and return candidate
        expect(result?.threshold).toBe(60);
    });
});

describe('markDeadlineReminderSent', () => {
    it('adds a reminder id to the set in localStorage', () => {
        const task = makeTask({ id: 'x', deadline: '2025-06-01T00:00:00Z' });
        markDeadlineReminderSent('g', task, 60);
        const raw = storage.getItem('group_task_deadline_notifications_g');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        expect(parsed).toContain('x:2025-06-01T00:00:00Z:60');
    });

    it('appends rather than replaces existing entries', () => {
        const a = makeTask({ id: 'a', deadline: '2025-06-01T00:00:00Z' });
        const b = makeTask({ id: 'b', deadline: '2025-06-02T00:00:00Z' });
        markDeadlineReminderSent('g', a, 60);
        markDeadlineReminderSent('g', b, 60);
        const parsed = JSON.parse(storage.getItem('group_task_deadline_notifications_g')!);
        expect(parsed).toHaveLength(2);
    });

    it('user-namespaces the reminder set', () => {
        const task = makeTask({ id: 'x', deadline: '2025-06-01T00:00:00Z' });
        markDeadlineReminderSent('g', task, 60, 'alice');
        expect(storage.getItem('group_task_deadline_notifications_g_alice')).not.toBeNull();
        expect(storage.getItem('group_task_deadline_notifications_g')).toBeNull();
    });
});
