'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { CacheKeys, getCacheAge, getFromCache } from '@/lib/cache';
import { getCachedAcademicContext } from '@/lib/platonus-semesters';
import { isExamSessionKind } from '@/lib/session-mode';
import { useNotifications } from '@/lib/use-notifications';
import type { Schedule } from '@/lib/types';
import type { AcademicContext } from '@/lib/api';

/**
 * Кеш расписания обновляется только при заходе на страницу расписания. Сетка
 * семестра стабильна (чётность мы берём из академ-контекста, не из кеша
 * расписания), поэтому TTL щедрый — неделя. Более старый кеш почти наверняка
 * от закончившегося семестра — по нему уведомления не шлём (№16 логик-аудита).
 */
const SCHEDULE_CACHE_MAX_AGE_MINUTES = 7 * 24 * 60;

function readFreshSchedule(): Schedule | null {
    const ageMinutes = getCacheAge(CacheKeys.SCHEDULE);
    if (ageMinutes !== null && ageMinutes > SCHEDULE_CACHE_MAX_AGE_MINUTES) {
        return null;
    }
    return getFromCache<Schedule>(CacheKeys.SCHEDULE);
}

export default function ScheduleNotificationsWatcher() {
    const { isAuth } = useAuth();
    const [schedule, setSchedule] = useState<Schedule | null>(() => readFreshSchedule());
    // getCachedAcademicContext (в отличие от голого getFromCache) отдаёт null
    // для контекста старше 12 часов: протухшая чётность из localStorage не
    // должна питать уведомления о парах (№16 логик-аудита).
    const [academicContext, setAcademicContext] = useState<AcademicContext | null>(() => getCachedAcademicContext());

    // Шлём уведомления о парах только когда:
    // - есть свежий (≤12 ч) академ-контекст с известной чётностью недели —
    //   т.е. семестр действительно идёт;
    // - сейчас не каникулы и не экзаменационная сессия (№11: в каникулы
    //   сетка «мёртвая», пар нет);
    // - кеш расписания не протух.
    // При любом сомнении лучше промолчать, чем прислать «через 10 минут
    // Физика» по чётности прошлой недели.
    const weekParity = academicContext?.weekParity ?? null;
    const watchAllowed = Boolean(
        schedule
        && academicContext
        && weekParity
        && academicContext.activePeriodKind !== 'vacation'
        && !isExamSessionKind(academicContext.activePeriodKind)
    );

    useNotifications(watchAllowed ? schedule : null, weekParity || undefined, {
        watchSchedule: true,
        semesterWeek: academicContext?.semesterWeek ?? null,
    });

    useEffect(() => {
        if (!isAuth || typeof window === 'undefined') return;

        const syncFromCache = () => {
            setSchedule(readFreshSchedule());
            setAcademicContext(getCachedAcademicContext());
        };

        syncFromCache();
        const timer = window.setInterval(syncFromCache, 60_000);
        window.addEventListener('focus', syncFromCache);
        window.addEventListener('storage', syncFromCache);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', syncFromCache);
            window.removeEventListener('storage', syncFromCache);
        };
    }, [isAuth]);

    return null;
}
