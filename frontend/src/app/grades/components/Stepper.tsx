'use client';

import type React from 'react';
import { getAssistantStatusTone } from '../utils/grades-helpers';

export function Stepper({
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    label,
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    label: string;
}) {
    const decrement = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange(Math.max(min, value - step));
    };
    const increment = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange(Math.min(max, value + step));
    };

    const valueTone = getAssistantStatusTone(
        value >= 85 ? 'risk' : value >= 50 ? 'achievable' : 'impossible'
    );

    return (
        <div className="stepper-control">
            <span className="stepper-label">{label}</span>
            <div className="stepper-row">
                <button
                    type="button"
                    className="stepper-btn"
                    onClick={decrement}
                    disabled={value <= min}
                >
                    −
                </button>
                <div
                    className="stepper-value"
                    style={{
                        ['--tone-border' as string]: valueTone.border,
                        ['--tone-bg' as string]: valueTone.bg,
                        ['--tone-color' as string]: valueTone.color,
                    }}
                >
                    {value}
                </div>
                <button
                    type="button"
                    className="stepper-btn"
                    onClick={increment}
                    disabled={value >= max}
                >
                    +
                </button>
            </div>
        </div>
    );
}
