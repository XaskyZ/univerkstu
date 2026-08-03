/**
 * Unit tests for `canAccessFile` — the single authorization gate behind
 * `GET /api/v3/files/:fileId`, `GET /api/v3/files/:fileId/info` and
 * `GET /api/v3/umkd/exam-questions/:fileId/parsed`.
 *
 * Only the DB boundary is stubbed (`withSupabasePostgres` → in-memory
 * FakeClient, same pattern as group-reactions.test.ts / social-crud.test.ts).
 * The real `assertCanReadGroup` (services/group-space.ts) and the real
 * `assertScopeAccess` (services/social.ts) run against that shim, so the tests
 * exercise the actual membership / scope rules rather than a re-implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- in-memory tables -------------------------------------------------------

interface UmkdFileRow {
    file_id: string;
    uploaded_by: string | null;
    course_id: string | null;
}
interface GroupFileRow { group_key: string; file_id: string }
interface AttachmentRow { file_id: string; scope_type: string; scope_id: string; deleted: boolean }
interface MembershipRow { user_id: string; group_key: string }
interface RoleRow { user_id: string; scope_type: 'global' | 'group'; scope_id: string; role_id: string }

const db = {
    umkdFiles: [] as UmkdFileRow[],
    groupFiles: [] as GroupFileRow[],
    attachments: [] as AttachmentRow[],
    memberships: [] as MembershipRow[],
    roles: [] as RoleRow[],
};

function resetDb() {
    db.umkdFiles = [];
    db.groupFiles = [];
    db.attachments = [];
    db.memberships = [];
    db.roles = [];
}

const fakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase().replace(/\s+/g, ' ');

        // db/gridfs.ts#getFileOwnership
        if (text.includes("metadata_json->>'uploadedby' as uploaded_by")) {
            const [fileId] = params as [string];
            const row = db.umkdFiles.find((f) => f.file_id === fileId);
            return row
                ? { rows: [{ uploaded_by: row.uploaded_by, course_id: row.course_id }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
        }

        // services/file-access.ts#loadGroupKeysForFile
        if (text.includes('from app_group_files')) {
            const [fileId] = params as [string];
            const keys = Array.from(new Set(
                db.groupFiles.filter((r) => r.file_id === fileId).map((r) => r.group_key),
            ));
            return { rows: keys.map((group_key) => ({ group_key })), rowCount: keys.length };
        }

        // services/file-access.ts#loadAttachmentScopesForFile
        if (text.includes('from app_social_attachment a')) {
            const [fileId] = params as [string];
            const rows = db.attachments
                .filter((r) => r.file_id === fileId && !r.deleted)
                .map((r) => ({ scope_type: r.scope_type, scope_id: r.scope_id }));
            return { rows, rowCount: rows.length };
        }

        // services/group-space.ts#hasActiveMembership
        if (text.startsWith('select 1 from app_group_memberships')) {
            const [userId, groupKey] = params as [string, string];
            const hit = db.memberships.some((m) => m.user_id === userId && m.group_key === groupKey);
            return { rows: hit ? [{ '?column?': 1 }] : [], rowCount: hit ? 1 : 0 };
        }

        // services/group-space.ts#getEffectiveAccess
        if (text.includes('from app_group_role_assignments')) {
            const [userId, groupKey] = params as [string, string];
            const rows = db.roles
                .filter((r) => r.user_id === userId && (
                    (r.scope_type === 'global' && r.scope_id === 'global')
                    || (r.scope_type === 'group' && r.scope_id === groupKey)
                ))
                .map((r) => ({ role_id: r.role_id }));
            return { rows, rowCount: rows.length };
        }

        throw new Error(`FakeClient: unexpected query: ${text.slice(0, 120)}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: unknown) => Promise<unknown>) => handler(fakeClient)),
}));

// group-space pulls the Mongo cache helper in for unrelated code paths.
vi.mock('../db/mongo.js', () => ({
    getCachedData: vi.fn(async () => null),
    setCachedData: vi.fn(async () => undefined),
}));

// Link previews would try to fetch remote URLs when social entities are created;
// nothing in these tests creates entities, but the import must stay inert.
vi.mock('./link-previews.js', () => ({
    prefetchLinkPreviewForText: vi.fn(async () => undefined),
}));

const { canAccessFile, isRuntimeUploadCourseId, RUNTIME_UPLOAD_COURSE_ID } = await import('./file-access.js');

// --- fixtures ---------------------------------------------------------------

const UPLOADER = 'student-uploader';
const OUTSIDER = 'student-outsider';
const MEMBER = 'student-member';

/** A runtime upload (POST /files/upload) — access decided by rules 1/3/4. */
function seedRuntimeUpload(fileId: string, uploadedBy: string | null = UPLOADER) {
    db.umkdFiles.push({ file_id: fileId, uploaded_by: uploadedBy, course_id: RUNTIME_UPLOAD_COURSE_ID });
}

