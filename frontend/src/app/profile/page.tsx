'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
    getActiveLeaderboard,
    getFriendOverview,
    getProfile,
    getReferralOverview,
    getSupportOverview,
    type ActiveLeaderboardData,
    type FriendView,
    type ReferralOverview,
    type SupporterSummary,
} from '@/lib/api';
import { getFromCache, saveToCache, CacheKeys } from '@/lib/cache';
import { getCurrentAcademicSemesterFromDate } from '@/lib/platonus-semesters';
import { toUserErrorMessage } from '@/lib/error-utils';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { shouldSkipBootstrapRevalidate } from '@/lib/startup-bootstrap';
import { ProfileHero } from './components/ProfileHero';
import { ProfileFetchingState, ProfileErrorState } from './components/ProfileStates';
import { ProfileRanksCard } from './components/ProfileRanksCard';
import { ProfileActionsCard } from './components/ProfileActionsCard';
import { ProfileFriendsStrip } from './components/ProfileFriendsStrip';
import { ProfileMentorCard } from './components/ProfileMentorCard';
import { ProfileQuestionnaireAccordion } from './components/ProfileQuestionnaireAccordion';
import { ProfileHistoryLinkCard } from './components/ProfileHistoryLinkCard';
import { getReferralBadgeTier } from '@/lib/referral-rewards';
import { AvatarCropModal } from './components/AvatarCropModal';
import type { ProfileData } from './components/types';
import { loadImage } from '@/lib/avatar-crop';
import { readFeatureFlag } from '@/lib/feature-flags';
import {
    getSocialFriends,
    type SocialFriend,
} from '@/lib/api/social-friends';
import { socialFriendToFriendView } from '@/app/chat/hooks/useSocialFriends';

