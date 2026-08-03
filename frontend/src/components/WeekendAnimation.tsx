'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import { useTheme } from '@/lib/theme-context';
import { CARD_VARIANTS, PARTICLE_COLORS } from './weekend-animation/variants';

interface Particle {
    x: number;
    y: number;
    r: number;
    vx: number;
    vy: number;
    life: number;
    decay: number;
    color: string;
    phase: number;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

export default function WeekendAnimation({ selectedDayLabel }: { selectedDayLabel?: string }) {
    const { language } = useLanguage();
    const { scheme } = useTheme();
    const cards = CARD_VARIANTS[language];
    const isLight = scheme === 'light';
    const dayIndex = (new Date().getDay() + 6) % 7;
    const [currentIndex, setCurrentIndex] = useState(() => dayIndex % cards.length);
    const [rings, setRings] = useState<Array<{ id: number; x: number; y: number; color: string }>>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const frameRef = useRef<number | null>(null);
    const particlesRef = useRef<Particle[]>([]);
    const ringIdRef = useRef(0);

    const currentCard = cards[currentIndex];
    const hintText = {
        ru: 'нажми — обнови настроение',
        kz: 'түрт — күйді ауыстыр',
        en: 'tap to switch the mood',
    }[language];
    const cornerText = selectedDayLabel || ({
        ru: 'Сегодня',
        kz: 'Бүгін',
        en: 'Today',
    }[language]);

    const lines = useMemo(() => {
        const cardSeed = currentIndex + 1;
        return Array.from({ length: 6 }, (_, index) => ({
            x1: ((cardSeed * 83) + (index * 97)) % 700,
            y1: ((cardSeed * 41) + (index * 53)) % 260,
            x2: ((cardSeed * 149) + (index * 71)) % 700,
            y2: ((cardSeed * 67) + (index * 89)) % 260,
        }));
    }, [currentIndex]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % cards.length);
        }, 6500);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [cards.length]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const card = canvas.parentElement;
        if (!card) return;

        const resize = () => {
            const w = card.clientWidth;
            const h = card.clientHeight;
            if (w > 0 && h > 0) {
                canvas.width = w;
                canvas.height = h;
            }
        };

        resize();

        // ResizeObserver catches cases where clientWidth is 0 at mount time
        const ro = new ResizeObserver(resize);
        ro.observe(card);
        window.addEventListener('resize', resize);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', resize);
        };
    }, [isLight]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const spawnParticles = () => {
            const colors = PARTICLE_COLORS[currentCard.particles];
            particlesRef.current = Array.from({ length: 28 }, () => ({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                r: 1 + Math.random() * 2.5,
                vx: (Math.random() - 0.5) * 0.4,
                vy: -0.3 - Math.random() * 0.5,
                life: 1,
                decay: 0.003 + Math.random() * 0.004,
                color: colors[Math.floor(Math.random() * colors.length)],
                phase: Math.random() * Math.PI * 2,
            }));
        };

        spawnParticles();

        const tick = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (const particle of particlesRef.current) {
                particle.x += particle.vx + Math.sin(Date.now() * 0.001 + particle.phase) * 0.3;
                particle.y += particle.vy;
                particle.life -= particle.decay;

                if (particle.y < -10 || particle.life <= 0) {
                    particle.y = canvas.height + 5;
                    particle.x = Math.random() * canvas.width;
                    particle.life = 1;
                }

                ctx.globalAlpha = particle.life * 0.7;
                ctx.fillStyle = particle.color;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = 1;
            frameRef.current = window.requestAnimationFrame(tick);
        };

        frameRef.current = window.requestAnimationFrame(tick);

        return () => {
            if (frameRef.current !== null) {
                window.cancelAnimationFrame(frameRef.current);
            }
        };
    }, [currentCard]);

    const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const nextCardIndex = (currentIndex + 1) % cards.length;
        const ring = {
            id: ringIdRef.current++,
            x: clamp(event.clientX - rect.left, 0, rect.width),
            y: clamp(event.clientY - rect.top, 0, rect.height),
            color: cards[nextCardIndex].accent,
        };

        setCurrentIndex(nextCardIndex);
        setRings((prev) => [...prev, ring]);
        window.setTimeout(() => {
            setRings((prev) => prev.filter((item) => item.id !== ring.id));
        }, 700);
    };

    return (
        <div
            className="relative my-4 h-[216px] w-full select-none overflow-hidden rounded-[24px] transition-transform duration-200 active:scale-[0.985] sm:h-[260px] sm:rounded-[28px]"
            style={isLight
                ? {
                    background: 'var(--weekend-light-bg)',
                    border: '1px solid var(--weekend-light-border)',
                    boxShadow: 'var(--weekend-light-shadow)',
                }
                : {
                    background: currentCard.background,
                }}
            onClick={handleCardClick}
        >
            <div
                className="absolute inset-0 opacity-[0.02] sm:opacity-[0.035]"
                style={{
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
                    backgroundSize: '200px',
                }}
            />

            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

            <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full" viewBox="0 0 700 260" preserveAspectRatio="xMidYMid slice">
                {lines.map((line, index) => (
                    <line
                        key={index}
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        stroke={currentCard.accent}
                        strokeWidth="0.5"
                        opacity="0.08"
                    />
                ))}
            </svg>

            <div
                className="absolute left-4 top-4 z-10 text-[10px] font-semibold uppercase tracking-[1.3px] sm:left-5 sm:top-[18px] sm:text-[11px] sm:tracking-[1.5px]"
                style={{ color: isLight ? 'var(--weekend-light-hint)' : 'rgba(255,255,255,0.2)' }}
            >
                {cornerText}
            </div>

            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 text-center sm:px-6">
                <div
                    className="mb-3 text-[44px] leading-none sm:mb-4 sm:text-[56px]"
                    style={{
                        animation: 'weekend-bounce 3s ease-in-out infinite',
                        filter: `drop-shadow(0 0 20px ${currentCard.glow})`,
                    }}
                >
                    {currentCard.emoji}
                </div>

                <div
                    className="mb-2 text-[10px] font-semibold uppercase tracking-[1.7px] opacity-70 sm:text-[11px] sm:tracking-[2px]"
                    style={{ color: isLight ? 'var(--weekend-light-label)' : currentCard.accent }}
                >
                    {currentCard.label}
                </div>

                <div
                    className="max-w-[260px] text-[18px] font-bold leading-[1.15] sm:max-w-none sm:text-[22px] sm:leading-tight"
                    style={{
                        color: isLight ? 'var(--weekend-light-title)' : 'white',
                        textShadow: isLight ? '0 2px 20px rgba(255,255,255,0.18)' : '0 2px 20px rgba(0,0,0,0.4)',
                    }}
                >
                    {currentCard.title}
                </div>

                <div
                    className="mt-1.5 max-w-[280px] px-2 text-[12px] leading-[1.35] sm:max-w-[540px] sm:px-0 sm:text-[13px] sm:leading-[1.4]"
                    style={{ color: isLight ? 'var(--weekend-light-subtitle)' : 'rgba(255,255,255,0.5)' }}
                >
                    {currentCard.sub}
                </div>
            </div>

            <div
                className="absolute bottom-[12px] right-3 z-10 hidden items-center gap-[5px] text-[10px] sm:bottom-[14px] sm:right-[18px] sm:flex sm:text-[11px]"
                style={{ color: isLight ? 'var(--weekend-light-hint)' : 'rgba(255,255,255,0.22)' }}
            >
                <div
                    className="h-[6px] w-[6px] rounded-full"
                    style={{ animation: 'weekend-pulse-dot 2s ease-in-out infinite', background: isLight ? 'var(--weekend-light-dot)' : 'rgba(255,255,255,0.25)' }}
                />
                <span>{hintText}</span>
            </div>

            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 sm:bottom-[14px] sm:gap-[5px]">
                {cards.map((_, pip) => {
                    const active = pip === currentIndex;
                    return (
                        <div
                            key={pip}
                            className="transition-all duration-300"
                            style={{
                                width: active ? 22 : 12,
                                height: 3,
                                borderRadius: 2,
                                background: active ? currentCard.accent : isLight ? 'var(--weekend-light-pip)' : 'rgba(255,255,255,0.15)',
                                boxShadow: active ? `0 0 8px ${currentCard.accent}` : 'none',
                            }}
                        />
                    );
                })}
            </div>

            {rings.map((ring) => (
                <div
                    key={ring.id}
                    className="pointer-events-none absolute z-20 rounded-full border-2 opacity-0"
                    style={{
                        left: ring.x,
                        top: ring.y,
                        width: 60,
                        height: 60,
                        borderColor: ring.color,
                        transform: 'translate(-50%, -50%) scale(0)',
                        animation: 'weekend-ring-burst 0.6s ease-out forwards',
                    }}
                />
            ))}

            <style jsx>{`
                @keyframes weekend-bounce {
                    0%, 100% {
                        transform: translateY(0) rotate(-3deg);
                    }
                    50% {
                        transform: translateY(-8px) rotate(3deg);
                    }
                }

                @keyframes weekend-pulse-dot {
                    0%, 100% {
                        transform: scale(1);
                        opacity: 0.4;
                    }
                    50% {
                        transform: scale(1.4);
                        opacity: 0.9;
                    }
                }

                @keyframes weekend-ring-burst {
                    0% {
                        opacity: 0.8;
                        transform: translate(-50%, -50%) scale(0);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(3);
                    }
                }
            `}</style>
        </div>
    );
}
