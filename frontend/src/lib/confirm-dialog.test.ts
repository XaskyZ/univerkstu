import { describe, it, expect, beforeEach } from 'vitest';
import {
    confirmDialog,
    resetConfirmDialog,
    resolveConfirmDialog,
    subscribeConfirmDialog,
    type ConfirmDialogRequest,
} from './confirm-dialog';

beforeEach(() => {
    // Reset module-scope state by clearing any pending dialog.
    resetConfirmDialog();
});

describe('confirmDialog', () => {
    it('returns a Promise', () => {
        const result = confirmDialog('hi');
        expect(result).toBeInstanceOf(Promise);
        resolveConfirmDialog((global as unknown as { __none: number }).__none ?? 0, false); // no-op, just to silence
        resetConfirmDialog();
    });

    it('subscribers are notified when a dialog opens', () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsubscribe = subscribeConfirmDialog((req) => received.push(req));

        confirmDialog('Are you sure?');
        // First call is the synchronous push of current state, then the dialog opens
        expect(received.length).toBeGreaterThanOrEqual(2);
        const last = received[received.length - 1];
        expect(last?.message).toBe('Are you sure?');

        unsubscribe();
        resetConfirmDialog();
    });

    it('subscribers are notified again when dialog closes', () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsubscribe = subscribeConfirmDialog((req) => received.push(req));

        const promise = confirmDialog('Confirm?');
        const opened = received[received.length - 1];
        expect(opened).not.toBeNull();

        resolveConfirmDialog(opened!.id, true);
        const closed = received[received.length - 1];
        expect(closed).toBeNull();

        unsubscribe();
        return promise.then((value) => expect(value).toBe(true));
    });
});

describe('resolveConfirmDialog', () => {
    it('resolves the pending dialog with true', async () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsub = subscribeConfirmDialog((req) => received.push(req));

        const promise = confirmDialog('Sure?');
        const opened = received[received.length - 1];
        resolveConfirmDialog(opened!.id, true);
        await expect(promise).resolves.toBe(true);
        unsub();
    });

    it('resolves the pending dialog with false', async () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsub = subscribeConfirmDialog((req) => received.push(req));

        const promise = confirmDialog('Sure?');
        const opened = received[received.length - 1];
        resolveConfirmDialog(opened!.id, false);
        await expect(promise).resolves.toBe(false);
        unsub();
    });

    it('is a no-op if the id does not match the current dialog', () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsub = subscribeConfirmDialog((req) => received.push(req));

        confirmDialog('A');
        const opened = received[received.length - 1];
        const before = received.length;
        resolveConfirmDialog(opened!.id + 9999, true); // wrong id
        // No emit happened — listener was not called again
        expect(received.length).toBe(before);
        unsub();
        resetConfirmDialog();
    });
});

describe('overlapping confirmDialog calls', () => {
    it('opening a new dialog auto-resolves the previous one to false', async () => {
        const first = confirmDialog('First?');
        const second = confirmDialog('Second?');

        // First should auto-resolve to false
        await expect(first).resolves.toBe(false);

        // Resolve second by reading current state via subscribe to find its id
        let activeId = -1;
        const unsub = subscribeConfirmDialog((req) => {
            if (req) activeId = req.id;
        });
        resolveConfirmDialog(activeId, true);
        await expect(second).resolves.toBe(true);
        unsub();
    });
});

describe('resetConfirmDialog', () => {
    it('resolves the pending dialog to false and clears state', async () => {
        const promise = confirmDialog('Bye?');
        resetConfirmDialog();
        await expect(promise).resolves.toBe(false);
    });

    it('is a no-op when there is no pending dialog', () => {
        // Should not throw or affect state
        expect(() => resetConfirmDialog()).not.toThrow();
    });
});

describe('subscribeConfirmDialog', () => {
    it('immediately calls the listener with current state', () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsub = subscribeConfirmDialog((req) => received.push(req));
        expect(received).toHaveLength(1);
        expect(received[0]).toBeNull(); // no pending dialog
        unsub();
    });

    it('returns an unsubscribe function that stops notifications', () => {
        const received: Array<ConfirmDialogRequest | null> = [];
        const unsub = subscribeConfirmDialog((req) => received.push(req));
        const before = received.length;

        unsub();
        confirmDialog('after unsub');

        // Listener should not have been called again after unsub
        expect(received.length).toBe(before);
        resetConfirmDialog();
    });

    it('multiple listeners all receive emits', () => {
        const a: Array<ConfirmDialogRequest | null> = [];
        const b: Array<ConfirmDialogRequest | null> = [];
        const unA = subscribeConfirmDialog((r) => a.push(r));
        const unB = subscribeConfirmDialog((r) => b.push(r));

        confirmDialog('to both');
        expect(a[a.length - 1]?.message).toBe('to both');
        expect(b[b.length - 1]?.message).toBe('to both');

        unA();
        unB();
        resetConfirmDialog();
    });
});
