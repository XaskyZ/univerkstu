import { describe, it, expect } from 'vitest';
import {
    enterRequestContext,
    getRequestContext,
    updateRequestContext,
    type RequestContextState,
} from './requestContext.js';

const FULL_STATE: RequestContextState = {
    reqId: 'r1',
    sessionId: 'sess-1',
    routeKind: 'auth',
    path: '/api/v3/auth/login',
    source: 'webapp',
};

describe('enterRequestContext', () => {
    it('makes the state visible via getRequestContext within the same async chain', () => {
        enterRequestContext({ ...FULL_STATE });
        expect(getRequestContext()).toEqual(FULL_STATE);
    });

    it('overwrites prior context when called again', () => {
        enterRequestContext({ ...FULL_STATE, reqId: 'first' });
        enterRequestContext({ ...FULL_STATE, reqId: 'second' });
        expect(getRequestContext()?.reqId).toBe('second');
    });
});

describe('updateRequestContext', () => {
    it('merges partial fields into the existing state', () => {
        enterRequestContext({ ...FULL_STATE });
        updateRequestContext({ reqId: 'updated', source: 'direct' });

        const context = getRequestContext();
        expect(context?.reqId).toBe('updated');
        expect(context?.source).toBe('direct');
        // unchanged fields preserved
        expect(context?.sessionId).toBe('sess-1');
        expect(context?.routeKind).toBe('auth');
        expect(context?.path).toBe('/api/v3/auth/login');
    });

    it('creates a fresh state with null defaults when no context exists', async () => {
        // Run inside an isolated async scope so we start without prior context.
        await new Promise<void>((resolve) => {
            queueMicrotask(() => {
                updateRequestContext({ reqId: 'standalone' });
                const context = getRequestContext();
                expect(context).not.toBeNull();
                expect(context?.reqId).toBe('standalone');
                // All other fields default to null
                expect(context?.sessionId).toBeNull();
                expect(context?.routeKind).toBeNull();
                expect(context?.path).toBeNull();
                expect(context?.source).toBeNull();
                resolve();
            });
        });
    });

    it('handles empty partial update by leaving state intact', () => {
        enterRequestContext({ ...FULL_STATE });
        updateRequestContext({});
        expect(getRequestContext()).toEqual(FULL_STATE);
    });
});

describe('getRequestContext null-safety', () => {
    it('returns null in a brand-new async scope', async () => {
        await new Promise<void>((resolve) => {
            queueMicrotask(() => {
                // Fresh microtask — no parent context.
                expect(getRequestContext()).toBeNull();
                resolve();
            });
        });
    });
});
