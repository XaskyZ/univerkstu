/**
 * Subject grade leaderboard API client. Mirrors backend/src/routes/leaderboard.ts.
 */
import { fetchWithAuth, type ApiResponse } from './core';

export interface LeaderboardSubject {
    key: string;
    label: string;
    learners: number;
}

export interface LeaderboardEntry {
    rank: number;
    displayName: string;
    /** Target user id — only used to build the DM contact link, never shown. */
    userId: string;
    isCurrentUser: boolean;
    score: number;
    gpa: number | null;
    letter: string | null;
    year: number;
    semester: number;
    contacts: {
        telegram?: string;
        instagram?: string;
    } | null;
}

export interface SubjectLeaderboard {
    subjectKey: string;
    subjectLabel: string | null;
    entries: LeaderboardEntry[];
    viewerRank: number | null;
    totalRanked: number;
}

/** GET /api/v3/leaderboard/subjects */
export async function listLeaderboardSubjects(): Promise<ApiResponse<{ subjects: LeaderboardSubject[] }>> {
    return fetchWithAuth('/api/v3/leaderboard/subjects');
}

/** GET /api/v3/leaderboard/subject?key=… */
export async function getSubjectLeaderboard(key: string): Promise<ApiResponse<SubjectLeaderboard>> {
    return fetchWithAuth(`/api/v3/leaderboard/subject?key=${encodeURIComponent(key)}`);
}
