/**
 * Pure object-diff helper for the Revision History UI.
 *
 * Produces a flat list of `DiffEntry` rows comparing two snapshots from
 * `app_social_revision` (or any two plain objects). Used by the
 * `RevisionHistoryModal` to render "this is what changed between revision N-1
 * and revision N" without coupling the UI to a specific entity kind — every
 * payload shape (post / task / poll / event / ...) goes through the same diff.
 *
 * Strategy:
 *   - Recursive when BOTH sides at a key are plain objects (descend, prefix
 *     the path with `key.subkey`).
 *   - Recursive when BOTH sides at a key are arrays of the same length
 *     (compare pairwise, prefix the path with `key.<index>`).
 *   - Otherwise treat the value as opaque: emit a single `changed` row when
 *     the JSON-serialized form differs, an `added` row when the key is
 *     missing on `before`, a `removed` row when missing on `after`.
 *
 * The comparison is intentionally JSON-string-based for primitives and
 * mismatched complex shapes — this means `null` vs `undefined` collapse, two
 * arrays of different lengths produce a single `changed` row rather than
 * pairwise diffs, and string `"1"` is NOT equal to numeric `1`. Those
 * trade-offs keep the output digestible in the UI; an exhaustive structural
 * diff would explode for nested arrays like `payload.options[]`.
 */

export interface DiffEntry {
    /**
     * Dotted path to the field that changed. Top-level keys are bare (`title`,
     * `body`). Nested keys join with `.` (`options.0.label`,
     * `rsvpStatus.alice`). Use this string both as a `key` for React and as a
     * label-suffix the UI can render next to the change.
     */
    path: string;
    kind: 'added' | 'removed' | 'changed';
    /**
     * The "before" value. `undefined` when the key did not exist on the older
     * snapshot (i.e. `kind === 'added'`).
     */
    before: unknown;
    /**
     * The "after" value. `undefined` when the key was removed (i.e.
     * `kind === 'removed'`).
     */
    after: unknown;
}

/**
 * Pure helper — true when the value is a plain JSON-object-like record. Arrays,
 * `null`, primitives, Dates, and class instances are NOT plain records.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    // Reject Dates and other class instances — they should be compared as
    // opaque scalars (via JSON.stringify) rather than descended into.
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

/**
 * Pure helper — safe JSON serialize used as a deep-equality probe. Returns a
 * stable string for primitives, arrays, and plain records. We intentionally do
 * NOT sort keys: `app_social_revision.snapshot` is the same shape we wrote at
 * insert time, so key order is already stable enough for comparison. Throws
 * are swallowed (circular refs collapse to `undefined`); the caller treats
 * `undefined` as "could not compare", which falls through to the `changed`
 * branch.
 */
function safeJson(value: unknown): string | undefined {
    try { return JSON.stringify(value); } catch { return undefined; }
}

function pathJoin(prefix: string, key: string | number): string {
    return prefix.length === 0 ? String(key) : `${prefix}.${key}`;
}

/**
 * Internal recursion — accumulates rows into `out` so the public entry point
 * can stay a single allocation per call.
 */
function diffRecursive(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    prefix: string,
    out: DiffEntry[],
): void {
    // Union of keys preserves first-seen ordering from `before`, then any keys
    // only present in `after`. This makes the output deterministic for a
    // given pair of inputs.
    const seen = new Set<string>();
    for (const key of Object.keys(before)) {
        seen.add(key);
        const path = pathJoin(prefix, key);
        const beforeVal = before[key];
        if (!(key in after)) {
            out.push({ path, kind: 'removed', before: beforeVal, after: undefined });
            continue;
        }
        const afterVal = after[key];

        if (isPlainRecord(beforeVal) && isPlainRecord(afterVal)) {
            diffRecursive(beforeVal, afterVal, path, out);
            continue;
        }

        if (Array.isArray(beforeVal) && Array.isArray(afterVal) && beforeVal.length === afterVal.length) {
            // Same-length arrays — compare pairwise. We descend into object
            // elements so a label change on `options[2]` produces a single row
            // (`options.2.label`) instead of a chunky array-level diff.
            for (let i = 0; i < beforeVal.length; i++) {
                const b = beforeVal[i];
                const a = afterVal[i];
                const itemPath = pathJoin(path, i);
                if (isPlainRecord(b) && isPlainRecord(a)) {
                    diffRecursive(b, a, itemPath, out);
                } else if (safeJson(b) !== safeJson(a)) {
                    out.push({ path: itemPath, kind: 'changed', before: b, after: a });
                }
            }
            continue;
        }

        if (safeJson(beforeVal) !== safeJson(afterVal)) {
            out.push({ path, kind: 'changed', before: beforeVal, after: afterVal });
        }
    }

    for (const key of Object.keys(after)) {
        if (seen.has(key)) continue;
        const path = pathJoin(prefix, key);
        out.push({ path, kind: 'added', before: undefined, after: after[key] });
    }
}

/**
 * Public entry point — produce a flat ordered list of diff rows between two
 * snapshots. Both arguments must be plain-record-shaped (the social store
 * stores `snapshot` as `jsonb` so this is always true in practice). Returns an
 * empty array when the two sides are deep-equal.
 */
export function diffSnapshots(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): DiffEntry[] {
    const out: DiffEntry[] = [];
    // Defensive: treat non-object inputs as empty so the helper never throws on
    // a malformed historical row.
    const beforeRecord = isPlainRecord(before) ? before : {};
    const afterRecord = isPlainRecord(after) ? after : {};
    diffRecursive(beforeRecord, afterRecord, '', out);
    return out;
}
