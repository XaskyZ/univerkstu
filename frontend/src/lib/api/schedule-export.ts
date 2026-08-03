/**
 * Schedule ICS export client helper.
 *
 * The backend serves `/api/v3/schedule/export.ics` as an authenticated
 * `text/calendar` attachment. Auth is JWT-bearer (same as the rest of the
 * app), so we can't just point an `<a href>` at the URL — we have to fetch
 * with the auth header, materialise the body as a Blob, and trigger a
 * download via an in-memory anchor.
 */

import { API_URL, apiText, getToken } from './core';

export interface IcsDownloadResult {
    success: boolean;
    error?: string;
}

export async function downloadScheduleIcs(): Promise<IcsDownloadResult> {
    const text = apiText();
    const token = getToken();
    if (!token) {
        // No way to authenticate this call — surface a friendly error so the
        // UI can keep the button enabled for retry after re-login.
        return { success: false, error: text.serverUnavailableShort };
    }

    try {
        const response = await fetch(`${API_URL}/api/v3/schedule/export.ics`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: text.requestError,
            };
        }

        const blob = await response.blob();
        // Anchor + revokeObjectURL is the standard cross-browser pattern for
        // forcing a download of a Blob (calendar apps then ingest the file).
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'schedule.ics';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        // Tiny delay before revoke so browsers that read the blob lazily still
        // get the bytes; 0 ms is enough because click() is sync.
        setTimeout(() => URL.revokeObjectURL(url), 0);

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: `${text.networkError}: ${error instanceof Error ? error.message : text.unknownError}`,
        };
    }
}
