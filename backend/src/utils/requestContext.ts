import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextState {
    reqId: string | null;
    sessionId: string | null;
    routeKind: string | null;
    path: string | null;
    source: 'webapp' | 'direct' | 'unknown' | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContextState>();

export function enterRequestContext(state: RequestContextState): void {
    requestContextStorage.enterWith(state);
}

export function updateRequestContext(partial: Partial<RequestContextState>): void {
    const current = requestContextStorage.getStore();
    if (!current) {
        requestContextStorage.enterWith({
            reqId: partial.reqId ?? null,
            sessionId: partial.sessionId ?? null,
            routeKind: partial.routeKind ?? null,
            path: partial.path ?? null,
            source: partial.source ?? null,
        });
        return;
    }

    requestContextStorage.enterWith({
        ...current,
        ...partial,
    });
}

export function getRequestContext(): RequestContextState | null {
    return requestContextStorage.getStore() || null;
}
