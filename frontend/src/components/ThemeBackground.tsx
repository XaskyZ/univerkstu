'use client';

import { useTheme } from '@/lib/theme-context';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * ThemeBackground - Dynamic animated backgrounds for each theme
 * Uses GPU-accelerated properties (transform, opacity) for performance
 */
export default function ThemeBackground() {
    const { theme } = useTheme();
    const [animationProfile, setAnimationProfile] = useState<'full' | 'lite' | 'off'>(() => {
        if (typeof window === 'undefined') return 'full';
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'full';
    });

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const nav = navigator as Navigator & {
            deviceMemory?: number;
            hardwareConcurrency?: number;
            connection?: { saveData?: boolean };
        };

        const updateProfile = () => {
            const prefersReduced = mediaQuery.matches;
            const saveData = nav.connection?.saveData === true;
            const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
            const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
            const mobile = window.innerWidth < 768;
            const veryConstrained = saveData || (mobile && (lowMemory || lowCpu));

            if (prefersReduced) {
                setAnimationProfile('off');
                return;
            }

            if (veryConstrained) {
                setAnimationProfile('off');
                return;
            }

            if (lowMemory || lowCpu || mobile) {
                setAnimationProfile('lite');
                return;
            }

            setAnimationProfile('full');
        };

        updateProfile();
        mediaQuery.addEventListener('change', updateProfile);
        window.addEventListener('resize', updateProfile);
        return () => {
            mediaQuery.removeEventListener('change', updateProfile);
            window.removeEventListener('resize', updateProfile);
        };
    }, []);

    if (animationProfile === 'off') return null;
    if (animationProfile === 'lite') return <StaticThemeBackground theme={theme} />;

    switch (theme) {
        case 'aurora':
            return <AuroraBackground />;
        case 'matrix':
            return <MatrixBackground />;
        case 'sunset':
            return <SunsetBackground />;
        case 'deep-blue':
            return <DeepBlueBackground />;
        case 'pastel':
            return <PastelBackground />;
        case 'referral-nebula':
            return <ReferralNebulaBackground />;
        case 'referral-sherbet':
            return <ReferralSherbetBackground />;
        case 'supporter-midnight':
            return <SupporterMidnightBackground />;
        case 'supporter-paper':
            return <SupporterPaperBackground />;
        case 'dark':
            return <DarkBackground />;
        case 'light':
            return <LightBackground />;
        default:
            return null;
    }
}

