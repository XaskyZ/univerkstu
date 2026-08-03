'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { changePassword } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';

const MIN_NEW_PASSWORD_LENGTH = 6;

type FieldKey = 'current' | 'new' | 'repeat';

type PasswordChangeFormProps = {
    onSuccess?: () => void;
};

/**
 * Stand-alone password change form. Mounted by `/settings/password`.
 *
 * Logic mirrors the old `SettingsPasswordCard`; presentation is restyled
 * to live on its own page (no card chrome, vertical breathing room, sticky-ish
 * submit at the bottom for mobile thumb reach).
 */
export function PasswordChangeForm({ onSuccess }: PasswordChangeFormProps) {
    const { messages } = useLanguage();
    const text = messages.settings.password;

    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [repeat, setRepeat] = useState('');
    const [visible, setVisible] = useState<Record<FieldKey, boolean>>({
        current: false,
        new: false,
        repeat: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState('');
    const [statusIsError, setStatusIsError] = useState(false);

    const toggleVisibility = (field: FieldKey) =>
        setVisible((prev) => ({ ...prev, [field]: !prev[field] }));

    const reset = () => {
        setCurrent('');
        setNext('');
        setRepeat('');
    };

    const setError = (message: string) => {
        setStatus(message);
        setStatusIsError(true);
    };

    const setOk = (message: string) => {
        setStatus(message);
        setStatusIsError(false);
    };

    const mapErrorCode = (code?: string): string => {
        switch (code) {
            case 'AUTH_INVALID_CURRENT_PASSWORD':
                return text.errorInvalidCurrent;
            case 'AUTH_CHANGE_PASSWORD_UPSTREAM':
                return text.errorUpstream;
            case 'AUTH_CHANGE_PASSWORD_NOT_APPLIED':
                return text.errorNotApplied;
            case 'AUTH_CHANGE_PASSWORD_RATE_LIMITED':
                return text.errorRateLimited;
            case 'AUTH_CHANGE_PASSWORD_SAME':
                return text.errorSame;
            case 'AUTH_CHANGE_PASSWORD_VALIDATION':
                return text.errorShort;
            default:
                return text.errorGeneric;
        }
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;

        // Local validation (mirror of backend rules; backend remains source of truth).
        if (!current || !next || !repeat) {
            setError(text.errorRequired);
            return;
        }
        if (next.length < MIN_NEW_PASSWORD_LENGTH) {
            setError(text.errorShort);
            return;
        }
        if (next !== repeat) {
            setError(text.errorMismatch);
            return;
        }
        if (next === current) {
            setError(text.errorSame);
            return;
        }

        setSubmitting(true);
        setStatus('');
        const result = await changePassword(current, next);
        setSubmitting(false);

        if (result.success) {
            reset();
            setOk(text.success);
            onSuccess?.();
            return;
        }

        // Prefer mapped errorCode; fall back to server-provided error string.
        const mapped = result.errorCode ? mapErrorCode(result.errorCode) : null;
        setError(mapped || result.error || text.errorGeneric);
    };

    const inputStyle = {
        background: 'var(--bg)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
    } as const;

    const renderField = (
        field: FieldKey,
        label: string,
        placeholder: string,
        value: string,
        onChange: (value: string) => void,
        autoComplete: string,
    ) => (
        <label className="block">
            <span className="text-sm mb-2 block font-medium text-fg">{label}</span>
            <div className="relative">
                <input
                    type={visible[field] ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    maxLength={1024}
                    className="w-full px-4 py-3.5 pr-12 rounded-xl text-base outline-none"
                    style={inputStyle}
                />
                <button
                    type="button"
                    onClick={() => toggleVisibility(field)}
                    aria-label={visible[field] ? text.hide : text.show}
                    className="absolute inset-y-0 right-2 my-auto w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ color: 'var(--muted)' }}
                >
                    {visible[field]
                        ? <EyeOff className="w-5 h-5" strokeWidth={2} aria-hidden />
                        : <Eye className="w-5 h-5" strokeWidth={2} aria-hidden />}
                </button>
            </div>
        </label>
    );

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div
                className="rounded-2xl px-4 py-3 text-sm"
                style={{
                    background: 'var(--surface-overlay-1)',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                }}
            >
                {text.requirementsHint}
            </div>

            <div className="space-y-4">
                {renderField('current', text.currentLabel, text.placeholderCurrent, current, setCurrent, 'current-password')}
                {renderField('new', text.newLabel, text.placeholderNew, next, setNext, 'new-password')}
                {renderField('repeat', text.repeatLabel, text.placeholderRepeat, repeat, setRepeat, 'new-password')}
            </div>

            {status ? (
                <p
                    className="text-sm"
                    style={{ color: statusIsError ? 'var(--danger)' : 'var(--success, #22c55e)' }}
                    role={statusIsError ? 'alert' : 'status'}
                >
                    {status}
                </p>
            ) : null}

            <div className="pt-2">
                <button
                    type="submit"
                    disabled={submitting || !current || !next || !repeat}
                    className="btn btn-primary w-full py-3 text-base disabled:opacity-50"
                >
                    {submitting ? text.submitting : text.submit}
                </button>
            </div>
        </form>
    );
}