/** A UMKD course material file registered by parsers/umkd.ts. */
function seedCourseMaterial(fileId: string, uploadedBy: string | null = UPLOADER) {
    db.umkdFiles.push({ file_id: fileId, uploaded_by: uploadedBy, course_id: 'KURS-1024' });
}

beforeEach(() => {
    resetDb();
    fakeClient.query.mockClear();
});

// --- tests ------------------------------------------------------------------

describe('isRuntimeUploadCourseId', () => {
    it('recognises the runtime-upload sentinel (case/space insensitive)', () => {
        expect(isRuntimeUploadCourseId('social')).toBe(true);
        expect(isRuntimeUploadCourseId(' Social ')).toBe(true);
    });

    it('treats a real course id — and a missing one — as course material', () => {
        expect(isRuntimeUploadCourseId('KURS-1024')).toBe(false);
        expect(isRuntimeUploadCourseId(null)).toBe(false);
        expect(isRuntimeUploadCourseId(undefined)).toBe(false);
    });
});

describe('canAccessFile — preconditions', () => {
    it('refuses an unauthenticated caller without touching the DB', async () => {
        const decision = await canAccessFile('', 'f1');
        expect(decision).toEqual({ allowed: false, reason: 'no_user' });
        expect(fakeClient.query).not.toHaveBeenCalled();
    });

    it('refuses the "anonymous" placeholder the route uses when user is missing', async () => {
        expect(await canAccessFile('anonymous', 'f1')).toEqual({ allowed: false, reason: 'no_user' });
    });

    it('reports file_not_found for an unregistered fileId (route maps it to 404)', async () => {
        expect(await canAccessFile(OUTSIDER, 'nope')).toEqual({ allowed: false, reason: 'file_not_found' });
    });
});

describe('canAccessFile — rule 1: uploader', () => {
    it('lets the uploader download their own runtime upload', async () => {
        seedRuntimeUpload('f-own');
        expect(await canAccessFile(UPLOADER, 'f-own')).toEqual({ allowed: true, reason: 'uploader' });
    });

    it('covers the window between upload and attach (no linkage row yet)', async () => {
        // The frontend uploads first and attaches second; between the two calls
        // there is no app_social_attachment row at all.
        seedRuntimeUpload('f-pending');
        expect(db.attachments).toHaveLength(0);
        expect((await canAccessFile(UPLOADER, 'f-pending')).allowed).toBe(true);
    });

    it('does not leak the same file to an unrelated user', async () => {
        seedRuntimeUpload('f-own');
        expect(await canAccessFile(OUTSIDER, 'f-own')).toEqual({ allowed: false, reason: 'denied' });
    });
});

describe('canAccessFile — rule 2: UMKD course material', () => {
    it('lets any authenticated student download course material they did not upload', async () => {
        // Dedup in uploadToStorage keys on (contentHash, courseId): every student
        // after the first receives the FIRST uploader's fileId.
        seedCourseMaterial('f-lecture');
        expect(await canAccessFile(OUTSIDER, 'f-lecture')).toEqual({ allowed: true, reason: 'course_material' });
    });

    it('treats legacy rows without a courseId as course material too', async () => {
        db.umkdFiles.push({ file_id: 'f-legacy', uploaded_by: null, course_id: null });
        expect((await canAccessFile(OUTSIDER, 'f-legacy')).allowed).toBe(true);
    });

    it('never consults the group / attachment registries for course material', async () => {
        seedCourseMaterial('f-lecture');
        await canAccessFile(OUTSIDER, 'f-lecture');
        const queried = fakeClient.query.mock.calls.map(([sql]) => String(sql));
        expect(queried.some((sql) => sql.includes('app_group_files'))).toBe(false);
        expect(queried.some((sql) => sql.includes('app_social_attachment'))).toBe(false);
    });
});

