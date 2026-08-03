type RateWindow = {
    startMs: number;
    count: number;
    /** Absolute time at which this window stops being relevant (startMs + windowMs). */
    expiresAtMs: number;
};

const windows = new Map<string, RateWindow>();

/**
 * Entries are keyed per user / per IP, so without eviction the map grows for the
 * whole process lifetime — every user who ever hit a rate-limited route stays
 * resident. A window is dead the moment it expires (the next call for that key
 * would reset it anyway), so we sweep expired entries opportunistically from
 * within `consumeRateLimit`. No timer is registered: a background `setInterval`
 * would keep the event loop alive and would have to be torn down in tests.
 */
const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_EVERY_N_CALLS = 500;

let lastSweepMs = 0;
let callsSinceSweep = 0;

function sweepExpired(now: number): void {
    for (const [key, window] of windows) {
        if (window.expiresAtMs <= now) {
            windows.delete(key);
        }
    }
    lastSweepMs = now;
    callsSinceSweep = 0;
}

function maybeSweep(now: number): void {
    callsSinceSweep += 1;
    if (lastSweepMs === 0) {
        lastSweepMs = now;
        return;
    }
    if (callsSinceSweep >= SWEEP_EVERY_N_CALLS || now - lastSweepMs >= SWEEP_INTERVAL_MS) {
        sweepExpired(now);
    }
}

export function consumeRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    maybeSweep(now);
    const existing = windows.get(key);

    if (!existing || now - existing.startMs >= windowMs) {
        windows.set(key, { startMs: now, count: 1, expiresAtMs: now + windowMs });
        return { allowed: true, retryAfterSec: 0 };
    }

    if (existing.count >= maxRequests) {
        const retryAfterMs = Math.max(0, windowMs - (now - existing.startMs));
        return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSec: 0 };
}

/**
 * Number of buckets currently held in memory. Diagnostics / test hook only —
 * callers must not use it to make rate-limiting decisions.
 */
export function rateLimitBucketCount(): number {
    return windows.size;
}

/**
 * Force an immediate eviction pass over expired buckets and report how many
 * remain. Exposed so tests can assert eviction deterministically instead of
 * waiting for the opportunistic sweep heuristics to fire.
 */
export function pruneRateLimitBuckets(now: number = Date.now()): number {
    sweepExpired(now);
    return windows.size;
}

/** Drop every bucket. Test hook — keeps one test file's keys out of another's. */
export function resetRateLimitBuckets(): void {
    windows.clear();
    lastSweepMs = 0;
    callsSinceSweep = 0;
}
