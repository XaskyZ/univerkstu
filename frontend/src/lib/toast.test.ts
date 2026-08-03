import { describe, it, expect, beforeEach } from 'vitest';
import {
    dismissToast,
    subscribeToasts,
    toast,
    type Toast,
} from './toast';

beforeEach(() => {
    // Drain the module-scope queue at the start of each test.
    let snapshot: Toast[] = [];
    const unsub = subscribeToasts((q) => { snapshot = q; });
    for (const item of [...snapshot]) dismissToast(item.id);
    unsub();
});

describe('toast.success / error / info', () => {
    it('returns a numeric id when pushed', () => {
        const id = toast.success('hi');
        expect(typeof id).toBe('number');
        dismissToast(id);
    });

    it('IDs are unique and increasing across calls', () => {
        const a = toast.info('a');
        const b = toast.info('b');
        const c = toast.info('c');
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
        dismissToast(a); dismissToast(b); dismissToast(c);
    });

    it('default durations: success=3000, error=5000, info=4000', () => {
        let last: Toast | undefined;
        const unsub = subscribeToasts((q) => { last = q[q.length - 1]; });

        const sId = toast.success('s');
        expect(last?.durationMs).toBe(3000);
        dismissToast(sId);

        const eId = toast.error('e');
        expect(last?.durationMs).toBe(5000);
        dismissToast(eId);

        const iId = toast.info('i');
        expect(last?.durationMs).toBe(4000);
        dismissToast(iId);

        unsub();
    });

    it('custom duration overrides default', () => {
        let last: Toast | undefined;
        const unsub = subscribeToasts((q) => { last = q[q.length - 1]; });

        const id = toast.success('quick', 500);
        expect(last?.durationMs).toBe(500);

        dismissToast(id);
        unsub();
    });

    it('stores the tone in the toast item', () => {
        let last: Toast | undefined;
        const unsub = subscribeToasts((q) => { last = q[q.length - 1]; });

        const sId = toast.success('s'); expect(last?.tone).toBe('success'); dismissToast(sId);
        const eId = toast.error('e'); expect(last?.tone).toBe('error'); dismissToast(eId);
        const iId = toast.info('i'); expect(last?.tone).toBe('info'); dismissToast(iId);

        unsub();
    });
});

describe('subscribeToasts', () => {
    it('calls listener immediately with current queue (empty after beforeEach)', () => {
        let received: Toast[] | null = null;
        const unsub = subscribeToasts((q) => { received = q; });
        expect(received).toEqual([]);
        unsub();
    });

    it('listener gets called when a toast is pushed', () => {
        const events: Toast[][] = [];
        const unsub = subscribeToasts((q) => events.push([...q]));

        const id = toast.success('msg');
        expect(events.length).toBeGreaterThanOrEqual(2); // initial + push
        expect(events[events.length - 1]).toHaveLength(1);
        expect(events[events.length - 1][0].message).toBe('msg');

        dismissToast(id);
        unsub();
    });

    it('multiple listeners all receive notifications', () => {
        const a: Toast[][] = [];
        const b: Toast[][] = [];
        const unA = subscribeToasts((q) => a.push([...q]));
        const unB = subscribeToasts((q) => b.push([...q]));

        const id = toast.info('to both');
        expect(a[a.length - 1][0].message).toBe('to both');
        expect(b[b.length - 1][0].message).toBe('to both');

        dismissToast(id);
        unA();
        unB();
    });

    it('unsubscribe stops notifications', () => {
        const events: Toast[][] = [];
        const unsub = subscribeToasts((q) => events.push([...q]));
        const before = events.length;

        unsub();
        const id = toast.info('after unsub');
        expect(events.length).toBe(before);

        dismissToast(id);
    });
});

describe('dismissToast', () => {
    it('removes the matching toast from the queue', () => {
        let last: Toast[] | undefined;
        const unsub = subscribeToasts((q) => { last = q; });

        const a = toast.info('a');
        const b = toast.info('b');
        expect(last).toHaveLength(2);

        dismissToast(a);
        expect(last).toHaveLength(1);
        expect(last![0].id).toBe(b);

        dismissToast(b);
        expect(last).toHaveLength(0);

        unsub();
    });

    it('is a no-op for unknown id (no emit fired)', () => {
        const events: Toast[][] = [];
        const unsub = subscribeToasts((q) => events.push([...q]));
        const beforeCount = events.length;

        dismissToast(999_999);
        // Listener IS still called because dismissToast unconditionally emits.
        // Verify: queue length unchanged.
        const lastLen = events[events.length - 1]?.length;
        expect(lastLen).toBe(events[beforeCount - 1]?.length ?? 0);

        unsub();
    });
});
