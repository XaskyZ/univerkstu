'use client';

const PENDING_REFERRAL_CODE_KEY = 'app-referral-pending-v1';

export function normalizeReferralCode(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export function getPendingReferralCode(): string {
    if (typeof window === 'undefined') return '';
    return normalizeReferralCode(localStorage.getItem(PENDING_REFERRAL_CODE_KEY) || '');
}

export function setPendingReferralCode(value: unknown): string {
    if (typeof window === 'undefined') return '';
    const normalized = normalizeReferralCode(value);
    if (!normalized) {
        localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
        return '';
    }
    localStorage.setItem(PENDING_REFERRAL_CODE_KEY, normalized);
    return normalized;
}

export function clearPendingReferralCode(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
}
