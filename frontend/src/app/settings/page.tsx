'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    BarChart3,
    BellRing,
    BookOpen,
    CalendarDays,
    Compass,
    FileText,
    Gift,
    Info,
    KeyRound,
    Languages,
    LogOut,
    Megaphone,
    MessageCircle,
    Monitor,
    Palette,
    ShieldOff,
    Snowflake,
    Sparkles,
    Star,
    Trophy,
    UserCog,
    Users,
    Smartphone,
    ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage, AppLanguage } from '@/lib/language-context';
import { useSnow } from '@/lib/snow-context';
import {
    getGroupSpaceMe,
    getReferralOverview,
    updateLanguageSetting,
    type GroupSpaceMe,
    type ReferralOverview,
} from '@/lib/api';
import { PageMain, PageShell } from '@/components/PageShell';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SettingsBottomSheet } from '@/components/SettingsBottomSheet';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { IdentityStrip } from '@/components/settings/IdentityStrip';
import { QuickActionStrip, type QuickActionItem } from '@/components/settings/QuickActionStrip';
import { SettingsHeader } from './components/SettingsHeader';
import { SettingsLoadingState } from './components/SettingsLoadingState';
import { SettingsLogoutButton } from './components/SettingsLogoutButton';
import { InstallSheet } from './components/InstallSheet';

