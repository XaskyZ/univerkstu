'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import { getMyFeedbackRating, submitAppFeedback, submitAppRating } from '@/lib/api';

type FeedbackCategory = 'suggestion' | 'bug' | 'other';

const MAX_MESSAGE_LENGTH = 4000;
const MIN_MESSAGE_LENGTH = 3;

/**
 * Feedback sub-screen.
 *
 * Hosts the interactive 1-5 star rating (saves immediately on click) and a
 * separate message form (category + textarea) that posts via
 * `POST /api/v3/feedback/message`.
 */
export default function SettingsFeedbackPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const text = messages.settings.feedback;

    const [rating, setRating] = useState<number | null>(null);
    const [ratingLoading, setRatingLoading] = useState(true);
    const [ratingSaving, setRatingSaving] = useState(false);
    const [ratingHover, setRatingHover] = useState<number | null>(null);
    const [ratingStatus, setRatingStatus] = useState<string | null>(null);
    const [ratingError, setRatingError] = useState(false);

    const [category, setCategory] = useState<FeedbackCategory>('suggestion');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const result = await getMyFeedbackRating();
            if (cancelled) return;
            if (result.success && result.data) {
                setRating(result.data.rating);
            }
            setRatingLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const trimmedMessage = message.trim();
    const messageValid = trimmedMessage.length >= MIN_MESSAGE_LENGTH;

    const categoryOptions = useMemo<{ value: FeedbackCategory; label: string }[]>(
        () => [
            { value: 'suggestion', label: text.categorySuggestion },
            { value: 'bug', label: text.categoryBug },
            { value: 'other', label: text.categoryOther },
        ],
        [text.categorySuggestion, text.categoryBug, text.categoryOther],
    );

    if (loading || !isAuth) return null;

    const appVersion = 'v4.1.33';
    const currentPage = '/settings/feedback';

    const handleStarClick = async (value: number) => {
        if (ratingSaving) return;
        const previous = rating;
        setRating(value);
        setRatingSaving(true);
        setRatingStatus(null);
        setRatingError(false);

        const result = await submitAppRating(value, currentPage, appVersion);
        setRatingSaving(false);

        if (result.success) {
            setRatingStatus(previous == null ? text.saved : text.updated);
            setRatingError(false);
        } else {
            setRating(previous);
            setRatingStatus(result.error || text.saveFailed);
            setRatingError(true);
        }
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting || !messageValid) return;
        setSubmitting(true);
        setSubmitStatus(null);
        setSubmitError(false);

        const result = await submitAppFeedback(
            category,
            trimmedMessage,
            rating,
            currentPage,
            appVersion,
        );
        setSubmitting(false);

        if (result.success) {
            setSubmitted(true);
            setSubmitStatus(text.sent);
            setSubmitError(false);
            setMessage('');
        } else {
            setSubmitStatus(result.error || text.sendFailed);
            setSubmitError(true);
        }
    };

    const renderStar = (index: number) => {
        const starValue = index + 1;
        const activeValue = ratingHover ?? rating ?? 0;
        const active = starValue <= activeValue;
        return (
            <button
                key={starValue}
                type="button"
                onClick={() => handleStarClick(starValue)}
                onMouseEnter={() => setRatingHover(starValue)}
                onMouseLeave={() => setRatingHover(null)}
                onFocus={() => setRatingHover(starValue)}
                onBlur={() => setRatingHover(null)}
                aria-label={text.rateAria.replace('{star}', String(starValue))}
                aria-pressed={rating === starValue}
                disabled={ratingSaving}
                style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: ratingSaving ? 'not-allowed' : 'pointer',
                    padding: '6px',
                    color: active ? 'var(--accent)' : 'var(--muted)',
                    transition: 'transform 0.15s ease, color 0.15s ease',
                }}
            >
                <Star
                    className="w-8 h-8"
                    aria-hidden
                    fill={active ? 'currentColor' : 'none'}
                    strokeWidth={2}
                />
            </button>
        );
    };

    return (
        <PageShell>
            <SubScreenHeader
                title={text.screenTitle}
                subtitle={text.screenSubtitle}
            />
            <PageMain className="space-y-4" spacing="lg">
                <section className="card p-5 sm:p-6 space-y-3">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {text.empty}
                    </p>
                    <div className="flex items-center gap-1" role="group" aria-label={text.rateAria.replace('{star}', '1-5')}>
                        {[0, 1, 2, 3, 4].map(renderStar)}
                    </div>
                    {ratingLoading ? (
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>
                            {text.loading}
                        </p>
                    ) : rating != null ? (
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>
                            {text.current.replace('{rating}', String(rating))}
                        </p>
                    ) : null}
                    {ratingStatus ? (
                        <p
                            className="text-xs"
                            role={ratingError ? 'alert' : 'status'}
                            style={{ color: ratingError ? 'var(--danger)' : 'var(--success, #22c55e)' }}
                        >
                            {ratingStatus}
                        </p>
                    ) : null}
                </section>

                <section className="card p-5 sm:p-6">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <span className="text-sm font-medium block" style={{ color: 'var(--text)' }}>
                                {text.type}
                            </span>
                            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={text.type}>
                                {categoryOptions.map((option) => {
                                    const selected = category === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            onClick={() => setCategory(option.value)}
                                            style={{
                                                padding: '8px 14px',
                                                borderRadius: '999px',
                                                border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                                                background: selected ? 'rgba(var(--primary-rgb), 0.12)' : 'var(--surface-overlay-1, var(--card))',
                                                color: selected ? 'var(--primary)' : 'var(--text)',
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
                                            }}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label
                                htmlFor="settings-feedback-message"
                                className="text-sm font-medium block"
                                style={{ color: 'var(--text)' }}
                            >
                                {text.message}
                            </label>
                            <textarea
                                id="settings-feedback-message"
                                value={message}
                                onChange={(event) => {
                                    setMessage(event.target.value);
                                    if (submitted) {
                                        setSubmitted(false);
                                        setSubmitStatus(null);
                                    }
                                }}
                                placeholder={text.placeholder}
                                maxLength={MAX_MESSAGE_LENGTH}
                                rows={5}
                                className="input"
                                style={{ resize: 'vertical', minHeight: '120px' }}
                            />
                            <div
                                className="flex items-center justify-end text-xs"
                                style={{ color: 'var(--muted)' }}
                            >
                                <span>
                                    {message.length} / {MAX_MESSAGE_LENGTH}
                                </span>
                            </div>
                        </div>

                        {submitStatus ? (
                            <p
                                className="text-sm"
                                role={submitError ? 'alert' : 'status'}
                                style={{ color: submitError ? 'var(--danger)' : 'var(--success, #22c55e)' }}
                            >
                                {submitStatus}
                            </p>
                        ) : null}

                        <button
                            type="submit"
                            disabled={submitting || !messageValid}
                            className="btn btn-primary w-full py-3 text-base disabled:opacity-50"
                        >
                            {submitting ? text.sending : text.send}
                        </button>
                    </form>
                </section>

                <p
                    className="text-xs text-center px-2"
                    style={{ color: 'var(--muted)' }}
                >
                    {text.calm}
                </p>
            </PageMain>
        </PageShell>
    );
}
