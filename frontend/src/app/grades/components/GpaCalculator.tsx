'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFromCache } from '@/lib/cache';
import { useLanguage } from '@/lib/language-context';
import { confirmDialog } from '@/lib/confirm-dialog';
import { toast } from '@/lib/toast';
import {
    type PlatonusGradesData,
    type PlatonusSubjectGrade,
} from '@/lib/api';
import {
    getInitialSemesterSelection,
    getCachedPlatonusStatus,
    getDefaultSemesters,
    gradesCacheKey,
    parseScoreValue,
} from '../utils/grades-helpers';
import {
    DEFAULT_WEIGHTS,
    SCORE_MAX,
    SCORE_MIN,
    computeGpaSummary,
    type GpaSubjectInput,
    type GpaSubjectWeights,
} from '../utils/gpa-calculator';

const DRAFT_STORAGE_KEY = 'gpa-calculator-draft-v1';

interface DraftSubject {
    id: string;
    name: string;
    rk1: string;
    rk2: string;
    final: string;
    weights: GpaSubjectWeights;
}

interface Draft {
    subjects: DraftSubject[];
}

function makeId(): string {
    // Deterministic-enough for list keys; we don't persist these IDs anywhere
    // beyond a single localStorage draft, so `Math.random` is fine.
    return `gpa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySubject(): DraftSubject {
    return {
        id: makeId(),
        name: '',
        rk1: '',
        rk2: '',
        final: '',
        weights: { ...DEFAULT_WEIGHTS },
    };
}

function parseScoreInput(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed.replace(',', '.'));
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

function isOutOfRange(raw: string): boolean {
    const value = parseScoreInput(raw);
    if (value === null) return false;
    return value < SCORE_MIN || value > SCORE_MAX;
}

function loadDraft(): Draft | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<Draft>;
        if (!parsed || !Array.isArray(parsed.subjects)) return null;
        const subjects = parsed.subjects
            .filter((s): s is DraftSubject => Boolean(s) && typeof s === 'object')
            .map((s) => ({
                id: typeof s.id === 'string' && s.id.length > 0 ? s.id : makeId(),
                name: typeof s.name === 'string' ? s.name : '',
                rk1: typeof s.rk1 === 'string' ? s.rk1 : '',
                rk2: typeof s.rk2 === 'string' ? s.rk2 : '',
                final: typeof s.final === 'string' ? s.final : '',
                weights:
                    s.weights && typeof s.weights === 'object'
                        ? {
                            rk1: typeof s.weights.rk1 === 'number' ? s.weights.rk1 : DEFAULT_WEIGHTS.rk1,
                            rk2: typeof s.weights.rk2 === 'number' ? s.weights.rk2 : DEFAULT_WEIGHTS.rk2,
                            final: typeof s.weights.final === 'number' ? s.weights.final : DEFAULT_WEIGHTS.final,
                        }
                        : { ...DEFAULT_WEIGHTS },
            }));
        return { subjects };
    } catch {
        return null;
    }
}

function saveDraft(draft: Draft): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
        // localStorage may be full or unavailable — silent drop is fine
        // because the calculator still works in-memory.
    }
}

function clearDraft(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
        // ignore
    }
}

/**
 * Read the most recent cached Platonus grades for the user's current/preferred
 * semester. Returns `null` when the user hasn't connected Platonus yet or
 * hasn't opened the Grades page in this browser before.
 */
function readCachedGradesForCurrentSemester(): PlatonusGradesData | null {
    if (typeof window === 'undefined') return null;
    const cachedStatus = getCachedPlatonusStatus();
    const semesters = cachedStatus?.availableSemesters?.length
        ? cachedStatus.availableSemesters
        : null;
    // We pass an empty fallback because `getInitialSemesterSelection` uses the
    // default semester list only when no cached status exists. When we don't
    // have either, there's no useful prefill.
    if (!semesters) return null;
    // `getDefaultSemesters` needs a messages object, but here we only use the
    // result via `getInitialSemesterSelection`, which respects cached
    // `availableSemesters` first. Pass a minimal stub.
    const stubMessages = {
        grades: {
            semesterFormat: '{start}/{end} — {season}',
            spring: 'Spring',
            autumn: 'Autumn',
        },
    } as unknown as Parameters<typeof getDefaultSemesters>[0];
    const initial = getInitialSemesterSelection(getDefaultSemesters(stubMessages));
    return getFromCache<PlatonusGradesData>(gradesCacheKey(initial.year, initial.semester));
}

function extractScore(raw?: string | null): string {
    const parsed = parseScoreValue(raw ?? '');
    if (parsed.kind === 'number' && parsed.value !== null) {
        // Preserve integers vs decimals from the source — Platonus tends to
        // give ints, but a couple of subjects come in as `87.5`.
        return Number.isInteger(parsed.value) ? String(parsed.value) : parsed.value.toFixed(1);
    }
    return '';
}

function toCalcSubject(subject: PlatonusSubjectGrade): DraftSubject {
    return {
        id: makeId(),
        name: subject.name || '',
        rk1: extractScore(subject.rk1),
        rk2: extractScore(subject.rk2),
        final: extractScore(subject.exam),
        weights: { ...DEFAULT_WEIGHTS },
    };
}

function formatNumber(value: number | null, fractionDigits = 2): string {
    if (value === null) return '—';
    return value.toFixed(fractionDigits);
}

export function GpaCalculator() {
    const { messages } = useLanguage();
    const copy = messages.gradeCalculator;

    const [subjects, setSubjects] = useState<DraftSubject[]>(() => {
        const stored = loadDraft();
        if (stored && stored.subjects.length > 0) return stored.subjects;
        return [createEmptySubject()];
    });

    // Persist on every change. We intentionally skip throttling — the writes
    // are tiny and there's no realistic typing storm here.
    useEffect(() => {
        saveDraft({ subjects });
    }, [subjects]);

    const handleNameChange = useCallback((id: string, name: string) => {
        setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    }, []);

    const handleScoreChange = useCallback(
        (id: string, field: 'rk1' | 'rk2' | 'final', raw: string) => {
            setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: raw } : s)));
        },
        []
    );

    const handleWeightChange = useCallback(
        (id: string, field: keyof GpaSubjectWeights, raw: string) => {
            const next = Number.parseFloat(raw.replace(',', '.'));
            const safe = Number.isFinite(next) && next >= 0 && next <= 1 ? next : DEFAULT_WEIGHTS[field];
            setSubjects((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? { ...s, weights: { ...s.weights, [field]: safe } }
                        : s
                )
            );
        },
        []
    );

    const handleAddSubject = useCallback(() => {
        setSubjects((prev) => [...prev, createEmptySubject()]);
    }, []);

    const handleRemoveSubject = useCallback((id: string) => {
        setSubjects((prev) => {
            const next = prev.filter((s) => s.id !== id);
            return next.length > 0 ? next : [createEmptySubject()];
        });
    }, []);

    const handleClear = useCallback(async () => {
        if (!(await confirmDialog(copy.clearConfirm, { danger: true }))) return;
        clearDraft();
        setSubjects([createEmptySubject()]);
    }, [copy.clearConfirm]);

    const cachedGrades = useMemo<PlatonusGradesData | null>(() => readCachedGradesForCurrentSemester(), []);

    const handleFillFromGrades = useCallback(() => {
        if (!cachedGrades || cachedGrades.subjects.length === 0) {
            toast.info(copy.fillFromMyGradesEmpty);
            return;
        }
        const next: DraftSubject[] = cachedGrades.subjects.map(toCalcSubject);
        setSubjects(next.length > 0 ? next : [createEmptySubject()]);
    }, [cachedGrades, copy.fillFromMyGradesEmpty]);

    const calcInputs: GpaSubjectInput[] = useMemo(
        () =>
            subjects.map((s) => ({
                id: s.id,
                name: s.name,
                rk1: parseScoreInput(s.rk1),
                rk2: parseScoreInput(s.rk2),
                final: parseScoreInput(s.final),
                weights: s.weights,
            })),
        [subjects]
    );

    const summary = useMemo(() => computeGpaSummary(calcInputs), [calcInputs]);

    return (
        <div className="space-y-4">
            <section className="card p-5 space-y-2">
                <h2
                    className="text-lg font-semibold"
                    style={{ color: 'var(--text)' }}
                >
                    {copy.title}
                </h2>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {copy.description}
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleFillFromGrades}
                    >
                        {copy.fillFromMyGrades}
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleClear}
                    >
                        {copy.clear}
                    </button>
                </div>
            </section>

            <section className="card p-5 space-y-3">
                <h3
                    className="text-base font-semibold"
                    style={{ color: 'var(--text)' }}
                >
                    {copy.summaryTitle}
                </h3>
                {summary.averageTotal === null || summary.averageGpa === null ? (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                        {copy.notEnoughData}
                    </p>
                ) : (
                    <SummaryRow
                        averageTotal={summary.averageTotal}
                        averageGpa={summary.averageGpa}
                        labelTotal={copy.averageTotal}
                        labelGpa={copy.averageGpa}
                    />
                )}
            </section>

            <section className="space-y-3">
                {subjects.map((subject, index) => (
                    <SubjectCard
                        key={subject.id}
                        subject={subject}
                        index={index}
                        result={summary.subjects[index]}
                        copy={copy}
                        onNameChange={handleNameChange}
                        onScoreChange={handleScoreChange}
                        onWeightChange={handleWeightChange}
                        onRemove={handleRemoveSubject}
                    />
                ))}

                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAddSubject}
                    style={{ width: '100%' }}
                >
                    {copy.addSubject}
                </button>
            </section>
        </div>
    );
}

function SummaryRow({
    averageTotal,
    averageGpa,
    labelTotal,
    labelGpa,
}: {
    averageTotal: number;
    averageGpa: number;
    labelTotal: string;
    labelGpa: string;
}) {
    return (
        <div className="flex flex-wrap gap-4">
            <SummaryStat label={labelTotal} value={formatNumber(averageTotal, 2)} />
            <SummaryStat label={labelGpa} value={formatNumber(averageGpa, 2)} />
        </div>
    );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
    return (
        <div
            className="px-4 py-3 rounded-lg"
            style={{
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
                minWidth: '140px',
            }}
        >
            <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                {label}
            </div>
            <div
                className="text-2xl font-semibold"
                style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
            >
                {value}
            </div>
        </div>
    );
}

interface SubjectCardCopy {
    rk1: string;
    rk2: string;
    final: string;
    weight: string;
    weightHint: string;
    result: string;
    totalScore: string;
    letterGrade: string;
    gpa: string;
    subjectNamePlaceholder: string;
    subjectNumberPrefix: string;
    removeSubject: string;
    validationRange: string;
    scorePlaceholder: string;
    weightsSumHint: string;
    notEnoughData: string;
}

function SubjectCard({
    subject,
    index,
    result,
    copy,
    onNameChange,
    onScoreChange,
    onWeightChange,
    onRemove,
}: {
    subject: DraftSubject;
    index: number;
    result: { total: number | null; letter: string; gpa: number | null } | undefined;
    copy: SubjectCardCopy;
    onNameChange: (id: string, name: string) => void;
    onScoreChange: (id: string, field: 'rk1' | 'rk2' | 'final', raw: string) => void;
    onWeightChange: (id: string, field: keyof GpaSubjectWeights, raw: string) => void;
    onRemove: (id: string) => void;
}) {
    const weightSum = subject.weights.rk1 + subject.weights.rk2 + subject.weights.final;
    const weightSumOk = Math.abs(weightSum - 1) < 1e-6;
    const total = result?.total ?? null;
    const letter = result?.letter ?? '—';
    const gpa = result?.gpa ?? null;
    const letterTone = letterGradeTone(letter);

    return (
        <article className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <span
                    className="text-xs uppercase tracking-wide"
                    style={{ color: 'var(--muted)' }}
                >
                    {`${copy.subjectNumberPrefix} ${index + 1}`}
                </span>
                <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onRemove(subject.id)}
                    aria-label={copy.removeSubject}
                    style={{ padding: '4px 10px', fontSize: '13px' }}
                >
                    {copy.removeSubject}
                </button>
            </div>

            <input
                type="text"
                className="input"
                placeholder={copy.subjectNamePlaceholder}
                value={subject.name}
                onChange={(e) => onNameChange(subject.id, e.target.value)}
                autoCapitalize="sentences"
                spellCheck={false}
            />

            <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            >
                <ScoreField
                    label={copy.rk1}
                    value={subject.rk1}
                    onChange={(v) => onScoreChange(subject.id, 'rk1', v)}
                    placeholder={copy.scorePlaceholder}
                    validationRange={copy.validationRange}
                />
                <ScoreField
                    label={copy.rk2}
                    value={subject.rk2}
                    onChange={(v) => onScoreChange(subject.id, 'rk2', v)}
                    placeholder={copy.scorePlaceholder}
                    validationRange={copy.validationRange}
                />
                <ScoreField
                    label={copy.final}
                    value={subject.final}
                    onChange={(v) => onScoreChange(subject.id, 'final', v)}
                    placeholder={copy.scorePlaceholder}
                    validationRange={copy.validationRange}
                />
            </div>

            <details>
                <summary
                    className="text-xs cursor-pointer"
                    style={{ color: 'var(--muted)' }}
                >
                    {`${copy.weight} (${subject.weights.rk1.toFixed(2)} / ${subject.weights.rk2.toFixed(2)} / ${subject.weights.final.toFixed(2)})`}
                </summary>
                <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--muted)' }}
                >
                    {copy.weightHint}
                </p>
                <div
                    className="grid gap-2 mt-2"
                    style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
                >
                    <WeightField
                        label={copy.rk1}
                        value={subject.weights.rk1}
                        onChange={(v) => onWeightChange(subject.id, 'rk1', v)}
                    />
                    <WeightField
                        label={copy.rk2}
                        value={subject.weights.rk2}
                        onChange={(v) => onWeightChange(subject.id, 'rk2', v)}
                    />
                    <WeightField
                        label={copy.final}
                        value={subject.weights.final}
                        onChange={(v) => onWeightChange(subject.id, 'final', v)}
                    />
                </div>
                {!weightSumOk ? (
                    <p
                        className="text-xs mt-2"
                        style={{ color: 'var(--status-warning-color)' }}
                    >
                        {copy.weightsSumHint}
                    </p>
                ) : null}
            </details>

            <div
                className="flex flex-wrap items-center gap-3 pt-2"
                style={{
                    borderTop: '1px solid var(--border)',
                }}
            >
                <ResultStat label={copy.totalScore} value={formatNumber(total, 2)} />
                <ResultStat
                    label={copy.letterGrade}
                    value={letter}
                    valueStyle={{
                        color: letterTone.color,
                        background: letterTone.bg,
                        border: `1px solid ${letterTone.border}`,
                        padding: '2px 10px',
                        borderRadius: '8px',
                    }}
                />
                <ResultStat label={copy.gpa} value={formatNumber(gpa, 2)} />
            </div>
            {total === null ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {copy.notEnoughData}
                </p>
            ) : null}
        </article>
    );
}

function ScoreField({
    label,
    value,
    onChange,
    placeholder,
    validationRange,
}: {
    label: string;
    value: string;
    onChange: (raw: string) => void;
    placeholder: string;
    validationRange: string;
}) {
    const invalid = isOutOfRange(value);
    return (
        <label className="flex flex-col gap-1">
            <span
                className="text-xs uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
            >
                {label}
            </span>
            <input
                type="number"
                inputMode="decimal"
                className="input"
                placeholder={placeholder}
                value={value}
                min={SCORE_MIN}
                max={SCORE_MAX}
                step="0.1"
                onChange={(e) => onChange(e.target.value)}
                aria-invalid={invalid || undefined}
                style={{ padding: '10px 12px', fontSize: '0.95rem' }}
            />
            {invalid ? (
                <span
                    className="text-xs"
                    style={{ color: 'var(--status-danger-color)' }}
                >
                    {validationRange}
                </span>
            ) : null}
        </label>
    );
}

function WeightField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (raw: string) => void;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span
                className="text-xs uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
            >
                {label}
            </span>
            <input
                type="number"
                inputMode="decimal"
                className="input"
                value={value}
                min={0}
                max={1}
                step="0.05"
                onChange={(e) => onChange(e.target.value)}
                style={{ padding: '10px 12px', fontSize: '0.95rem' }}
            />
        </label>
    );
}

function ResultStat({
    label,
    value,
    valueStyle,
}: {
    label: string;
    value: string;
    valueStyle?: React.CSSProperties;
}) {
    return (
        <div className="flex flex-col">
            <span
                className="text-xs uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
            >
                {label}
            </span>
            <span
                className="text-base font-semibold"
                style={{
                    color: 'var(--text)',
                    fontVariantNumeric: 'tabular-nums',
                    ...valueStyle,
                }}
            >
                {value}
            </span>
        </div>
    );
}

/**
 * Letter grade chip colors. Reuses the existing semantic status tokens so we
 * don't have to add new theme variables across all 7 themes — every theme
 * already defines `--status-{success,info,warning,danger}-{bg,color,border}`
 * with proper contrast.
 *
 * Mapping (same buckets as `getGradeTone`):
 *   A / A-       → success
 *   B+ / B / B-  → info
 *   C+ / C / C-  → warning (high half of 50-89 band)
 *   D+ / D       → warning
 *   F            → danger
 *   —            → muted neutral
 */
function letterGradeTone(letter: string): { bg: string; color: string; border: string } {
    if (letter === 'A' || letter === 'A-') {
        return {
            bg: 'var(--status-success-bg)',
            color: 'var(--status-success-color)',
            border: 'var(--status-success-border)',
        };
    }
    if (letter === 'B+' || letter === 'B' || letter === 'B-') {
        return {
            bg: 'var(--status-info-bg)',
            color: 'var(--status-info-color)',
            border: 'var(--status-info-border)',
        };
    }
    if (letter === 'C+' || letter === 'C' || letter === 'C-' || letter === 'D+' || letter === 'D') {
        return {
            bg: 'var(--status-warning-bg)',
            color: 'var(--status-warning-color)',
            border: 'var(--status-warning-border)',
        };
    }
    if (letter === 'F') {
        return {
            bg: 'var(--status-danger-bg)',
            color: 'var(--status-danger-color)',
            border: 'var(--status-danger-border)',
        };
    }
    return {
        bg: 'var(--surface-overlay-3)',
        color: 'var(--muted)',
        border: 'var(--border)',
    };
}