describe('canAccessFile — rule 3: group file registry', () => {
    beforeEach(() => {
        seedRuntimeUpload('f-group', 'starosta');
        db.groupFiles.push({ group_key: 'ITS-21', file_id: 'f-group' });
    });

    it('allows an active member of the owning group', async () => {
        db.memberships.push({ user_id: MEMBER, group_key: 'ITS-21' });
        expect(await canAccessFile(MEMBER, 'f-group')).toEqual({ allowed: true, reason: 'group_file' });
    });

    it('allows a role holder (curator) without a membership row', async () => {
        db.roles.push({ user_id: 'curator-1', scope_type: 'group', scope_id: 'ITS-21', role_id: 'curator' });
        expect((await canAccessFile('curator-1', 'f-group')).allowed).toBe(true);
    });

    it('denies a non-member — this is the hole S1 closed', async () => {
        expect(await canAccessFile(OUTSIDER, 'f-group')).toEqual({ allowed: false, reason: 'denied' });
    });

    it('denies a member of a DIFFERENT group', async () => {
        db.memberships.push({ user_id: OUTSIDER, group_key: 'MEN-22' });
        expect((await canAccessFile(OUTSIDER, 'f-group')).allowed).toBe(false);
    });

    it('passes when at least one of several owning groups is readable', async () => {
        db.groupFiles.push({ group_key: 'MEN-22', file_id: 'f-group' });
        db.memberships.push({ user_id: MEMBER, group_key: 'MEN-22' });
        expect((await canAccessFile(MEMBER, 'f-group')).allowed).toBe(true);
    });
});

describe('canAccessFile — rule 4: social attachment scope', () => {
    it('allows anyone for a global-scope attachment', async () => {
        seedRuntimeUpload('f-global', 'someone-else');
        db.attachments.push({ file_id: 'f-global', scope_type: 'global', scope_id: 'global:global', deleted: false });
        expect(await canAccessFile(OUTSIDER, 'f-global')).toEqual({ allowed: true, reason: 'social_attachment' });
    });

    it('allows anyone for a board announcement cover image', async () => {
        // Board covers are the first image attachment of an `announcement`
        // entity (services/board.ts#resolveCoverFileIds).
        seedRuntimeUpload('f-cover', 'author-1');
        db.attachments.push({ file_id: 'f-cover', scope_type: 'announcement', scope_id: 'announcement:board', deleted: false });
        expect((await canAccessFile(OUTSIDER, 'f-cover')).allowed).toBe(true);
    });

    it('allows both DM participants and nobody else', async () => {
        seedRuntimeUpload('f-dm', 'alice');
        db.attachments.push({
            file_id: 'f-dm',
            scope_type: 'dm',
            scope_id: 'dm:direct:alice::bob',
            deleted: false,
        });
        expect((await canAccessFile('bob', 'f-dm')).allowed).toBe(true);
        expect(await canAccessFile('eve', 'f-dm')).toEqual({ allowed: false, reason: 'denied' });
    });

    it('follows group scope through assertCanReadGroup', async () => {
        seedRuntimeUpload('f-post', 'starosta');
        db.attachments.push({ file_id: 'f-post', scope_type: 'group', scope_id: 'group:ITS-21', deleted: false });
        expect((await canAccessFile(OUTSIDER, 'f-post')).allowed).toBe(false);
        db.memberships.push({ user_id: MEMBER, group_key: 'ITS-21' });
        expect((await canAccessFile(MEMBER, 'f-post')).allowed).toBe(true);
    });

    it('ignores attachments on soft-deleted entities', async () => {
        seedRuntimeUpload('f-dead', 'author-1');
        db.attachments.push({ file_id: 'f-dead', scope_type: 'global', scope_id: 'global:global', deleted: true });
        expect((await canAccessFile(OUTSIDER, 'f-dead')).allowed).toBe(false);
    });
});

describe('canAccessFile — fail-closed', () => {
    it('propagates a DB outage instead of allowing the download', async () => {
        seedRuntimeUpload('f-group', 'starosta');
        fakeClient.query.mockImplementationOnce(async () => {
            throw new Error('connection terminated');
        });
        await expect(canAccessFile(OUTSIDER, 'f-group')).rejects.toThrow(/connection terminated/);
    });
});
