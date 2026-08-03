/**
 * Profile API submodule.
 *
 * Kept as a thin wrapper around `getProfile()` exported from `../api.ts` to
 * avoid duplicating the fetch path. The dedicated submodule exists so feature
 * pages (notably `/profile/history`) can import a strongly-typed
 * `getProfileWithHistory()` without pulling the entire api barrel.
 *
 * If a future caller needs the full `ProfileData` shape with `transcript` and
 * `recbook` typed up-front, prefer this entry point — it returns the same
 * payload `getProfile()` would, but keeps the response type narrowed to the
 * shape consumed by the history screen.
 */
import { getProfile } from '../api';
import type { ApiResponse } from './core';
import type { ProfileData } from '@/app/profile/components/types';

/**
 * Fetches the student profile bundle that includes the `transcript` and
 * `recbook` blocks. The backend already returns them inside `/api/v3/profile`
 * (see `backend/src/routes/profile.ts`) — this helper just narrows the
 * response type so callers don't have to re-type the payload.
 */
export async function getProfileWithHistory(
    refresh = false,
): Promise<ApiResponse<ProfileData>> {
    return getProfile<ProfileData>(refresh);
}
