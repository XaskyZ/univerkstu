'use client';

import { Exam } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';

interface ExamCountdownProps {
    exam: Exam;
}

export default function ExamCountdown({ exam }: ExamCountdownProps) {
    const { language } = useLanguage();
    if (!exam.datetime) return null;

    const examDate = new Date(exam.datetime.iso);
    const now = new Date();
    const diff = examDate.getTime() - now.getTime();

    if (diff < 0) return null; // Экзамен прошёл

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const urgencyColor = days <= 1
        ? 'from-red-500 to-pink-600'
        : days <= 3
            ? 'from-orange-500 to-amber-600'
            : 'from-purple-500 to-indigo-600';
    const ui = {
        ru: { nearest: 'Ближайший экзамен', days: 'дн', hours: 'ч', at: 'в' },
        kz: { nearest: 'Ең жақын емтихан', days: 'күн', hours: 'сағ', at: 'сағ.' },
        en: { nearest: 'Upcoming exam', days: 'd', hours: 'h', at: 'at' },
    }[language];

    return (
        <div className={`bg-gradient-to-r ${urgencyColor} rounded-xl p-4 text-white mb-6`}>
            <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm opacity-80">{ui.nearest}</p>
                    <p className="font-semibold truncate">{exam.subject}</p>

                    <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1">
                            <span className="text-2xl font-bold">{days}</span>
                            <span className="text-sm opacity-80">{ui.days}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-2xl font-bold">{hours}</span>
                            <span className="text-sm opacity-80">{ui.hours}</span>
                        </div>
                    </div>

                    <p className="text-sm opacity-80 mt-1">
                        {exam.datetime.displayDate} {ui.at} {exam.datetime.displayTime}
                    </p>
                </div>
            </div>
        </div>
    );
}
