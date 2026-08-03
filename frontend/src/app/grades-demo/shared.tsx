import type { CSSProperties } from 'react';
import type { FakeSubject, LetterGrade, SubjectStatus } from './data';
import { getLetterTone, getScoreTone } from './data';

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export const statusLabel = (s: SubjectStatus): string => {
    switch (s) {
        case 'passed': return 'Сдан';
        case 'ok': return 'В норме';
        case 'at-risk': return 'Под угрозой';
        case 'blocked': return 'Недоп.';
        case 'pending': return 'Ожидается';
    }
};

export const toneVars = (tone: Tone) => {
    switch (tone) {
        case 'success':
            return { bg: 'var(--status-success-bg)', color: 'var(--status-success-color)', border: 'var(--status-success-border)' };
        case 'info':
            return { bg: 'var(--status-info-bg)', color: 'var(--status-info-color)', border: 'var(--status-info-border)' };
        case 'warning':
            return { bg: 'var(--status-warning-bg)', color: 'var(--status-warning-color)', border: 'var(--status-warning-border)' };
        case 'danger':
            return { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-color)', border: 'var(--status-danger-border)' };
        case 'neutral':
            return { bg: 'var(--surface-overlay-1)', color: 'var(--muted)', border: 'var(--border)' };
    }
};

export const statusTone = (s: SubjectStatus): Tone => {
    switch (s) {
        case 'passed': return 'success';
        case 'ok': return 'info';
        case 'at-risk': return 'danger';
        case 'blocked': return 'danger';
        case 'pending': return 'warning';
    }
};

export const statusVars = (s: SubjectStatus) => toneVars(statusTone(s));
export const scoreTone = getScoreTone;
export const letterTone = getLetterTone;

export function StatusDot({ status }: { status: SubjectStatus }) {
    const { color } = statusVars(status);
    return (
        <span
            aria-hidden
            style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 999,
                background: color,
                boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)`,
                flexShrink: 0,
            }}
        />
    );
}

export function GradePill({ value, status }: { value: number | null; status: SubjectStatus }) {
    const { bg, color, border } = statusVars(status);
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 44,
                padding: '4px 10px',
                borderRadius: 999,
                background: bg,
                color,
                border: `1px solid ${border}`,
                fontWeight: 700,
                fontSize: 13,
            }}
        >
            {value ?? '—'}
        </span>
    );
}

export function LetterPill({ letter, size = 'md' }: { letter: LetterGrade; size?: 'sm' | 'md' | 'lg' }) {
    const { bg, color, border } = toneVars(letterTone(letter));
    const dim = size === 'lg' ? { font: 22, pad: '6px 12px', min: 48 }
        : size === 'sm' ? { font: 11, pad: '2px 6px', min: 28 }
            : { font: 14, pad: '3px 8px', min: 34 };
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: dim.min,
                padding: dim.pad,
                borderRadius: 8,
                background: bg,
                color,
                border: `1px solid ${border}`,
                fontWeight: 800,
                fontSize: dim.font,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
            }}
        >
            {letter}
        </span>
    );
}

export function StatusBadge({ status, size = 'md' }: { status: SubjectStatus; size?: 'sm' | 'md' }) {
    const { bg, color, border } = statusVars(status);
    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: size === 'sm' ? '2px 6px' : '3px 8px',
            background: bg,
            color,
            border: `1px solid ${border}`,
            borderRadius: 6,
            fontSize: size === 'sm' ? 10 : 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
        }}>
            <StatusDot status={status} />
            {statusLabel(status)}
        </span>
    );
}

export function MetricRow({ label, value, mono = false, tone, style }: {
    label: string;
    value: React.ReactNode;
    mono?: boolean;
    tone?: Tone;
    style?: CSSProperties;
}) {
    const color = tone ? toneVars(tone).color : 'var(--text)';
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
            padding: '4px 0',
            fontSize: 13,
            ...style,
        }}>
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <span style={{
                color,
                fontWeight: 600,
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit',
                fontVariantNumeric: 'tabular-nums',
            }}>{value}</span>
        </div>
    );
}

export function ScoreCell({ value, label }: { value: number | null; label?: string }) {
    const tone = scoreTone(value);
    const { color, bg, border } = toneVars(tone);
    return (
        <div style={{
            padding: '6px 8px',
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 8,
            textAlign: 'center',
            minWidth: 48,
        }}>
            {label ? (
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            ) : null}
            <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                {value ?? '—'}
            </div>
        </div>
    );
}

export function CreditChip({ credits, hours }: { credits: number; hours?: number }) {
    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: 'var(--surface-overlay-1)',
            color: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
        }}>
            {credits} кр
            {hours ? <span style={{ opacity: 0.7 }}>· {hours}ч</span> : null}
        </span>
    );
}

export function formatDate(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export function formatDateTime(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function subjectShortType(s: FakeSubject): string {
    if (s.kind === 'coursework') return 'Курсовая';
    if (s.kind === 'practice') return 'Практика';
    return 'Предмет';
}
