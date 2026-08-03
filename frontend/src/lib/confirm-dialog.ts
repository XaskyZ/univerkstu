/**
 * Promise-based confirm dialog. Mount <ConfirmDialogHost /> once in the root
 * layout, then call `confirmDialog(message)` from anywhere to get a Promise<boolean>.
 */

export interface ConfirmDialogOptions {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** When true, paints the confirm button in danger colors. Defaults to true. */
    danger?: boolean;
}

export interface ConfirmDialogRequest {
    id: number;
    message: string;
    options: ConfirmDialogOptions;
    resolve: (value: boolean) => void;
}

type Listener = (request: ConfirmDialogRequest | null) => void;

let nextId = 1;
const listeners = new Set<Listener>();
let current: ConfirmDialogRequest | null = null;

function emit() {
    for (const listener of listeners) listener(current);
}

export function subscribeConfirmDialog(listener: Listener): () => void {
    listeners.add(listener);
    listener(current);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Resolve any pending dialog and clear the queue. Used when the host unmounts.
 */
export function resetConfirmDialog() {
    if (current) {
        current.resolve(false);
        current = null;
        emit();
    }
}

/**
 * Open a themed confirm dialog and resolve with the user's choice.
 * If a dialog is already open, the previous one resolves to `false`.
 */
export function confirmDialog(message: string, options: ConfirmDialogOptions = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        if (current) current.resolve(false);
        current = {
            id: nextId++,
            message,
            options,
            resolve,
        };
        emit();
    });
}

/**
 * Internal: respond to the current dialog and clear it.
 * Called by the host component when the user clicks confirm/cancel.
 */
export function resolveConfirmDialog(id: number, value: boolean) {
    if (!current || current.id !== id) return;
    current.resolve(value);
    current = null;
    emit();
}
