'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlatonusSubjectGrade } from '@/lib/api';
import { type GoalOption, GOAL_OPTIONS } from '../types';
import {
    clampNumber,
    formatExamDateLabel,
    formatGoalNumber,
    getAssistantStatusTone,
    parseScoreValue,
} from '../utils/grades-helpers';
import {
    buildSubjectAssistantModel,
    getAssistantCopy,
    getWeightedFinal,
    isExamlessSubject,
    solveRequiredExam,
    solveRequiredRk2,
} from '../utils/goal-assistant';
import { HintChip } from './HintChip';
import { Stepper } from './Stepper';

export function SubjectGoalAssistant({
    subject,
    language,
}: {
    subject: PlatonusSubjectGrade;
    language: 'ru' | 'kz' | 'en';
}) {
    const copy = getAssistantCopy(language);
    const [selectedGoal, setSelectedGoal] = useState<GoalOption>(70);

    // Editable RK2 / Exam target values for "what-if" scenario
    const rk1Parsed = parseScoreValue(subject.rk1);
    const rk2Parsed = parseScoreValue(subject.rk2);
    const rk1Value = rk1Parsed.kind === 'number' ? (rk1Parsed.value ?? null) : null;
    const rk2Value = rk2Parsed.kind === 'number' ? (rk2Parsed.value ?? null) : null;

    const model = useMemo(() => buildSubjectAssistantModel(subject, language), [subject, language]);
    const stage = model.stage;
    const examless = useMemo(() => isExamlessSubject(subject), [subject]);

    // Initial "target" values — computed minimums or sensible defaults
    const computedMinRk2 = useMemo(() => {
        const insight = model.goalInsights[selectedGoal];
        const raw = insight.neededSemesterPoints;
        if (raw === null) return 50;
        return Math.min(100, Math.max(50, Math.ceil(raw)));
    }, [model, selectedGoal]);

    const computedMinExam = useMemo(() => {
        const insight = model.goalInsights[selectedGoal];
        const raw = insight.neededExam;
        if (raw === null) return 0;
        return Math.min(100, Math.max(0, Math.ceil(raw)));
    }, [model, selectedGoal]);

    const [rk2Target, setRk2TargetRaw] = useState<number>(computedMinRk2);
    const [examTarget, setExamTargetRaw] = useState<number>(computedMinExam);

    // Sync when goal changes — reset both to computed minimums
    useEffect(() => {
        setRk2TargetRaw(computedMinRk2);
        setExamTargetRaw(computedMinExam);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedGoal]);

    // ── Interdependent setters ─────────────────────────────
    // When RK2 changes → recalculate required exam to still hit goal
    const handleRk2Change = useCallback((newRk2: number) => {
        const r = parseFloat(Math.min(100, Math.max(50, newRk2)).toFixed(1));
        setRk2TargetRaw(r);
        if (stage === 'rk2' && rk1Value !== null) {
            const needed = solveRequiredExam(selectedGoal, rk1Value, r);
            const clamped = Math.min(100, Math.max(0, Math.ceil(needed ?? 0)));
            setExamTargetRaw(clamped);
        }
    }, [stage, rk1Value, selectedGoal]);

    // When Exam changes → recalculate required RK2 to still hit goal
    const handleExamChange = useCallback((newExam: number) => {
        setExamTargetRaw(newExam);
        if (stage === 'rk2' && rk1Value !== null) {
            const needed = solveRequiredRk2(selectedGoal, rk1Value, newExam);
            if (needed !== null) {
                const r = parseFloat(Math.min(100, Math.max(50, needed)).toFixed(1));
                setRk2TargetRaw(r);
            }
        }
    }, [stage, rk1Value, selectedGoal]);

    const selectedInsight = model.goalInsights[selectedGoal];
    const tone = getAssistantStatusTone(selectedInsight.status);
    const stageTone = getAssistantStatusTone(model.stageTone);
    const locale = language === 'kz' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU';
    const examDateLabel = formatExamDateLabel(subject.examDate, locale);

    // Live projected final from current stepper values
    const projectedFinalIfExam = stage === 'exam'
        ? clampNumber(getWeightedFinal(rk1Value, rk2Value, examTarget), 0, 100)
        : stage === 'rk2'
            ? clampNumber(getWeightedFinal(rk1Value, rk2Target, examTarget), 0, 100)
            : null;

    const projectedFinalTone = projectedFinalIfExam !== null
        ? getAssistantStatusTone(
            projectedFinalIfExam >= selectedGoal ? 'ok'
                : projectedFinalIfExam >= 50 ? 'achievable'
                    : 'risk'
        )
        : null;

    return (
        <section
            className="goal-assistant"
            style={{ ['--tone-border' as string]: stageTone.border }}
        >
            {/* ── Row 1: stage title + goal badge ── */}
            <div className="goal-assistant-header">
                <div style={{ minWidth: 0 }}>
                    <div className="goal-assistant-stage-title">
                        {model.stageTitle}
                    </div>
                    {model.stageSummary && (
                        <div className="goal-assistant-stage-summary">
                            {model.stageSummary}
                        </div>
                    )}
                    {examDateLabel && (
                        <div className="goal-assistant-stage-meta">
                            {copy.examCalendar.replace('{value}', examDateLabel)}
                        </div>
                    )}
                </div>
                <span
                    className="pill"
                    style={{
                        ['--tone-border' as string]: tone.border,
                        ['--tone-bg' as string]: tone.bg,
                        ['--tone-color' as string]: tone.color,
                        gap: '5px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                    }}
                >
                    {copy.targetTitle} {selectedGoal}: {selectedInsight.title}
                </span>
            </div>

            {/* ── Row 2: goal selector pills ── */}
            <div style={{ display: 'flex', gap: 'var(--space-1-5)', flexWrap: 'wrap' }}>
                {GOAL_OPTIONS.map((goal) => {
                    const isActive = goal === selectedGoal;
                    const goalTone = getAssistantStatusTone(model.goalInsights[goal].status);
                    return (
                        <button
                            key={goal}
                            type="button"
                            className={isActive ? 'goal-pill goal-pill-active' : 'goal-pill'}
                            onClick={(e) => { e.stopPropagation(); setSelectedGoal(goal); }}
                            style={isActive ? {
                                ['--tone-border' as string]: goalTone.border,
                                ['--tone-bg' as string]: goalTone.bg,
                                ['--tone-color' as string]: goalTone.color,
                            } : undefined}
                        >
                            {goal}
                        </button>
                    );
                })}
            </div>

            {/* ── Row 3: steppers (only in rk2 / exam stage) ── */}
            {(stage === 'rk2' || stage === 'exam') && (
                <div className="stepper-shell">
                    {stage === 'rk2' && (
                        <Stepper
                            label={copy.minRk2}
                            value={rk2Target}
                            onChange={handleRk2Change}
                            step={0.1}
                            min={50}
                        />
                    )}
                    <Stepper
                        label={copy.minExam}
                        value={examTarget}
                        onChange={handleExamChange}
                        step={1}
                    />

                    {/* Projected final result */}
                    {projectedFinalIfExam !== null && projectedFinalTone && (
                        <div className="projected-final">
                            <span className="projected-final-label">
                                {language === 'ru' ? 'Итог' : language === 'kz' ? 'Нәтиже' : 'Result'}
                            </span>
                            <span
                                className="projected-final-value"
                                style={{ color: projectedFinalTone.color }}
                            >
                                {projectedFinalIfExam.toFixed(1)}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* ── Row 4: compact hint chips ── */}
            <div style={{ display: 'flex', gap: 'var(--space-1-5)', flexWrap: 'wrap' }}>
                {examless ? null : (
                    <HintChip
                        label={copy.admissionRule}
                        value={model.isBlocked ? '< 50' : '50+'}
                        danger={model.isBlocked}
                        tooltip={copy.admissionHint}
                    />
                )}
                <HintChip
                    label={copy.debtRisk}
                    value={selectedInsight.projectedFinal !== null && selectedInsight.projectedFinal < 50 ? '< 50' : '50+'}
                    danger={selectedInsight.projectedFinal !== null && selectedInsight.projectedFinal < 50}
                    tooltip={copy.debtHint}
                />
                {model.finalKnown !== null && (
                    <HintChip
                        label={copy.projectedFinal}
                        value={formatGoalNumber(model.finalKnown)}
                        tooltip={language === 'ru' ? 'Итог по предмету зафиксирован' : language === 'kz' ? 'Нәтиже бекітілді' : 'Final score is locked'}
                    />
                )}
            </div>

            {/* ── Row 5: hint explanations, visible (not only on tooltip hover) ── */}
            <div
                className="text-xs"
                style={{ color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}
            >
                {examless ? null : <span>{copy.admissionHint}</span>}
                <span>{copy.debtHint}</span>
            </div>
        </section>
    );
}