export default function SettingsPage() {
    const { isAuth, loading, userId, logout } = useAuth();
    const { language, setLanguage, messages } = useLanguage();
    const { snowEnabled, setSnowEnabled } = useSnow();
    const router = useRouter();

    const ui = messages.settings;
    const [groupAccess, setGroupAccess] = useState<GroupSpaceMe | null>(null);
    const [referralOverview, setReferralOverview] = useState<ReferralOverview | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [versionTapCount, setVersionTapCount] = useState(0);
    const [languageSavingStatus, setLanguageSavingStatus] = useState<string | null>(null);
    const [installSheetOpen, setInstallSheetOpen] = useState(false);
    const versionTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadSideData = useCallback(async (signal?: AbortSignal) => {
        const [groupResult, referralResult] = await Promise.all([
            getGroupSpaceMe(),
            getReferralOverview(),
        ]);
        if (signal?.aborted) return;
        if (groupResult.success && groupResult.data) {
            setGroupAccess(groupResult.data);
        }
        if (referralResult.success && referralResult.data) {
            setReferralOverview(referralResult.data);
        }
    }, []);

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void loadSideData(controller.signal);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [isAuth, loadSideData]);

    useEffect(() => {
        return () => {
            if (versionTapTimerRef.current) {
                clearTimeout(versionTapTimerRef.current);
            }
        };
    }, []);

    if (loading) {
        return <SettingsLoadingState />;
    }

    if (!isAuth) return null;

    const handleRefresh = async () => {
        if (refreshing) return;
        setRefreshing(true);
        await loadSideData();
        setRefreshing(false);
    };

    const handleLogout = async () => {
        await logout();
        router.push('/');
    };

    const handleLanguageChange = async (nextLanguage: AppLanguage) => {
        if (nextLanguage === language) return;
        const previous = language;
        setLanguage(nextLanguage);
        setLanguageSavingStatus(null);
        const result = await updateLanguageSetting(nextLanguage);
        if (!result.success) {
            setLanguage(previous);
            setLanguageSavingStatus(result.error || ui.appearance.languageFailed);
            return;
        }
        setLanguageSavingStatus(ui.appearance.languageSaved);
    };

    const handleVersionTap = () => {
        const nextCount = versionTapCount + 1;
        setVersionTapCount(nextCount);
        if (versionTapTimerRef.current) {
            clearTimeout(versionTapTimerRef.current);
        }
        versionTapTimerRef.current = setTimeout(() => setVersionTapCount(0), 2500);
    };

    const isCoordinator = Boolean(groupAccess?.access.roles.includes('coordinator'));
    const isCurator = Boolean(groupAccess?.access.roles.includes('curator'));
    const hasStarostaPanel = Boolean(
        groupAccess?.access.roles.includes('starosta') || groupAccess?.access.roles.includes('helper'),
    );
    const hasGroupSpace = Boolean(groupAccess?.available);
    const referralCount = referralOverview?.referralCount ?? 0;

    const quickItems: QuickActionItem[] = [
        { key: 'schedule', icon: <CalendarDays className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.schedule, href: '/schedule' },
        { key: 'exams', icon: <FileText className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.exams, href: '/exams' },
        { key: 'umkd', icon: <BookOpen className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.umkd, href: '/umkd' },
        { key: 'profile', icon: <UserCog className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.profile, href: '/profile' },
        { key: 'chat', icon: <MessageCircle className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.chat, href: '/chat' },
        { key: 'board', icon: <Megaphone className="w-5 h-5" strokeWidth={2} />, label: messages.board.navLabel, href: '/board' },
        { key: 'hall-of-fame', icon: <Trophy className="w-5 h-5" strokeWidth={2} />, label: messages.leaderboard.navLabel, href: '/settings/activity' },
        { key: 'referrals', icon: <Gift className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.referrals, href: '/settings/referrals', badge: referralCount > 0 ? String(referralCount) : undefined },
        ...(hasGroupSpace
            ? [{ key: 'group', icon: <Users className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.group, href: '/group', badge: ui.quickActions.beta } satisfies QuickActionItem]
            : []),
        ...(isCoordinator
            ? [{ key: 'coordinator', icon: <Compass className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.coordinator, href: '/coordinator' } satisfies QuickActionItem]
            : []),
        ...(isCurator
            ? [{ key: 'curator', icon: <UserCog className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.curator, href: '/group/curator' } satisfies QuickActionItem]
            : []),
        ...(hasStarostaPanel
            ? [{ key: 'starosta', icon: <ShieldCheck className="w-5 h-5" strokeWidth={2} />, label: ui.quickActions.starosta, href: '/starosta' } satisfies QuickActionItem]
            : []),
    ];

    const groupLine = groupAccess?.group?.title || groupAccess?.group?.groupKey || null;

    return (
        <PageShell>
            <div className="page-scroll-progress" aria-hidden />
            <SettingsHeader refreshing={refreshing} onRefresh={() => void handleRefresh()} />

            <PageMain className="space-y-5">
                <IdentityStrip userId={userId} groupLine={groupLine} />
                <QuickActionStrip items={quickItems} />

                <SettingsGroup title={ui.groups.appearance}>
                    <SettingsRow
                        icon={<Palette className="w-4 h-4" strokeWidth={2} />}
                        title={ui.appearance.themeRowTitle}
                        subtitle={ui.appearance.themeRowSubtitle}
                        href="/settings/appearance/theme"
                    />
                    <SettingsRow
                        icon={<Languages className="w-4 h-4" strokeWidth={2} />}
                        title={ui.appearance.languageRowTitle}
                        subtitle={languageSavingStatus || ui.appearance.languageRowSubtitle}
                        showChevron={false}
                        rightSlot={
                            <SegmentedControl<AppLanguage>
                                value={language}
                                onChange={(value) => void handleLanguageChange(value)}
                                ariaLabel={ui.appearance.languageRowTitle}
                                options={[
                                    { value: 'ru', label: 'RU' },
                                    { value: 'kz', label: 'KZ' },
                                    { value: 'en', label: 'EN' },
                                ]}
                            />
                        }
                    />
                    <SettingsRow
                        icon={<Snowflake className="w-4 h-4" strokeWidth={2} />}
                        title={ui.appearance.snowRowTitle}
                        subtitle={snowEnabled ? ui.appearance.snowLabelOn : ui.appearance.snowRowSubtitle}
                        showChevron={false}
                        rightSlot={
                            <ToggleSwitch
                                checked={snowEnabled}
                                onChange={setSnowEnabled}
                                ariaLabel={ui.appearance.snowRowTitle}
                            />
                        }
                    />
                </SettingsGroup>

                <SettingsGroup title={ui.groups.account}>
                    <SettingsRow
                        icon={<Monitor className="w-4 h-4" strokeWidth={2} />}
                        title={ui.devices.rowTitle}
                        subtitle={ui.devices.rowSubtitle}
                        href="/settings/devices"
                    />
                    <SettingsRow
                        icon={<KeyRound className="w-4 h-4" strokeWidth={2} />}
                        title={ui.password.rowTitle}
                        subtitle={ui.password.rowSubtitle}
                        href="/settings/password"
                    />
                    <SettingsRow
                        icon={<Trophy className="w-4 h-4" strokeWidth={2} />}
                        title={ui.leaderboard.nameRowTitle}
                        subtitle={ui.leaderboard.nameRowSubtitle}
                        href="/settings/activity/name"
                    />
                    <SettingsRow
                        icon={<ShieldOff className="w-4 h-4" strokeWidth={2} />}
                        title={ui.blocked.rowTitle}
                        subtitle={ui.blocked.rowSubtitle}
                        href="/settings/blocked"
                    />
                </SettingsGroup>

                <SettingsGroup title={ui.groups.community}>
                    <SettingsRow
                        icon={<BarChart3 className="w-4 h-4" strokeWidth={2} />}
                        title={ui.stats.rowTitle}
                        subtitle={ui.stats.rowSubtitle}
                        href="/settings/stats"
                    />
                    <SettingsRow
                        icon={<Sparkles className="w-4 h-4" strokeWidth={2} />}
                        title={ui.leaderboard.activityRowTitle}
                        subtitle={ui.leaderboard.activityRowSubtitle}
                        href="/settings/activity"
                    />
                    <SettingsRow
                        icon={<Gift className="w-4 h-4" strokeWidth={2} />}
                        title={ui.leaderboard.referralsRowTitle}
                        subtitle={ui.leaderboard.referralsRowSubtitle}
                        href="/settings/referrals"
                    />
                    <SettingsRow
                        icon={<Star className="w-4 h-4" strokeWidth={2} />}
                        title={ui.feedback.rowTitle}
                        subtitle={ui.feedback.rowSubtitle}
                        href="/settings/feedback"
                    />
                </SettingsGroup>

                <SettingsGroup title={ui.groups.application}>
                    <SettingsRow
                        icon={<BellRing className="w-4 h-4" strokeWidth={2} />}
                        title={ui.notifications.rowTitle}
                        subtitle={ui.notifications.rowSubtitle}
                        href="/settings/notifications"
                    />
                    <SettingsRow
                        icon={<Smartphone className="w-4 h-4" strokeWidth={2} />}
                        title={ui.install.rowTitle}
                        subtitle={ui.install.rowSubtitle}
                        onClick={() => setInstallSheetOpen(true)}
                    />
                    <SettingsRow
                        icon={<Info className="w-4 h-4" strokeWidth={2} />}
                        title={ui.about.rowTitle}
                        subtitle={ui.about.rowSubtitle}
                        href="/settings/about"
                    />
                    <SettingsRow
                        icon={<LogOut className="w-4 h-4" strokeWidth={2} />}
                        title={ui.about.version}
                        subtitle="v4.1.33"
                        onClick={handleVersionTap}
                        showChevron={false}
                    />
                </SettingsGroup>

                <SettingsLogoutButton onLogout={handleLogout} />
            </PageMain>

            <SettingsBottomSheet
                open={installSheetOpen}
                onClose={() => setInstallSheetOpen(false)}
                title={ui.install.sheetTitle}
                subtitle={ui.install.sheetSubtitle}
            >
                <InstallSheet />
            </SettingsBottomSheet>
        </PageShell>
    );
}

interface ToggleSwitchProps {
    checked: boolean;
    onChange: (value: boolean) => void;
    ariaLabel?: string;
}

function ToggleSwitch({ checked, onChange, ariaLabel }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            onClick={() => onChange(!checked)}
            className="relative rounded-full transition-all duration-300"
            style={{
                width: 46,
                height: 28,
                padding: 2,
                border: checked
                    ? '1px solid rgba(var(--primary-rgb), 0.5)'
                    : '1px solid var(--border)',
                background: checked
                    ? 'rgba(var(--primary-rgb), 0.9)'
                    : 'var(--surface-overlay-2)',
            }}
        >
            <span
                className="absolute rounded-full transition-transform duration-300"
                style={{
                    top: 2,
                    left: 2,
                    width: 22,
                    height: 22,
                    background: 'rgba(255,255,255,0.96)',
                    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.22)',
                    transform: checked ? 'translateX(18px)' : 'translateX(0)',
                }}
            />
        </button>
    );
}