function StaticThemeBackground({ theme }: { theme: string }) {
    const presets: Record<string, { background: string; overlay?: string }> = {
        aurora: {
            background: 'radial-gradient(ellipse at 20% 10%, rgba(74,222,128,0.18), transparent 42%), radial-gradient(ellipse at 80% 0%, rgba(56,189,248,0.16), transparent 38%), linear-gradient(180deg, #040814 0%, #081122 100%)',
        },
        matrix: {
            background: 'linear-gradient(180deg, rgba(0,30,10,0.95) 0%, rgba(5,18,10,1) 100%)',
            overlay: 'linear-gradient(180deg, rgba(0,255,65,0.05) 0%, transparent 70%)',
        },
        sunset: {
            background: 'radial-gradient(circle at 85% 0%, rgba(249,115,22,0.24), transparent 35%), radial-gradient(circle at 15% 100%, rgba(251,191,36,0.2), transparent 30%), linear-gradient(180deg, #1a1020 0%, #0b1020 100%)',
        },
        'deep-blue': {
            background: 'radial-gradient(ellipse at 50% 0%, rgba(122,162,255,0.18), transparent 45%), linear-gradient(180deg, #020817 0%, #071528 100%)',
        },
        pastel: {
            background: 'radial-gradient(circle at 15% 20%, rgba(232,121,169,0.15), transparent 25%), radial-gradient(circle at 80% 15%, rgba(165,180,252,0.14), transparent 30%), linear-gradient(180deg, #0d1326 0%, #101936 100%)',
        },
        'referral-nebula': {
            background: 'radial-gradient(circle at 84% 0%, rgba(129,140,248,0.2), transparent 34%), radial-gradient(circle at 8% 100%, rgba(244,114,182,0.14), transparent 34%), linear-gradient(180deg, #090b1d 0%, #11142d 100%)',
        },
        'referral-sherbet': {
            background: 'radial-gradient(circle at 90% 0%, rgba(251,146,60,0.16), transparent 34%), radial-gradient(circle at 0% 100%, rgba(244,114,182,0.12), transparent 34%), linear-gradient(180deg, #fff7ed 0%, #fff1f2 100%)',
        },
        'supporter-midnight': {
            background: 'radial-gradient(circle at 85% 0%, rgba(244,186,74,0.18), transparent 34%), radial-gradient(circle at 0% 100%, rgba(125,211,252,0.12), transparent 36%), linear-gradient(180deg, #08111f 0%, #0c1628 100%)',
        },
        'supporter-paper': {
            background: 'radial-gradient(circle at 86% 0%, rgba(68,152,137,0.12), transparent 34%), radial-gradient(circle at 0% 100%, rgba(125,211,252,0.10), transparent 34%), linear-gradient(180deg, #f8fcf9 0%, #eef7f1 100%)',
        },
        dark: {
            background: 'radial-gradient(ellipse at 70% -10%, rgba(93,140,255,0.14) 0%, transparent 50%), radial-gradient(ellipse at -10% 100%, rgba(56,208,255,0.1) 0%, transparent 50%), linear-gradient(180deg, #050816 0%, #091224 100%)',
        },
        light: {
            background: 'radial-gradient(circle at 85% 0%, rgba(88,116,255,0.12), transparent 35%), radial-gradient(circle at 10% 100%, rgba(139,92,246,0.08), transparent 30%), linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)',
        },
    };

    const preset = presets[theme] || presets.dark;

    return (
        <div className="theme-bg">
            <div className="absolute inset-0" style={{ background: preset.background }} />
            {preset.overlay ? <div className="absolute inset-0" style={{ background: preset.overlay }} /> : null}
        </div>
    );
}

