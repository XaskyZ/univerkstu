import type { CSSProperties } from 'react';
import type { TeacherTier } from '@/lib/api';

export const surfaceBoxStyle: CSSProperties = {
    borderRadius: '24px',
    border: '1px solid var(--leaderboard-surface-border)',
    background: 'var(--leaderboard-surface-bg)',
    padding: '18px',
    boxShadow: 'var(--leaderboard-surface-shadow)',
};

export const tinyCapsStyle: CSSProperties = {
    color: 'var(--leaderboard-muted)',
    fontSize: '11px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 700,
};

export const darkInputStyle: CSSProperties = {
    color: 'var(--leaderboard-text)',
    background: 'var(--leaderboard-input-bg)',
    border: '1px solid var(--leaderboard-input-border)',
};

export const gradientButtonStyle: CSSProperties = {
    background: 'linear-gradient(135deg, #60a5fa, #8b5cf6)',
    minWidth: '180px',
    boxShadow: '0 18px 34px rgba(96,165,250,0.26)',
};

export const secondaryButtonStyle: CSSProperties = {
    borderRadius: '16px',
    border: '1px solid var(--leaderboard-secondary-button-border)',
    background: 'var(--leaderboard-secondary-button-bg)',
    color: 'var(--leaderboard-secondary-button-color)',
    padding: '12px 18px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    minWidth: '180px',
    boxShadow: '0 16px 34px rgba(99,102,241,0.16)',
};

export const rankBubbleStyle: CSSProperties = {
    width: '38px',
    height: '38px',
    borderRadius: '999px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--leaderboard-rank-bubble-bg)',
    color: 'var(--leaderboard-rank-bubble-color)',
    fontSize: '12px',
    fontWeight: 800,
    flexShrink: 0,
};

export const hintChipStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '999px',
    background: 'var(--leaderboard-chip-bg)',
    border: '1px solid var(--leaderboard-chip-border)',
    color: 'var(--leaderboard-chip-color)',
    fontSize: '11px',
    fontWeight: 700,
};

export const miniMutedStyle: CSSProperties = {
    color: 'var(--leaderboard-muted)',
    fontSize: '12px',
};

export const dropdownStyle: CSSProperties = {
    borderRadius: '20px',
    border: '1px solid var(--leaderboard-surface-border)',
    background: 'var(--leaderboard-dropdown-bg)',
    boxShadow: 'var(--leaderboard-dropdown-shadow)',
    overflow: 'hidden',
};

export const dropdownItemMutedStyle: CSSProperties = {
    padding: '14px 16px',
    color: 'var(--leaderboard-dropdown-muted)',
    fontSize: '13px',
};

export const dropdownButtonStyle: CSSProperties = {
    width: '100%',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '14px',
    padding: '14px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--leaderboard-surface-border)',
    cursor: 'pointer',
};

export function tierButtonStyle(tier: TeacherTier, active: boolean): CSSProperties {
    const palette = {
        S: ['rgba(34,197,94,0.16)', '#bbf7d0', 'rgba(34,197,94,0.32)'],
        A: ['rgba(16,185,129,0.14)', '#a7f3d0', 'rgba(16,185,129,0.3)'],
        B: ['var(--leaderboard-tier-b-bg)', 'var(--leaderboard-tier-b-color)', 'var(--leaderboard-tier-b-border)'],
        C: ['rgba(249,115,22,0.14)', '#fdba74', 'rgba(249,115,22,0.3)'],
        D: ['rgba(var(--status-danger-rgb), 0.14)', '#fca5a5', 'rgba(var(--status-danger-rgb), 0.3)'],
        E: ['rgba(190,24,93,0.16)', '#f9a8d4', 'rgba(190,24,93,0.3)'],
        F: ['var(--leaderboard-pill-bg)', 'var(--leaderboard-text)', 'var(--leaderboard-surface-border)'],
    }[tier];
    return {
        borderRadius: '999px',
        border: `1px solid ${palette[2]}`,
        background: active ? palette[0] : 'var(--leaderboard-pill-bg)',
        color: active ? palette[1] : 'var(--leaderboard-pill-color)',
        padding: '10px 15px',
        fontSize: '13px',
        fontWeight: 800,
        cursor: 'pointer',
        minWidth: '74px',
    };
}

export function tagChipStyle(active: boolean): CSSProperties {
    return {
        borderRadius: '999px',
        border: active ? '1px solid rgba(96,165,250,0.42)' : '1px solid rgba(148,163,184,0.14)',
        background: active ? 'rgba(96,165,250,0.16)' : 'var(--leaderboard-chip-bg)',
        color: active ? 'var(--primary)' : 'var(--leaderboard-chip-color)',
        padding: '8px 12px',
        fontSize: '12px',
        fontWeight: 700,
        cursor: 'pointer',
    };
}

export function teacherRowButtonStyle(active: boolean): CSSProperties {
    return {
        width: '100%',
        textAlign: 'left',
        borderRadius: '22px',
        border: active ? '1px solid rgba(96,165,250,0.34)' : '1px solid var(--leaderboard-surface-border)',
        background: active ? 'var(--leaderboard-row-active-bg)' : 'var(--leaderboard-row-bg)',
        padding: '16px',
        cursor: 'pointer',
        transition: 'all 160ms ease',
    };
}