export default function ProfilePage() {
    const { isAuth, loading, userId, logout } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const [data, setData] = useState<ProfileData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [customAvatar, setCustomAvatar] = useState<string | null>(null);
    const [cropSource, setCropSource] = useState<string | null>(null);
    const [cropModalOpen, setCropModalOpen] = useState(false);
    const [platonusGpa, setPlatonusGpa] = useState<number | null>(null);
    const [platonusGroup, setPlatonusGroup] = useState<string | null>(null);
    const [supporter, setSupporter] = useState<SupporterSummary | null>(null);
    const [referralOverview, setReferralOverview] = useState<ReferralOverview | null>(null);
    const [activityLeaderboard, setActivityLeaderboard] = useState<ActiveLeaderboardData | null>(null);
    const [friendsList, setFriendsList] = useState<FriendView[] | null>(null);
    // Granular per-side-load flags. Each card can stop showing its skeleton
    // independently — progressive reveal feels nicer than gating all four
    // cards on a single "secondaryLoading" flag.
    const [supportLoading, setSupportLoading] = useState(true);
    const [referralLoading, setReferralLoading] = useState(true);
    const [leaderboardLoading, setLeaderboardLoading] = useState(true);
    const [friendsLoading, setFriendsLoading] = useState(true);
    const [hasHydratedCache, setHasHydratedCache] = useState(false);
    const [hadCachedProfile, setHadCachedProfile] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Проверка авторизации
    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const fetchProfile = useCallback(async (refresh = false, hasCachedData = false) => {
        if (refresh) {
            setRefreshing(true);
        } else {
            setFetching(true);
        }
        setError(null);

        const result = await getProfile<ProfileData>(refresh);

        if (result.success && result.data) {
            setData(result.data);
            saveToCache(CacheKeys.PROFILE, result.data);
        } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
            if (!hasCachedData) {
                await logout('expired');
                router.push('/');
                return;
            }
        } else if (!hasCachedData) {
            // Ошибку показываем только если нет старых данных
            setError(toUserErrorMessage({
                error: result.error,
                statusCode: result.statusCode,
                errorCode: result.errorCode,
                fallback: messages.profile.fallbackLoadError,
                language,
            }));
        }

        setFetching(false);
        setRefreshing(false);
    }, [language, logout, messages.profile.fallbackLoadError, router]);

    // Гидратация кеша на клиенте (избегаем hydration mismatch)
    useEffect(() => {
        if (!isAuth) return;

        const timer = window.setTimeout(() => {
            const cachedProfile = getFromCache<ProfileData>(CacheKeys.PROFILE);
            const hasCachedData = Boolean(cachedProfile);

            if (cachedProfile) {
                setData(cachedProfile);
                setFetching(false);
            }

            const cachedPlatonusGpa = getFromCache<{ gpa: number; updatedAt: string }>(CacheKeys.PLATONUS_GPA);
            setPlatonusGpa(cachedPlatonusGpa?.gpa ?? null);
            const cachedPlatonusGroup = getFromCache<{ groupName: string; updatedAt: string }>(CacheKeys.PLATONUS_GROUP);
            setPlatonusGroup(cachedPlatonusGroup?.groupName ?? null);

            const resolvedUserId = userId || localStorage.getItem('userId');
            if (resolvedUserId) {
                setCustomAvatar(localStorage.getItem(`profile-avatar:${resolvedUserId}`));
            }

            setHadCachedProfile(hasCachedData);
            setHasHydratedCache(true);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [isAuth, userId]);

    // Загрузка профиля с кешированием
    useEffect(() => {
        if (!isAuth || !hasHydratedCache) return;

        const deferImmediateFetch = hadCachedProfile && shouldSkipBootstrapRevalidate('profileSummary');
        const timer = window.setTimeout(() => {
            void fetchProfile(!hadCachedProfile, hadCachedProfile);
        }, deferImmediateFetch ? 18_000 : 0);

        return () => window.clearTimeout(timer);
    }, [isAuth, fetchProfile, hasHydratedCache, hadCachedProfile]);

    // 4 parallel side-loads — supporter/referrals/activity-rank/friends.
    // Kept separate from the main profile fetch so a single failing endpoint
    // never blocks the others, and so each can populate its card the moment
    // it resolves (no shared "all-or-nothing" loading state).
    //
    // Each fetch flips its own loading flag the moment it settles, so the
    // corresponding card swaps skeleton → real content independently. This
    // gives a progressive reveal rather than a synchronized pop-in.
    useEffect(() => {
        let cancelled = false;
        if (!isAuth) return;

        void getSupportOverview().then((result) => {
            if (cancelled) return;
            if (result.success && result.data) {
                setSupporter(result.data.supporter);
            }
            setSupportLoading(false);
        });

        void getReferralOverview().then((result) => {
            if (cancelled) return;
            if (result.success && result.data) {
                setReferralOverview(result.data);
            }
            setReferralLoading(false);
        });

        void getActiveLeaderboard('all').then((result) => {
            if (cancelled) return;
            if (result.success && result.data) {
                setActivityLeaderboard(result.data);
            }
            setLeaderboardLoading(false);
        });

        // Phase 1c friends-migration: when the `socialFeedBeta` flag is on,
        // read friendships from the universal `/api/v3/social/friends/me`
        // surface and adapt to the legacy `FriendView` shape so the strip
        // UI keeps rendering unchanged. Off-flag uses the legacy
        // `/api/v3/chat/friends` aggregate as before.
        const useSocialFriendsRead = readFeatureFlag('socialFeedBeta') && Boolean(userId);
        if (useSocialFriendsRead) {
            void getSocialFriends().then((result) => {
                if (cancelled) return;
                if (result.success && result.data) {
                    const adapted = (result.data.friends as SocialFriend[]).map((f) =>
                        socialFriendToFriendView(userId as string, f),
                    );
                    setFriendsList(adapted);
                } else {
                    setFriendsList([]);
                }
                setFriendsLoading(false);
            });
        } else {
            void getFriendOverview().then((result) => {
                if (cancelled) return;
                if (result.success && result.data) {
                    setFriendsList(result.data.friends);
                } else {
                    setFriendsList([]);
                }
                setFriendsLoading(false);
            });
        }

        return () => {
            cancelled = true;
        };
        // userId is read inside the social-friends adapter when the
        // `socialFeedBeta` flag is on — include it in the deps so the
        // effect re-runs when the auth context lands.
    }, [isAuth, userId]);

    const onSelectAvatar = () => {
        fileInputRef.current?.click();
    };

    const onAvatarFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !userId) return;

        if (!file.type.startsWith('image/')) {
            toast.error(messages.profile.selectImage);
            e.target.value = '';
            return;
        }

        e.target.value = '';

        try {
            const imageSource = await loadImage(file);
            setCropSource(imageSource);
            setCropModalOpen(true);
        } catch {
            toast.error(messages.profile.readImageFailed);
        }
    };

    const handleCropCancel = () => {
        setCropModalOpen(false);
        setCropSource(null);
    };

    const handleCropConfirm = (croppedDataUrl: string) => {
        if (!userId) return;
        try {
            localStorage.setItem(`profile-avatar:${userId}`, croppedDataUrl);
            setCustomAvatar(croppedDataUrl);
            window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { userId, avatar: croppedDataUrl } }));
            setCropModalOpen(false);
            setCropSource(null);
        } catch {
            toast.error(messages.profile.fileTooLarge);
        }
    };

    const removeCustomAvatar = () => {
        if (!userId) return;
        localStorage.removeItem(`profile-avatar:${userId}`);
        setCustomAvatar(null);
        window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { userId, avatar: null } }));
    };

    // Удобные геттеры
    const profile = data?.profile;
    const attestation = data?.attestation;
    const advisor = data?.advisor;
    const practice = data?.practice;
    const educPlan = data?.educPlan;
    const academicOptions = data?.academicOptions;

    // GPA: приоритет Платонус (из кэша) > аттестация > transferGPA
    const displayGpa = platonusGpa
        ?? (attestation?.currentGPA && attestation.currentGPA > 0 ? attestation.currentGPA : null)
        ?? (profile?.transferGPA && profile.transferGPA > 0 ? profile.transferGPA : null);

    // Track which source produced `displayGpa` so the UI can label it (students
    // otherwise can't tell whether the number is from Platonus or the transcript).
    const gpaSource: 'platonus' | 'attestation' | 'transfer' | null = platonusGpa != null
        ? 'platonus'
        : attestation?.currentGPA && attestation.currentGPA > 0
            ? 'attestation'
            : profile?.transferGPA && profile.transferGPA > 0
                ? 'transfer'
                : null;

    // Semester / credits — derive what we can from the existing profile payload.
    // Номер семестра зависит от сезона: осенью (semester=1) — нечётный
    // (course*2-1), весной (semester=2) — чётный (course*2). Сезон берём из
    // канонической дата-логики, синхронной с бэкендовым getCurrentAcademicPeriod,
    // иначе весной показывался бы прошлый (осенний) семестр.
    const currentSeason = getCurrentAcademicSemesterFromDate().semester;
    const semesterNumber = typeof profile?.course === 'number' && profile.course > 0
        ? profile.course * 2 - (currentSeason === 2 ? 0 : 1)
        : null;
    const totalSemesters = educPlan?.summary?.totalSemesters ?? null;
    const creditsEarned = typeof attestation?.creditsEarned === 'number' && attestation.creditsEarned > 0
        ? attestation.creditsEarned
        : null;

    // Loading states
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
                    style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            </div>
        );
    }

    if (!isAuth) {
        return null;
    }

    const activityRank = activityLeaderboard
        ? {
            rank: activityLeaderboard.currentUser?.rank ?? null,
            total: activityLeaderboard.totalRankedUsers,
        }
        : null;
    const invitesRank = referralOverview
        ? {
            rank: referralOverview.myRank,
            total: referralOverview.totalRankedUsers,
        }
        : null;

    return (
        <div className="animate-fadeIn">
            <AvatarCropModal
                open={cropModalOpen}
                imageSrc={cropSource}
                onCancel={handleCropCancel}
                onConfirm={handleCropConfirm}
            />

            <main className="px-4 py-4 space-y-4">
                {!fetching && !error ? (
                    <>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={onAvatarFileChange}
                        />
                        <ProfileHero
                            fullName={profile?.fullName ?? null}
                            userId={userId || ''}
                            specialty={profile?.specialty ?? null}
                            course={typeof profile?.course === 'number' ? profile.course : null}
                            groupName={platonusGroup ?? null}
                            faculty={profile?.faculty ?? null}
                            avatarSrc={customAvatar || null}
                            gpa={displayGpa}
                            gpaSource={gpaSource}
                            semesterNumber={semesterNumber}
                            totalSemesters={totalSemesters}
                            creditsEarned={creditsEarned}
                            totalCredits={null}
                            refreshing={refreshing}
                            fetching={fetching}
                            onRefresh={() => fetchProfile(true, Boolean(data))}
                            onSelectAvatar={onSelectAvatar}
                            onRemoveAvatar={removeCustomAvatar}
                            chips={
                                <>
                                    {supporter?.enabled ? (
                                        <span
                                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                            style={{ background: 'rgba(var(--primary-rgb), 0.14)', color: 'var(--primary)', border: '1px solid rgba(var(--primary-rgb), 0.24)' }}
                                        >
                                            Supporter
                                        </span>
                                    ) : null}
                                    {referralOverview && getReferralBadgeTier(referralOverview.referralCount) ? (
                                        <span
                                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                            style={{ background: 'var(--status-info-bg)', color: 'var(--status-info-color)', border: '1px solid var(--status-info-border)' }}
                                        >
                                            {getReferralBadgeTier(referralOverview.referralCount)?.icon}
                                        </span>
                                    ) : null}
                                    {friendsList && friendsList.length > 0 ? (
                                        <span
                                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                            style={{ background: 'var(--surface-overlay-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
                                        >
                                            {messages.profile.you.friendsTitle} {friendsList.length}
                                        </span>
                                    ) : null}
                                </>
                            }
                        />
                    </>
                ) : null}

                {fetching ? (
                    <ProfileFetchingState />
                ) : error ? (
                    <ProfileErrorState error={error} onRetry={() => fetchProfile(true, Boolean(data))} />
                ) : (
                    <>
                        <ProfileRanksCard
                            activity={activityRank}
                            invites={invitesRank}
                            supporter={supporter}
                            // Ranks card aggregates 3 side-loads. We render
                            // the skeleton until all three settle so the
                            // rows don't appear one-by-one, which would
                            // re-introduce the very shift this fixes.
                            loading={supportLoading || referralLoading || leaderboardLoading}
                        />
                        <ProfileActionsCard academicOptions={academicOptions} />
                        <ProfileHistoryLinkCard />
                        <ProfileFriendsStrip friends={friendsList} loading={friendsLoading} />
                        <ProfileMentorCard advisor={advisor} practice={practice} />
                        <ProfileQuestionnaireAccordion
                            educPlan={educPlan}
                            academicOptions={academicOptions}
                        />
                    </>
                )}
            </main>
        </div>
    );
}