// ============================================
// AURORA - Northern Lights with animated blobs
// ============================================
function AuroraBackground() {
    const blobs = [
        { color: 'rgba(74, 222, 128, 0.4)', x: '-10%', y: '-20%', size: 600 },
        { color: 'rgba(56, 189, 248, 0.35)', x: '60%', y: '-30%', size: 500 },
        { color: 'rgba(167, 139, 250, 0.3)', x: '20%', y: '60%', size: 550 },
        { color: 'rgba(34, 211, 238, 0.25)', x: '80%', y: '40%', size: 400 },
    ];

    return (
        <div className="theme-bg">
            {blobs.map((blob, i) => (
                <motion.div
                    key={i}
                    className="absolute rounded-full"
                    style={{
                        width: blob.size,
                        height: blob.size,
                        background: `radial-gradient(circle, ${blob.color} 0%, transparent 70%)`,
                        filter: 'blur(60px)',
                        left: blob.x,
                        top: blob.y,
                        willChange: 'transform',
                        transform: 'translate3d(0,0,0)',
                    }}
                    animate={{
                        x: [0, 50, -30, 20, 0],
                        y: [0, -40, 30, -20, 0],
                        // Keep only transform animation for mobile GPU stability.
                        scale: [1, 1.08, 0.96, 1.04, 1],
                    }}
                    transition={{
                        duration: 15 + i * 3,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                />
            ))}
        </div>
    );
}

// ============================================
// DEEP BLUE - Underwater caustics effect
// ============================================
function DeepBlueBackground() {
    const rays = [
        { x: '10%', delay: 0 },
        { x: '30%', delay: 2 },
        { x: '50%', delay: 1 },
        { x: '70%', delay: 3 },
        { x: '90%', delay: 0.5 },
    ];

    return (
        <div className="theme-bg overflow-hidden">
            {/* Deep blue ambient */}
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(122, 162, 255, 0.2), transparent 60%)',
                }}
                animate={{
                    opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            {/* Caustic light rays */}
            {rays.map((ray, i) => (
                <motion.div
                    key={i}
                    className="absolute top-0"
                    style={{
                        left: ray.x,
                        width: '80px',
                        height: '120%',
                        background: 'linear-gradient(180deg, rgba(122, 162, 255, 0.3) 0%, transparent 80%)',
                        filter: 'blur(30px)',
                        transformOrigin: 'top center',
                    }}
                    animate={{
                        rotate: [-5, 5, -5],
                        opacity: [0.2, 0.5, 0.2],
                        scaleX: [1, 1.5, 1],
                    }}
                    transition={{
                        duration: 6 + i,
                        delay: ray.delay,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                />
            ))}

            {/* Floating particles */}
            {[...Array(8)].map((_, i) => (
                <motion.div
                    key={`particle-${i}`}
                    className="absolute rounded-full"
                    style={{
                        width: 4 + i * 2,
                        height: 4 + i * 2,
                        background: 'rgba(122, 162, 255, 0.4)',
                        left: `${10 + i * 12}%`,
                        bottom: '-10px',
                        filter: 'blur(1px)',
                    }}
                    animate={{
                        y: [0, -window.innerHeight * 1.2],
                        x: [0, Math.sin(i) * 50],
                        opacity: [0, 0.6, 0],
                    }}
                    transition={{
                        duration: 12 + i * 2,
                        delay: i * 1.5,
                        repeat: Infinity,
                        ease: 'linear',
                    }}
                />
            ))}
        </div>
    );
}

// ============================================
// SUNSET - Warm shimmer with grain texture
// ============================================
function SunsetBackground() {
    return (
        <div className="theme-bg">
            {/* Main sunset orbs */}
            <motion.div
                className="absolute"
                style={{
                    width: 500,
                    height: 500,
                    top: -150,
                    right: -100,
                    background: 'radial-gradient(circle, rgba(249, 115, 22, 0.5) 0%, transparent 70%)',
                    filter: 'blur(60px)',
                }}
                animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 0.75, 0.5],
                }}
                transition={{
                    duration: 8,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
            <motion.div
                className="absolute"
                style={{
                    width: 400,
                    height: 400,
                    bottom: '5%',
                    left: -80,
                    background: 'radial-gradient(circle, rgba(251, 191, 36, 0.4) 0%, transparent 70%)',
                    filter: 'blur(50px)',
                }}
                animate={{
                    scale: [1, 1.15, 1],
                    opacity: [0.4, 0.6, 0.4],
                }}
                transition={{
                    duration: 10,
                    delay: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            {/* Horizon glow */}
            <motion.div
                className="absolute bottom-0 left-0 right-0"
                style={{
                    height: '45%',
                    background: 'linear-gradient(to top, rgba(249, 115, 22, 0.2), transparent)',
                }}
                animate={{
                    opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            {/* Heat shimmer / haze effect */}
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'linear-gradient(45deg, transparent 40%, rgba(251, 146, 60, 0.08) 50%, transparent 60%)',
                    backgroundSize: '300% 300%',
                }}
                animate={{
                    backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
                }}
                transition={{
                    duration: 15,
                    repeat: Infinity,
                    ease: 'linear',
                }}
            />

            {/* Subtle grain overlay */}
            <div
                className="absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                }}
            />
        </div>
    );
}

// ============================================
// PASTEL - Floating geometric shapes
// ============================================
function PastelBackground() {
    const shapes = [
        { type: 'circle', color: 'rgba(232, 121, 169, 0.2)', size: 200, x: '10%', y: '20%' },
        { type: 'circle', color: 'rgba(165, 180, 252, 0.2)', size: 250, x: '70%', y: '10%' },
        { type: 'circle', color: 'rgba(134, 239, 172, 0.15)', size: 180, x: '80%', y: '60%' },
        { type: 'circle', color: 'rgba(253, 186, 116, 0.18)', size: 150, x: '15%', y: '70%' },
        { type: 'circle', color: 'rgba(196, 181, 253, 0.2)', size: 220, x: '45%', y: '45%' },
    ];

    return (
        <div className="theme-bg">
            {shapes.map((shape, i) => (
                <motion.div
                    key={i}
                    className="absolute rounded-full"
                    style={{
                        width: shape.size,
                        height: shape.size,
                        background: shape.color,
                        left: shape.x,
                        top: shape.y,
                        filter: 'blur(50px)',
                    }}
                    animate={{
                        x: [0, 30 * (i % 2 === 0 ? 1 : -1), 0],
                        y: [0, 20 * (i % 2 === 0 ? -1 : 1), 0],
                        scale: [1, 1.1, 1],
                    }}
                    transition={{
                        duration: 20 + i * 5,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                />
            ))}

            {/* Soft overlay shimmer */}
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'linear-gradient(135deg, rgba(232, 121, 169, 0.05), rgba(165, 180, 252, 0.05))',
                }}
                animate={{
                    opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                    duration: 12,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
        </div>
    );
}

function SupporterMidnightBackground() {
    return (
        <div className="theme-bg">
            <motion.div
                className="absolute"
                style={{
                    width: 560,
                    height: 560,
                    top: -180,
                    right: -120,
                    background: 'radial-gradient(circle, rgba(244,186,74,0.24) 0%, transparent 68%)',
                    filter: 'blur(70px)',
                }}
                animate={{ scale: [1, 1.12, 1], opacity: [0.45, 0.7, 0.45] }}
                transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute"
                style={{
                    width: 420,
                    height: 420,
                    left: -100,
                    bottom: -120,
                    background: 'radial-gradient(circle, rgba(125,211,252,0.16) 0%, transparent 68%)',
                    filter: 'blur(60px)',
                }}
                animate={{ scale: [1, 1.08, 1], opacity: [0.35, 0.55, 0.35] }}
                transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
            />
        </div>
    );
}

function ReferralNebulaBackground() {
    return (
        <div className="theme-bg">
            <motion.div
                className="absolute"
                style={{
                    width: 620,
                    height: 620,
                    top: -220,
                    right: -160,
                    background: 'radial-gradient(circle, rgba(129,140,248,0.24) 0%, transparent 68%)',
                    filter: 'blur(72px)',
                }}
                animate={{ x: [0, 20, -10, 0], y: [0, 12, -8, 0], scale: [1, 1.08, 0.98, 1] }}
                transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute"
                style={{
                    width: 460,
                    height: 460,
                    left: -130,
                    bottom: -120,
                    background: 'radial-gradient(circle, rgba(244,114,182,0.17) 0%, transparent 68%)',
                    filter: 'blur(64px)',
                }}
                animate={{ x: [0, -18, 0], y: [0, -14, 0], opacity: [0.42, 0.66, 0.42] }}
                transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
            />
        </div>
    );
}

function ReferralSherbetBackground() {
    return (
        <div className="theme-bg">
            <motion.div
                className="absolute"
                style={{
                    width: 640,
                    height: 640,
                    top: -230,
                    right: -190,
                    background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 66%)',
                    filter: 'blur(72px)',
                }}
                animate={{ x: [0, 18, 0], y: [0, 10, 0], scale: [1, 1.07, 1] }}
                transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute"
                style={{
                    width: 440,
                    height: 440,
                    left: -120,
                    bottom: -120,
                    background: 'radial-gradient(circle, rgba(244,114,182,0.14) 0%, transparent 68%)',
                    filter: 'blur(62px)',
                }}
                animate={{ x: [0, -14, 0], y: [0, -10, 0], opacity: [0.4, 0.62, 0.4] }}
                transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }}
            />
        </div>
    );
}

function SupporterPaperBackground() {
    return (
        <div className="theme-bg">
            <motion.div
                className="absolute"
                style={{
                    width: 620,
                    height: 620,
                    top: -220,
                    right: -180,
                    background: 'radial-gradient(circle, rgba(68,152,137,0.14) 0%, transparent 68%)',
                    filter: 'blur(72px)',
                }}
                animate={{ x: [0, 20, 0], y: [0, 14, 0], scale: [1, 1.08, 1] }}
                transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute"
                style={{
                    width: 500,
                    height: 500,
                    left: -150,
                    bottom: -140,
                    background: 'radial-gradient(circle, rgba(125,211,252,0.12) 0%, transparent 68%)',
                    filter: 'blur(64px)',
                }}
                animate={{ x: [0, -18, 0], y: [0, -12, 0], scale: [1, 1.06, 1] }}
                transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
            />
        </div>
    );
}

// ============================================
// DARK - Subtle gradient pulse
// ============================================
function DarkBackground() {
    return (
        <div className="theme-bg">
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'radial-gradient(ellipse at 70% -10%, rgba(93, 140, 255, 0.15) 0%, transparent 50%)',
                }}
                animate={{
                    opacity: [0.6, 1, 0.6],
                    scale: [1, 1.05, 1],
                }}
                transition={{
                    duration: 15,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'radial-gradient(ellipse at -10% 100%, rgba(56, 208, 255, 0.1) 0%, transparent 50%)',
                }}
                animate={{
                    opacity: [0.5, 0.8, 0.5],
                    scale: [1, 1.08, 1],
                }}
                transition={{
                    duration: 20,
                    delay: 5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
        </div>
    );
}

// ============================================
// LIGHT - Soft floating shapes
// ============================================
function LightBackground() {
    return (
        <div className="theme-bg">
            <motion.div
                className="absolute"
                style={{
                    width: 700,
                    height: 700,
                    top: -250,
                    right: -200,
                    background: 'radial-gradient(circle, rgba(88, 116, 255, 0.12) 0%, transparent 60%)',
                    filter: 'blur(60px)',
                }}
                animate={{
                    x: [0, 30, 0],
                    y: [0, 20, 0],
                    scale: [1, 1.1, 1],
                }}
                transition={{
                    duration: 25,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
            <motion.div
                className="absolute"
                style={{
                    width: 500,
                    height: 500,
                    bottom: -150,
                    left: -100,
                    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 60%)',
                    filter: 'blur(50px)',
                }}
                animate={{
                    x: [0, -20, 0],
                    y: [0, -15, 0],
                    scale: [1, 1.15, 1],
                }}
                transition={{
                    duration: 22,
                    delay: 3,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
        </div>
    );
}

// ============================================
// MATRIX - Digital rain effect (Canvas)
// ============================================
function MatrixBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();

        const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
        const fontSize = 14;
        let columns = Math.floor(canvas.width / fontSize);
        let drops: number[] = new Array(columns).fill(1);
        let rafId = 0;
        let visible = document.visibilityState === 'visible';
        let mounted = true;

        let lastTime = 0;
        const fps = 30;
        const interval = 1000 / fps;

        const rebuildDrops = () => {
            columns = Math.floor(canvas.width / fontSize);
            drops = new Array(columns).fill(1);
        };

        const schedule = () => {
            if (!visible || !mounted || rafId) return;
            rafId = requestAnimationFrame(draw);
        };

        const draw = (currentTime: number) => {
            rafId = 0;
            if (!visible || !mounted) return;
            if (currentTime - lastTime < interval) {
                schedule();
                return;
            }
            lastTime = currentTime;

            ctx.fillStyle = 'rgba(10, 15, 10, 0.05)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.font = `${fontSize}px monospace`;

            for (let i = 0; i < drops.length; i++) {
                const text = chars[Math.floor(Math.random() * chars.length)];
                const brightness = Math.random();
                ctx.fillStyle = `rgba(0, 255, 65, ${brightness * 0.5 + 0.1})`;
                ctx.fillText(text, i * fontSize, drops[i] * fontSize);

                if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            }

            schedule();
        };

        const handleResize = () => {
            resize();
            rebuildDrops();
        };

        const handleVisibilityChange = () => {
            visible = document.visibilityState === 'visible';
            if (visible) {
                lastTime = 0;
                schedule();
            } else if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
        };

        window.addEventListener('resize', handleResize);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        schedule();

        return () => {
            mounted = false;
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
        };
    }, []);

    return (
        <div className="theme-bg">
            <canvas ref={canvasRef} className="w-full h-full opacity-50" />
        </div>
    );
}
