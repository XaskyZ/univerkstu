/**
 * Lightweight toast notifications. Mount <ToastHost /> once in the root layout,
 * then call `toast.success(msg)` / `toast.error(msg)` / `toast.info(msg)` from anywhere.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
    id: number;
    message: string;
    tone: ToastTone;
    /** ms before auto-dismiss. 0 = sticky. */
    durationMs: number;
}

type Listener = (toasts: Toast[]) => void;

let nextId = 1;
const listeners = new Set<Listener>();
let queue: Toast[] = [];

function emit() {
    for (const listener of listeners) listener(queue);
}

export function subscribeToasts(listener: Listener): () => void {
    listeners.add(listener);
    listener(queue);
    return () => {
        listeners.delete(listener);
    };
}

export function dismissToast(id: number) {
    queue = queue.filter((t) => t.id !== id);
    emit();
}

function push(message: string, tone: ToastTone, durationMs = 4000) {
    const item: Toast = { id: nextId++, message, tone, durationMs };
    queue = [...queue, item];
    emit();
    return item.id;
}

export const toast = {
    success(message: string, durationMs?: number) {
        return push(message, 'success', durationMs ?? 3000);
    },
    error(message: string, durationMs?: number) {
        return push(message, 'error', durationMs ?? 5000);
    },
    info(message: string, durationMs?: number) {
        return push(message, 'info', durationMs ?? 4000);
    },
};
