/**
 * Group Space — Files & Links resources.
 *
 * Pure CRUD over two registries (`app_group_links`, `app_group_files`) attached
 * to a group. The actual binary upload still goes through the storage abstraction
 * (`backend/src/storage/uploadToStorage`); this module only stores per-group
 * metadata + pointers to existing storage fileIds.
 *
 * Authorization:
 *   - read: any active member or any user with global/group role for the group
 *           (delegated to `assertCanReadGroup` from group-space).
 *   - write/delete: any user with `canManageContent` permission for the group
 *           (delegated to `assertCanManageContent`). This matches the existing
 *           pattern used by posts/tasks/extra-lessons in `group-space.ts`.
 */
import { randomUUID } from 'crypto';
import {
    assertCanManageContent,
    assertCanReadGroup,
    normalizeGroupKey,
    requireGroupSpacePostgres,
} from './group-space.js';

export interface GroupLinkView {
    id: string;
    groupKey: string;
    title: string;
    url: string;
    description: string | null;
    createdBy: string;
    createdAt: Date;
}

export interface GroupFileEntryView {
    id: string;
    groupKey: string;
    fileId: string;
    title: string;
    description: string | null;
    mime: string | null;
    sizeBytes: number | null;
    createdBy: string;
    createdAt: Date;
}

export const MAX_LINK_TITLE_LENGTH = 200;
export const MAX_LINK_URL_LENGTH = 2000;
export const MAX_LINK_DESCRIPTION_LENGTH = 500;
export const MAX_FILE_TITLE_LENGTH = 200;
export const MAX_FILE_DESCRIPTION_LENGTH = 500;
export const MAX_FILE_ID_LENGTH = 200;
export const MAX_FILE_MIME_LENGTH = 200;

/**
 * Strict URL validator: only http/https schemes are allowed; everything else
 * (`javascript:`, `file:`, `data:`, `chrome:`, …) is rejected — the same rule
 * the spec calls out explicitly. Returns the normalized URL string (trimmed)
 * or throws.
 */
export function validateGroupLinkUrl(rawUrl: string): string {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) {
        throw new Error('Link URL is required');
    }
    if (trimmed.length > MAX_LINK_URL_LENGTH) {
        throw new Error('Link URL is too long');
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('Link URL is not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Link URL must use http or https');
    }
    return trimmed;
}

function validateLinkTitle(rawTitle: string): string {
    const trimmed = (rawTitle || '').trim();
    if (!trimmed) {
        throw new Error('Link title is required');
    }
    if (trimmed.length > MAX_LINK_TITLE_LENGTH) {
        throw new Error('Link title is too long');
    }
    return trimmed;
}

function validateLinkDescription(rawDescription: string | null | undefined): string | null {
    if (rawDescription == null) return null;
    const trimmed = String(rawDescription).trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_LINK_DESCRIPTION_LENGTH) {
        throw new Error('Link description is too long');
    }
    return trimmed;
}

function validateFileTitle(rawTitle: string): string {
    const trimmed = (rawTitle || '').trim();
    if (!trimmed) {
        throw new Error('File title is required');
    }
    if (trimmed.length > MAX_FILE_TITLE_LENGTH) {
        throw new Error('File title is too long');
    }
    return trimmed;
}

function validateFileId(rawFileId: string): string {
    const trimmed = (rawFileId || '').trim();
    if (!trimmed) {
        throw new Error('File reference is required');
    }
    if (trimmed.length > MAX_FILE_ID_LENGTH) {
        throw new Error('File reference is too long');
    }
    return trimmed;
}

function validateFileDescription(rawDescription: string | null | undefined): string | null {
    if (rawDescription == null) return null;
    const trimmed = String(rawDescription).trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_FILE_DESCRIPTION_LENGTH) {
        throw new Error('File description is too long');
    }
    return trimmed;
}

function validateFileMime(rawMime: string | null | undefined): string | null {
    if (rawMime == null) return null;
    const trimmed = String(rawMime).trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_FILE_MIME_LENGTH) {
        throw new Error('File MIME type is too long');
    }
    return trimmed;
}

function validateFileSize(rawSize: number | null | undefined): number | null {
    if (rawSize == null) return null;
    const value = Number(rawSize);
    if (!Number.isFinite(value)) {
        throw new Error('File size must be a finite number');
    }
    if (value < 0) {
        throw new Error('File size cannot be negative');
    }
    // Guard against absurd values that would never come from a real upload.
    if (value > Number.MAX_SAFE_INTEGER) {
        throw new Error('File size is too large');
    }
    return Math.floor(value);
}

interface LinkRow {
    id: string;
    group_key: string;
    title: string;
    url: string;
    description: string | null;
    created_by: string;
    created_at: Date;
}

function mapLinkRow(row: LinkRow): GroupLinkView {
    return {
        id: row.id,
        groupKey: row.group_key,
        title: row.title,
        url: row.url,
        description: row.description,
        createdBy: row.created_by,
        createdAt: new Date(row.created_at),
    };
}

