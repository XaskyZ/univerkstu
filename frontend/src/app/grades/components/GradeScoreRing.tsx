'use client';

import { useLanguage } from '@/lib/language-context';
import { getGradeTone } from '../utils/grades-helpers';

/**
 * Круглый «якорь» итоговой оценки для компактного списка предметов.
 *
 * Принимает уже подготовленную строку (выход `getTotalDisplayValue`):
 *  - "78"            → 78%, цвет по `getGradeTone`
 *  - "-" / "—" / ""  → серый "—" без заливки
 *  - "?"             → серый "?", прогресс не рисуем (итог ещё не известен),
 *                      title/aria-label объясняют почему
 *  - "Недоп."        → красный, в кольце "✕", title/aria-label — полный текст
 *  - "Допуск"        → зелёный/нейтральный, в кольце "✓", title/aria-label — полный текст
 *  - другой текст    → серый "—", title/aria-label — исходный текст целиком
 *    (никогда не обрезаем произвольный текст до пары символов)
 *
 * Никакой фейковой цифры: если значение не числовое — кольцо без прогресса.
 */
export function GradeScoreRing({
    value,
    size = 56,
    strokeWidth = 5,
}: {
    value: string;
    size?: number;
    strokeWidth?: number;
}) {
    const { messages } = useLanguage();
    const trimmed = value?.trim() ?? '';
    const parsed = Number.parseFloat(trimmed.replace(',', '.'));
    const isNumber = !Number.isNaN(parsed);

    let displayText: string;
    let explanation: string | undefined;
    if (trimmed === '' || trimmed === '-' || trimmed === '—') {
        displayText = '—';
    } else if (trimmed === '?') {
        displayText = '?';
        explanation = messages.grades.examPendingHint;
    } else if (isNumber) {
        displayText = Math.round(parsed).toString();
    } else {
        // Текстовый статус ("Недоп.", "Допуск" и т. п.) — глиф + полный текст в title/aria-label.
        const normalized = trimmed.toLowerCase();
        const isNotAdmitted = normalized.includes('недоп') || normalized.includes('nedop') || normalized.includes('not admitted');
        const isAdmitted = !isNotAdmitted && (normalized.includes('допуск') || normalized.includes('admit'));
        if (isNotAdmitted) {
            displayText = '✕';
            explanation = messages.grades.ringNotAdmitted;
        } else if (isAdmitted) {
            displayText = '✓';
            explanation = messages.grades.ringAdmitted;
        } else {
            displayText = '—';
            explanation = trimmed;
        }
    }

    const tone = getGradeTone(trimmed === '' ? '-' : trimmed);
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = isNumber ? Math.max(0, Math.min(100, parsed)) : 0;
    const dashOffset = circumference - (progress / 100) * circumference;
    const ariaLabel = isNumber ? `${displayText}/100` : (explanation ?? displayText);

    return (
        <div
            className="grade-score-ring"
            style={{
                width: size,
                height: size,
                ['--tone-border' as string]: tone.border,
                ['--tone-bg' as string]: tone.bg,
                ['--tone-color' as string]: tone.color,
            }}
            aria-label={ariaLabel}
            title={!isNumber ? explanation : undefined}
            role="img"
        >
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                className="grade-score-ring-svg"
                aria-hidden
            >
                <circle
                    className="grade-score-ring-track"
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    strokeWidth={strokeWidth}
                    fill="none"
                />
                {isNumber ? (
                    <circle
                        className="grade-score-ring-progress"
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    />
                ) : null}
            </svg>
            <span className="grade-score-ring-label">{displayText}</span>
        </div>
    );
}
