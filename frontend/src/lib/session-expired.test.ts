import { describe, it, expect, beforeEach } from 'vitest';
import { notifySessionExpired, resetSessionExpiredNotice } from './session-expired';
import { subscribeToasts } from './toast';

/** Read the current toast queue length synchronously. */
function queueLength(): number {
    let len = 0;
    const unsub = subscribeToasts((t) => {
        len = t.length;
    });
    unsub();
    return len;
}

/** Read the most recently pushed toast message. */
function lastMessage(): string {
    let msg = '';
    const unsub = subscribeToasts((t) => {
        msg = t.length > 0 ? t[t.length - 1]!.message : '';
    });
    unsub();
    return msg;
}

describe('notifySessionExpired', () => {
    beforeEach(() => {
        resetSessionExpiredNotice();
    });

    it('pushes a toast in the requested language', () => {
        const before = queueLength();
        notifySessionExpired('en', 1000);
        expect(queueLength()).toBe(before + 1);
        expect(lastMessage().toLowerCase()).toContain('expired');
    });

    it('falls back to Russian for an unknown language', () => {
        notifySessionExpired('xx' as never, 100_000);
        expect(lastMessage()).toContain('Сессия');
    });

    it('dedupes repeated calls inside the window', () => {
        resetSessionExpiredNotice();
        const before = queueLength();
        notifySessionExpired('ru', 1000);
        expect(queueLength()).toBe(before + 1);
        notifySessionExpired('ru', 5000); // within 8s
        expect(queueLength()).toBe(before + 1); // no new toast
    });

    it('shows again once the window has passed', () => {
        resetSessionExpiredNotice();
        const before = queueLength();
        notifySessionExpired('ru', 1000);
        notifySessionExpired('ru', 1000 + 9000); // past the 8s window
        expect(queueLength()).toBe(before + 2);
    });
});
