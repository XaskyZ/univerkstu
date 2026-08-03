'use client';

import dynamic from 'next/dynamic';
import StartupPrefetcher from '@/components/StartupPrefetcher';
import CardSheenTracker from '@/components/CardSheenTracker';

const SnowEffect = dynamic(
    () => import('@/components/SnowEffect').then((mod) => mod.SnowEffect),
    { ssr: false }
);
const PlatonusGradesWatcher = dynamic(() => import('@/components/PlatonusGradesWatcher'), { ssr: false });
const GroupTaskNotificationsWatcher = dynamic(() => import('@/components/GroupTaskNotificationsWatcher'), { ssr: false });
const ScheduleNotificationsWatcher = dynamic(() => import('@/components/ScheduleNotificationsWatcher'), { ssr: false });
const MobileDevToolsToggle = dynamic(() => import('@/components/MobileDevToolsToggle'), { ssr: false });
const PwaStateReporter = dynamic(() => import('@/components/PwaStateReporter'), { ssr: false });
const SwUpdateNotifier = dynamic(() => import('@/components/SwUpdateNotifier'), { ssr: false });
const InstallPrompt = dynamic(() => import('@/components/InstallPrompt'), { ssr: false });
const OfflineIndicator = dynamic(() => import('@/components/OfflineIndicator'), { ssr: false });

export default function AppClientEffects() {
    return (
        <>
            <SnowEffect />
            <CardSheenTracker />
            <PwaStateReporter />
            <PlatonusGradesWatcher />
            <GroupTaskNotificationsWatcher />
            <ScheduleNotificationsWatcher />
            <StartupPrefetcher />
            <MobileDevToolsToggle />
            <SwUpdateNotifier />
            <InstallPrompt />
            <OfflineIndicator />
        </>
    );
}
