'use client';

import { Schedule, Lesson } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';

interface TodayCardProps {
    schedule: Schedule;
}

function toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

export default function TodayCard({ schedule }: TodayCardProps) {
    const { language, messages } = useLanguage();
    const now = new Date();
    const dayIndex = now.getDay(); // 0 = Sunday
    const dayNamesByLanguage: Record<typeof language, Record<string, string>> = {
        ru: {
            mon: 'Понедельник',
            tue: 'Вторник',
            wed: 'Среда',
            thu: 'Четверг',
            fri: 'Пятница',
            sat: 'Суббота',
            sun: 'Воскресенье',
        },
        kz: {
            mon: 'Дүйсенбі',
            tue: 'Сейсенбі',
            wed: 'Сәрсенбі',
            thu: 'Бейсенбі',
            fri: 'Жұма',
            sat: 'Сенбі',
            sun: 'Жексенбі',
        },
        en: {
            mon: 'Monday',
            tue: 'Tuesday',
            wed: 'Wednesday',
            thu: 'Thursday',
            fri: 'Friday',
            sat: 'Saturday',
            sun: 'Sunday',
        },
    };
    const ui = {
        ru: { today: 'Сегодня', noLessons: 'Нет занятий', finished: 'Занятия закончились', current: 'Сейчас', next: 'Следующее' },
        kz: { today: 'Бүгін', noLessons: 'Сабақ жоқ', finished: 'Сабақтар аяқталды', current: 'Қазір', next: 'Келесі' },
        en: { today: 'Today', noLessons: 'No lessons', finished: 'Lessons are over', current: 'Now', next: 'Next' },
    }[language];

    // Конвертируем JS день недели в наш формат
    const dayMap: Record<number, string> = {
        1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 0: 'sun'
    };

    const todayKey = dayMap[dayIndex];
    const todaySchedule = schedule.days.find(d => d.name === todayKey);

    // Находим все занятия на сегодня
    const todayLessons: { lesson: Lesson; timeSlot: { start: string; end: string } }[] = [];

    if (todaySchedule) {
        schedule.timeSlots.forEach((timeSlot, slotIndex) => {
            const lessons = todaySchedule.lessons[slotIndex] || [];
            lessons.forEach(lesson => {
                todayLessons.push({ lesson, timeSlot });
            });
        });
    }

    // Находим текущую/следующую пару
    const currentTime = now.getHours() * 60 + now.getMinutes();

    let currentLesson: { lesson: Lesson; timeSlot: { start: string; end: string } } | null = null;
    let nextLesson: { lesson: Lesson; timeSlot: { start: string; end: string } } | null = null;

    for (const item of todayLessons) {
        const startMinutes = toMinutes(item.timeSlot.start);
        const endMinutes = toMinutes(item.timeSlot.end);

        if (currentTime >= startMinutes && currentTime <= endMinutes) {
            currentLesson = item;
        } else if (currentTime < startMinutes && !nextLesson) {
            nextLesson = item;
        }
    }

    const displayLesson = currentLesson || nextLesson;
    const isCurrent = !!currentLesson;

    if (!displayLesson) {
        // Нет занятий или все закончились
        return (
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-4 text-white mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-sm opacity-80">{dayNamesByLanguage[language][todayKey] || ui.today}</p>
                        <p className="font-semibold">
                            {todayLessons.length === 0 ? ui.noLessons : ui.finished}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`rounded-xl p-4 text-white mb-6 ${isCurrent
                ? 'bg-gradient-to-r from-blue-500 to-indigo-600'
                : 'bg-gradient-to-r from-purple-500 to-pink-600'
            }`}>
            <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    {isCurrent ? (
                        <div className="relative">
                            <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                            <div className="absolute inset-0 w-3 h-3 bg-white rounded-full animate-ping"></div>
                        </div>
                    ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm opacity-80">
                        {isCurrent ? ui.current : ui.next} • {displayLesson.timeSlot.start} - {displayLesson.timeSlot.end}
                    </p>
                    <p className="font-semibold truncate">{displayLesson.lesson.title}</p>
                    <div className="flex items-center gap-3 mt-1 text-sm opacity-80">
                        {displayLesson.lesson.room && (
                            <span>{messages.schedule.roomPrefix} {displayLesson.lesson.room}</span>
                        )}
                        {displayLesson.lesson.teacher && (
                            <span className="truncate">{displayLesson.lesson.teacher}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Progress bar for current lesson */}
            {isCurrent && displayLesson && (() => {
                const startMinutes = toMinutes(displayLesson.timeSlot.start);
                const endMinutes = toMinutes(displayLesson.timeSlot.end);
                const progressPct = Math.min(100, Math.max(0,
                    ((currentTime - startMinutes) / (endMinutes - startMinutes)) * 100
                ));
                return (
                    <div className="mt-3">
                        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-white/60 rounded-full transition-all"
                                style={{ width: `${progressPct}%` }}
                            />
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
