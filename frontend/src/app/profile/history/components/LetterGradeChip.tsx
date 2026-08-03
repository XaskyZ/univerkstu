import type { CSSProperties } from 'react';
import { letterGradeTone, type LetterGradeTone } from '../history-i18n';

interface LetterGradeChipProps {
    letter: string | null | undefined;
    placeholder?: string;
}

/**
 * Tiny pill that colours a letter grade using the project's semantic status
 * vars. Used in both Recbook and Transcript tables so a student can scan a
 * long list and immediately see where the weak spots are.
 */
export function LetterGradeChip({ letter, placeholder = '—' }: LetterGradeChipProps) {
    const tone = letterGradeTone(letter);
    const style = toneStyle(tone);

    return (
        <span
            className="inline-flex items-center justify-center rounded-full"
            style={{
                ...style,
                minWidth: '2.25rem',
                padding: '2px 8px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: 1.2,
            }}
        >
            {letter && letter.trim() ? letter : placeholder}
        </span>
    );
}

function toneStyle(tone: LetterGradeTone): CSSProperties {
    switch (tone) {
        case 'success':
            return {
                background: 'var(--status-success-bg)',
                color: 'var(--status-success-color)',
                border: '1px solid var(--status-success-border)',
            };
        case 'info':
            return {
                background: 'var(--status-info-bg)',
                color: 'var(--status-info-color)',
                border: '1px solid var(--status-info-border)',
            };
        case 'warning':
            return {
                background: 'var(--status-warning-bg)',
                color: 'var(--status-warning-color)',
                border: '1px solid var(--status-warning-border)',
            };
        case 'danger':
            return {
                background: 'var(--status-danger-bg)',
                color: 'var(--status-danger-color)',
                border: '1px solid var(--status-danger-border)',
            };
        case 'muted':
        default:
            return {
                background: 'var(--surface-overlay-2)',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
            };
    }
}
