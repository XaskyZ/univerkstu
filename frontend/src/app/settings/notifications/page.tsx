'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage, formatMessage } from '@/lib/language-context';
import { PageMain, PageShell } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { toast } from '@/lib/toast';
import { getExams } from '@/lib/api';
import {
    disableExamPush,
    enableExamPush,
    getCapability,
    getCurrentSubscription,
    getPrefs,
    sendTestPush,
    setPrefs,
    type ExamRemindersPrefs,
} from '@/lib/push-subscription';
import {
    getNotificationPrefs,
    isKindEnabled,
    setNotificationPrefs,
    SOCIAL_NOTIFICATION_KINDS,
    type NotificationPrefs,
    type SocialNotificationKind,
} from '@/lib/api/notifications';

type Stage =
    | 'loading'
    | 'unsupported'
    | 'ios_pwa_required'
    | 'permission_denied'
    | 'not_subscribed'
    | 'ready';

/**
 * Dedicated sub-screen at `/settings/notifications` for exam push reminders.
 *
 * Owns the master enable/disable flow (which talks to PushManager + backend),
 * the two sub-toggles (one-day / one-hour reminders) that are pure pref edits,
 * and a small test button. Permission is only requested as a result of a user
 * click on the master toggle, never on mount.
 */
export default function NotificationsSettingsPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const ui = messages.settings.notifications;
    const router = useRouter();

    const [stage, setStage] = useState<Stage>('loading');
    const [prefs, setPrefsState] = useState<ExamRemindersPrefs | null>(null);
    const [armedCount, setArmedCount] = useState<number | null>(null);
    const [busy, setBusy] = useState<null | 'master' | 'oneDay' | 'oneHour' | 'test'>(null);
    // Universal per-kind opt-in map for social pushes. `null` while loading,
    // so the UI can render a skeleton instead of incorrect default-off toggles.
    const [kindPrefs, setKindPrefs] = useState<NotificationPrefs | null>(null);
    const [kindBusy, setKindBusy] = useState<SocialNotificationKind | null>(null);

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    const refreshStage = useCallback(async () => {
        const capability = getCapability();
        if (!capability.supported) {
            if (capability.reason === 'ios_pwa_required') {
                setStage('ios_pwa_required');
            } else {
                setStage('unsupported');
            }
            return;
        }
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            setStage('permission_denied');
            return;
        }
        const subscription = await getCurrentSubscription();
        const enabled = prefs?.enabled === true;
        if (subscription && enabled) {
            setStage('ready');
        } else {
            setStage('not_subscribed');
        }
    }, [prefs?.enabled]);

    // Initial load: prefs + armed count + per-kind opt-in map.
    //
    // The per-kind fetch is intentionally non-blocking for the rest of the
    // screen: if it 401s or 5xxs we still want exam-reminder UX to work, so
    // we just leave `kindPrefs` null and the social section renders a small
    // skeleton.
    useEffect(() => {
        if (!isAuth) return;
        let cancelled = false;
        (async () => {
            const [prefsResult, examsResult, kindPrefsResult] = await Promise.all([
                getPrefs(),
                getExams(),
                getNotificationPrefs(),
            ]);
            if (cancelled) return;
            if (prefsResult.ok) {
                setPrefsState(prefsResult.prefs);
            } else {
                toast.error(prefsResult.message || ui.loadFailed);
                setPrefsState({ enabled: false, oneDay: true, oneHour: true });
            }
            if (examsResult.success && examsResult.data) {
                const now = Date.now();
                const upcoming = examsResult.data.exams.filter((exam) => {
                    if (!exam.datetime?.iso) return false;
                    const time = new Date(exam.datetime.iso).getTime();
                    return Number.isFinite(time) && time > now;
                }).length;
                setArmedCount(upcoming);
            } else {
                setArmedCount(0);
            }
            if (kindPrefsResult.ok) {
                setKindPrefs(kindPrefsResult.prefs);
            } else {
                // Synthesize a default-on view so the toggles still render —
                // any subsequent PUT will create the row on the server side.
                setKindPrefs({
                    userId: '',
                    enabledKinds: {},
                    createdAt: '',
                    updatedAt: '',
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuth, ui.loadFailed]);

    // Whenever prefs change (after load), re-evaluate the stage.
    useEffect(() => {
        if (prefs === null) return;
        void refreshStage();
    }, [prefs, refreshStage]);

    const handleMasterToggle = useCallback(async () => {
        if (busy) return;
        if (!prefs) return;
        setBusy('master');
        try {
            if (prefs.enabled) {
                const result = await disableExamPush();
                if (!result.ok) {
                    toast.error(result.message || ui.disableFailed);
                    return;
                }
                const updated = await setPrefs({ enabled: false });
                if (updated.ok) {
                    setPrefsState(updated.prefs);
                } else {
                    setPrefsState({ ...prefs, enabled: false });
                }
            } else {
                const capability = getCapability();
                if (!capability.supported) {
                    if (capability.reason === 'ios_pwa_required') {
                        setStage('ios_pwa_required');
                    } else {
                        setStage('unsupported');
                    }
                    toast.error(ui.enableFailed);
                    return;
                }
                const result = await enableExamPush();
                if (!result.ok) {
                    if (result.reason === 'denied') {
                        setStage('permission_denied');
                    }
                    toast.error(result.message || ui.enableFailed);
                    return;
                }
                const updated = await setPrefs({ enabled: true });
                if (updated.ok) {
                    setPrefsState(updated.prefs);
                } else {
                    setPrefsState({ ...prefs, enabled: true });
                    toast.error(updated.message || ui.saveFailed);
                }
            }
        } finally {
            setBusy(null);
        }
    }, [busy, prefs, ui.disableFailed, ui.enableFailed, ui.saveFailed]);

    const handleSubToggle = useCallback(
        async (key: 'oneDay' | 'oneHour') => {
            if (busy) return;
            if (!prefs) return;
            setBusy(key);
            try {
                const nextValue = !prefs[key];
                const optimistic: ExamRemindersPrefs = { ...prefs, [key]: nextValue };
                setPrefsState(optimistic);
                const updated = await setPrefs({ [key]: nextValue });
                if (!updated.ok) {
                    // rollback
                    setPrefsState(prefs);
                    toast.error(updated.message || ui.saveFailed);
                } else {
                    setPrefsState(updated.prefs);
                }
            } finally {
                setBusy(null);
            }
        },
        [busy, prefs, ui.saveFailed],
    );

    /**
     * Toggle a single social-notification kind. Optimistic UI: flip locally
     * first, fire PUT, revert on error. A failed PUT only resets the one kind
     * the user tried to change — other in-flight toggles are unaffected.
     */
    const handleKindToggle = useCallback(
        async (kind: SocialNotificationKind) => {
            if (kindBusy) return;
            if (!kindPrefs) return;
            const currentlyEnabled = isKindEnabled(kindPrefs, kind);
            const next = !currentlyEnabled;
            setKindBusy(kind);
            const optimistic: NotificationPrefs = {
                ...kindPrefs,
                enabledKinds: { ...kindPrefs.enabledKinds, [kind]: next },
            };
            setKindPrefs(optimistic);
            try {
                const result = await setNotificationPrefs({ [kind]: next });
                if (!result.ok) {
                    setKindPrefs(kindPrefs);
                    toast.error(result.message || ui.saveFailed);
                }
            } finally {
                setKindBusy(null);
            }
        },
        [kindBusy, kindPrefs, ui.saveFailed],
    );

    const handleTest = useCallback(async () => {
        if (busy) return;
        setBusy('test');
        try {
            const result = await sendTestPush();
            if (result.ok) {
                toast.success(ui.testSent);
            } else {
                toast.error(result.message || ui.testFailed);
            }
        } finally {
            setBusy(null);
        }
    }, [busy, ui.testFailed, ui.testSent]);

    const armedLine = useMemo(() => {
        if (armedCount === null) return '';
        if (armedCount <= 0) return ui.armedCountZero;
        return formatMessage(ui.armedCount, { count: armedCount });
    }, [armedCount, ui.armedCount, ui.armedCountZero]);

    const readyLine = useMemo(() => {
        if (armedCount === null) return '';
        const count = Math.max(0, armedCount);
        return formatMessage(ui.helperReady, { count });
    }, [armedCount, ui.helperReady]);

    if (loading || !isAuth) return null;

    const masterChecked = prefs?.enabled === true;
    const subTogglesVisible = masterChecked && (stage === 'ready' || stage === 'not_subscribed');

    return (
        <PageShell>
            <SubScreenHeader title={ui.screenTitle} subtitle={ui.screenSubtitle} />
            <PageMain className="space-y-4">
                <SettingsGroup>
                    <SettingsRow
                        icon={<BellRing className="w-4 h-4" strokeWidth={2} />}
                        title={ui.masterToggle}
                        subtitle={stage === 'loading' ? messages.common.loading : undefined}
                        showChevron={false}
                        rightSlot={
                            <ToggleSwitch
                                checked={masterChecked}
                                disabled={busy === 'master' || stage === 'loading'}
                                onChange={() => void handleMasterToggle()}
                                ariaLabel={ui.masterToggle}
                            />
                        }
                    />
                </SettingsGroup>

                {subTogglesVisible ? (
                    <SettingsGroup>
                        <SettingsRow
                            title={ui.oneDayToggle}
                            showChevron={false}
                            rightSlot={
                                <ToggleSwitch
                                    checked={prefs?.oneDay === true}
                                    disabled={busy === 'oneDay'}
                                    onChange={() => void handleSubToggle('oneDay')}
                                    ariaLabel={ui.oneDayToggle}
                                />
                            }
                        />
                        <SettingsRow
                            title={ui.oneHourToggle}
                            showChevron={false}
                            rightSlot={
                                <ToggleSwitch
                                    checked={prefs?.oneHour === true}
                                    disabled={busy === 'oneHour'}
                                    onChange={() => void handleSubToggle('oneHour')}
                                    ariaLabel={ui.oneHourToggle}
                                />
                            }
                        />
                    </SettingsGroup>
                ) : null}

                <HelperBlock
                    stage={stage}
                    masterChecked={masterChecked}
                    readyLine={readyLine}
                    armedLine={armedLine}
                    ui={ui}
                />

                {stage === 'ready' ? (
                    <button
                        type="button"
                        className="btn btn-secondary w-full"
                        onClick={() => void handleTest()}
                        disabled={busy === 'test'}
                    >
                        {busy === 'test' ? ui.testSending : ui.testButton}
                    </button>
                ) : null}

                <SocialNotificationsSection
                    prefs={kindPrefs}
                    busyKind={kindBusy}
                    onToggle={(kind) => void handleKindToggle(kind)}
                    ui={ui}
                />
            </PageMain>
        </PageShell>
    );
}

interface SocialNotificationsSectionProps {
    prefs: NotificationPrefs | null;
    busyKind: SocialNotificationKind | null;
    onToggle: (kind: SocialNotificationKind) => void;
    ui: {
        socialSectionTitle: string;
        socialSectionSubtitle: string;
        socialMentionToggle: string;
        socialDmToggle: string;
        socialCommentToggle: string;
        socialGroupPostToggle: string;
        socialAnnouncementToggle: string;
        eventOneDayToggle: string;
        eventOneHourToggle: string;
    };
}

/**
 * Per-kind opt-in/out for the 5 social push notification kinds. Rendered as a
 * standalone card so the existing exam-reminder layout above is unchanged.
 *
 * Toggles are independent of the exam-reminder master toggle — a user who
 * has not enabled the browser PushManager flow at all can still pre-configure
 * which kinds they want, and the server-side gate will respect them as soon
 * as a subscription is registered.
 */
function SocialNotificationsSection({
    prefs,
    busyKind,
    onToggle,
    ui,
}: SocialNotificationsSectionProps) {
    const labelByKind: Record<SocialNotificationKind, string> = {
        social_mention: ui.socialMentionToggle,
        social_dm: ui.socialDmToggle,
        social_comment: ui.socialCommentToggle,
        social_group_post: ui.socialGroupPostToggle,
        social_announcement: ui.socialAnnouncementToggle,
        event_1day: ui.eventOneDayToggle,
        event_1hour: ui.eventOneHourToggle,
    };

    return (
        <section aria-labelledby="social-notifications-heading" className="space-y-2">
            <div className="px-1">
                <h2
                    id="social-notifications-heading"
                    className="text-[13px] font-medium uppercase tracking-wide"
                    style={{ color: 'var(--muted)' }}
                >
                    {ui.socialSectionTitle}
                </h2>
                <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
                    {ui.socialSectionSubtitle}
                </p>
            </div>
            <SettingsGroup>
                {SOCIAL_NOTIFICATION_KINDS.map((kind) => (
                    <SettingsRow
                        key={kind}
                        title={labelByKind[kind]}
                        showChevron={false}
                        rightSlot={
                            prefs === null ? (
                                <span
                                    className="inline-block rounded-full"
                                    style={{
                                        width: 46,
                                        height: 28,
                                        background: 'var(--surface-overlay-2)',
                                        opacity: 0.5,
                                    }}
                                    aria-hidden
                                />
                            ) : (
                                <ToggleSwitch
                                    checked={isKindEnabled(prefs, kind)}
                                    disabled={busyKind === kind}
                                    onChange={() => onToggle(kind)}
                                    ariaLabel={labelByKind[kind]}
                                />
                            )
                        }
                    />
                ))}
            </SettingsGroup>
        </section>
    );
}

interface HelperBlockProps {
    stage: Stage;
    masterChecked: boolean;
    readyLine: string;
    armedLine: string;
    ui: {
        helperPwaIOS: string;
        helperPermissionDenied: string;
        helperUnsupported: string;
        helperNotSubscribed: string;
        openBrowserSettings: string;
    };
}

function HelperBlock({ stage, masterChecked, readyLine, armedLine, ui }: HelperBlockProps) {
    if (stage === 'loading') return null;

    if (stage === 'unsupported') {
        return (
            <div className="card p-4">
                <p className="text-[13px] text-muted-fg">{ui.helperUnsupported}</p>
            </div>
        );
    }

    if (stage === 'ios_pwa_required') {
        return (
            <div className="card p-4">
                <p className="text-[13px] text-muted-fg">{ui.helperPwaIOS}</p>
            </div>
        );
    }

    if (stage === 'permission_denied') {
        return (
            <div className="card p-4 space-y-3">
                <p className="text-[13px] text-muted-fg">{ui.helperPermissionDenied}</p>
                <p className="text-[12px] text-muted-fg/80">{ui.openBrowserSettings}</p>
            </div>
        );
    }

    if (stage === 'not_subscribed') {
        return (
            <div className="card p-4">
                <p className="text-[13px] text-muted-fg">{ui.helperNotSubscribed}</p>
            </div>
        );
    }

    // ready
    if (masterChecked) {
        return (
            <div className="card p-4 space-y-1">
                <p
                    className="text-[13px] font-medium"
                    style={{ color: 'var(--primary)' }}
                >
                    {readyLine || armedLine}
                </p>
                {armedLine && readyLine !== armedLine ? (
                    <p className="text-[12px] text-muted-fg/80">{armedLine}</p>
                ) : null}
            </div>
        );
    }

    return null;
}

interface ToggleSwitchProps {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    ariaLabel?: string;
}

/**
 * iOS-style switch. Mirrors the inline ToggleSwitch in `/settings/page.tsx`
 * so the visuals match without importing a private helper from that file.
 */
function ToggleSwitch({ checked, onChange, disabled, ariaLabel }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={onChange}
            className="relative rounded-full transition-all duration-300 disabled:opacity-60"
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