interface FileRow {
    id: string;
    group_key: string;
    file_id: string;
    title: string;
    description: string | null;
    mime: string | null;
    size_bytes: string | number | null;
    created_by: string;
    created_at: Date;
}

function mapFileRow(row: FileRow): GroupFileEntryView {
    const size = row.size_bytes == null ? null : Number(row.size_bytes);
    return {
        id: row.id,
        groupKey: row.group_key,
        fileId: row.file_id,
        title: row.title,
        description: row.description,
        mime: row.mime,
        sizeBytes: Number.isFinite(size as number) ? (size as number) : null,
        createdBy: row.created_by,
        createdAt: new Date(row.created_at),
    };
}

export async function listGroupLinks(actorUserId: string, groupKey: string): Promise<GroupLinkView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupLinks', async (client) => {
        const result = await client.query<LinkRow>(
            `
                select id, group_key, title, url, description, created_by, created_at
                from app_group_links
                where group_key = $1
                order by created_at desc
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapLinkRow);
    });
}

export async function addGroupLink(
    groupKey: string,
    params: { title: string; url: string; description?: string | null },
    byUserId: string
): Promise<GroupLinkView> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(byUserId, normalizedGroupKey);

    const title = validateLinkTitle(params.title);
    const url = validateGroupLinkUrl(params.url);
    const description = validateLinkDescription(params.description ?? null);

    return requireGroupSpacePostgres('addGroupLink', async (client) => {
        const id = randomUUID();
        const result = await client.query<LinkRow>(
            `
                insert into app_group_links (id, group_key, title, url, description, created_by, created_at)
                values ($1, $2, $3, $4, $5, $6, now())
                returning id, group_key, title, url, description, created_by, created_at
            `,
            [id, normalizedGroupKey, title, url, description, byUserId]
        );
        return mapLinkRow(result.rows[0]);
    });
}

export async function deleteGroupLink(
    groupKey: string,
    linkId: string,
    byUserId: string
): Promise<boolean> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(byUserId, normalizedGroupKey);

    const trimmedId = (linkId || '').trim();
    if (!trimmedId) {
        throw new Error('linkId is required');
    }

    return requireGroupSpacePostgres('deleteGroupLink', async (client) => {
        const result = await client.query(
            `delete from app_group_links where id = $1 and group_key = $2`,
            [trimmedId, normalizedGroupKey]
        );
        return result.rowCount > 0;
    });
}

export async function listGroupFiles(actorUserId: string, groupKey: string): Promise<GroupFileEntryView[]> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanReadGroup(actorUserId, normalizedGroupKey);

    return requireGroupSpacePostgres('listGroupFiles', async (client) => {
        const result = await client.query<FileRow>(
            `
                select id, group_key, file_id, title, description, mime, size_bytes, created_by, created_at
                from app_group_files
                where group_key = $1
                order by created_at desc
            `,
            [normalizedGroupKey]
        );
        return result.rows.map(mapFileRow);
    });
}

export async function addGroupFile(
    groupKey: string,
    params: {
        title: string;
        fileId: string;
        description?: string | null;
        mime?: string | null;
        sizeBytes?: number | null;
    },
    byUserId: string
): Promise<GroupFileEntryView> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(byUserId, normalizedGroupKey);

    const title = validateFileTitle(params.title);
    const fileId = validateFileId(params.fileId);
    const description = validateFileDescription(params.description ?? null);
    const mime = validateFileMime(params.mime ?? null);
    const sizeBytes = validateFileSize(params.sizeBytes ?? null);

    return requireGroupSpacePostgres('addGroupFile', async (client) => {
        const id = randomUUID();
        const result = await client.query<FileRow>(
            `
                insert into app_group_files (
                    id, group_key, file_id, title, description, mime, size_bytes, created_by, created_at
                )
                values ($1, $2, $3, $4, $5, $6, $7, $8, now())
                returning id, group_key, file_id, title, description, mime, size_bytes, created_by, created_at
            `,
            [id, normalizedGroupKey, fileId, title, description, mime, sizeBytes, byUserId]
        );
        return mapFileRow(result.rows[0]);
    });
}

export async function deleteGroupFile(
    groupKey: string,
    fileEntryId: string,
    byUserId: string
): Promise<boolean> {
    const normalizedGroupKey = normalizeGroupKey(groupKey);
    await assertCanManageContent(byUserId, normalizedGroupKey);

    const trimmedId = (fileEntryId || '').trim();
    if (!trimmedId) {
        throw new Error('fileEntryId is required');
    }

    // NOTE: This only removes the per-group registry entry. The underlying R2
    // binary registered through `uploadToStorage` is intentionally left in
    // place — it may be referenced by other groups or by the dedup index, and
    // removing it here without a refcount sweep could orphan working downloads.
    // A garbage-collection sweep is a separate concern.
    return requireGroupSpacePostgres('deleteGroupFile', async (client) => {
        const result = await client.query(
            `delete from app_group_files where id = $1 and group_key = $2`,
            [trimmedId, normalizedGroupKey]
        );
        return result.rowCount > 0;
    });
}
