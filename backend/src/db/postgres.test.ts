import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    resolveConnectionString,
    summarizePgError,
    isConnectionLevelPostgresError,
} from './postgres.js';

describe('resolveConnectionString', () => {
    // Reads the Supabase Postgres connection URL from env vars in priority order:
    //   SUPABASE_POOLER_URL → SUPABASE_DIRECT_URL → SUPABASE_DATABASE_URL → DATABASE_URL.
    // The order matters: pooler is preferred (PgBouncer connection pooling), direct
    // is the fallback, and DATABASE_URL is the generic last resort for non-Supabase
    // deployments.

    beforeEach(() => {
        vi.stubEnv('SUPABASE_POOLER_URL', '');
        vi.stubEnv('SUPABASE_DIRECT_URL', '');
        vi.stubEnv('SUPABASE_DATABASE_URL', '');
        vi.stubEnv('DATABASE_URL', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns empty string when no env vars are set', () => {
        expect(resolveConnectionString()).toBe('');
    });

    it('SUPABASE_POOLER_URL wins over all others', () => {
        vi.stubEnv('SUPABASE_POOLER_URL', 'postgresql://pooler/db');
        vi.stubEnv('SUPABASE_DIRECT_URL', 'postgresql://direct/db');
        vi.stubEnv('SUPABASE_DATABASE_URL', 'postgresql://supa/db');
        vi.stubEnv('DATABASE_URL', 'postgresql://generic/db');
        expect(resolveConnectionString()).toBe('postgresql://pooler/db');
    });

    it('falls back to SUPABASE_DIRECT_URL when pooler unset', () => {
        vi.stubEnv('SUPABASE_DIRECT_URL', 'postgresql://direct/db');
        vi.stubEnv('SUPABASE_DATABASE_URL', 'postgresql://supa/db');
        expect(resolveConnectionString()).toBe('postgresql://direct/db');
    });

    it('falls back to SUPABASE_DATABASE_URL when pooler+direct unset', () => {
        vi.stubEnv('SUPABASE_DATABASE_URL', 'postgresql://supa/db');
        vi.stubEnv('DATABASE_URL', 'postgresql://generic/db');
        expect(resolveConnectionString()).toBe('postgresql://supa/db');
    });

    it('falls back to DATABASE_URL as last resort', () => {
        vi.stubEnv('DATABASE_URL', 'postgresql://generic/db');
        expect(resolveConnectionString()).toBe('postgresql://generic/db');
    });
});

describe('summarizePgError', () => {
    it('returns error.message for Error instances', () => {
        expect(summarizePgError(new Error('connection refused'))).toBe('connection refused');
    });

    it('returns generic fallback for non-Error inputs', () => {
        expect(summarizePgError(null)).toBe('unknown postgres error');
        expect(summarizePgError(undefined)).toBe('unknown postgres error');
        expect(summarizePgError('plain string')).toBe('unknown postgres error');
        expect(summarizePgError({ message: 'fake error object' })).toBe('unknown postgres error');
        expect(summarizePgError(42)).toBe('unknown postgres error');
    });
});

describe('isConnectionLevelPostgresError', () => {
    // Classifies pg errors as connection-level (temporary, should disable the pool
    // for 15s and retry) vs everything else (treat as permanent). The list of
    // substrings comes from observed real pg errors in production.
    //
    // A regression that DROPS a substring would cause the pool to NOT disable
    // when it should — leading to cascading failures during db hiccups.
    // A regression that ADDS too-broad a pattern would over-eagerly disable on
    // legitimate query errors.

    const connectionLevelSamples = [
        'ECONNREFUSED 127.0.0.1:5432',
        'Connection terminated unexpectedly',
        'timeout expired during query',
        'terminating connection due to administrator command',
        'server closed the connection unexpectedly',
        'getaddrinfo ENOTFOUND db.supabase.co',
        'ENOTFOUND db.supabase.co',
        'connect timeout',
        'connection reset by peer',
        'connection ended unexpectedly',
        'FATAL: the database system is starting up',
        'sorry, too many clients already',
        'cannot connect now',
        'remaining connection slots are reserved for non-replication superuser connections',
    ];

    it.each(connectionLevelSamples)('matches connection-level message: %s', (msg) => {
        expect(isConnectionLevelPostgresError(new Error(msg))).toBe(true);
    });

    it('is case-insensitive (uppercase ECONNREFUSED matches via lowercase substring)', () => {
        expect(isConnectionLevelPostgresError(new Error('ECONNREFUSED'))).toBe(true);
        expect(isConnectionLevelPostgresError(new Error('Connection RESET'))).toBe(true);
    });

    it('returns false for query-level errors (syntax, constraint, etc.)', () => {
        // These are permanent application bugs, not connection issues — pool should
        // NOT disable for them.
        expect(isConnectionLevelPostgresError(new Error('syntax error at or near "SELECT"'))).toBe(false);
        expect(isConnectionLevelPostgresError(new Error('duplicate key value violates unique constraint'))).toBe(false);
        expect(isConnectionLevelPostgresError(new Error('null value in column violates not-null constraint'))).toBe(false);
        expect(isConnectionLevelPostgresError(new Error('relation "users" does not exist'))).toBe(false);
    });

    it('returns false for non-Error input (treated as unknown)', () => {
        expect(isConnectionLevelPostgresError(null)).toBe(false);
        expect(isConnectionLevelPostgresError('connection refused')).toBe(false); // string not Error
        expect(isConnectionLevelPostgresError(42)).toBe(false);
    });

    it('substring match (not exact) — fragment anywhere in message qualifies', () => {
        // Real pg errors often have leading context like "Error in pool: ECONNREFUSED..."
        // — substring match must catch the fragment regardless of position.
        expect(isConnectionLevelPostgresError(new Error('Error in pool query: ECONNREFUSED 5432'))).toBe(true);
    });
});
