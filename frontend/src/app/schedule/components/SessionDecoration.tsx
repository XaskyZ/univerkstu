'use client';

import type { AppLanguage } from '@/lib/language-context';

interface SessionDecorationProps {
    language: AppLanguage;
}

const WISH_COPY: Record<AppLanguage, { title: string; subtitle: string }> = {
    ru: {
        title: 'Удачи на сессии',
        subtitle: 'Ты справишься — главное, по чуть-чуть каждый день.',
    },
    kz: {
        title: 'Сессияда сәттілік',
        subtitle: 'Күн сайын азғантай — нәтиже келеді.',
    },
    en: {
        title: 'Good luck this session',
        subtitle: 'A little progress each day adds up.',
    },
};

/**
 * Decorative SVG-only block shown when session mode is active and the user has
 * collapsed the secondary (class) schedule. Fills the dead space below the
 * HideToggle with a calm pair of drifting gradient orbs and a short wish.
 *
 * - Uses semantic CSS vars only (`--primary`, `--good`, surface tints).
 * - Animations transform-only (translate + scale), no width/height/box-shadow.
 * - `prefers-reduced-motion` honoured via CSS in globals.css.
 */
export default function SessionDecoration({ language }: SessionDecorationProps) {
    const copy = WISH_COPY[language];
    return (
        <div
            className="session-decoration card animate-fadeInUp"
            aria-hidden="false"
            role="note"
        >
            <div className="session-decoration-orbs" aria-hidden>
                <span className="session-decoration-orb session-decoration-orb--primary" />
                <span className="session-decoration-orb session-decoration-orb--accent" />
            </div>

            {/*
              Three tiny sparkles that fade in/out at staggered intervals over the
              orb backdrop. Pure CSS — see `.session-decoration-sparkle` in
              globals.css. `prefers-reduced-motion` keeps them static & invisible.
            */}
            <div className="session-decoration-sparkles" aria-hidden>
                <span className="session-decoration-sparkle session-decoration-sparkle--a" />
                <span className="session-decoration-sparkle session-decoration-sparkle--b" />
                <span className="session-decoration-sparkle session-decoration-sparkle--c" />
            </div>

            <svg
                className="session-decoration-icon"
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
            >
                {/* Open book */}
                <path
                    d="M8 18 L30 22 L30 52 L8 48 Z"
                    fill="currentColor"
                    fillOpacity="0.12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                />
                <path
                    d="M56 18 L34 22 L34 52 L56 48 Z"
                    fill="currentColor"
                    fillOpacity="0.18"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                />
                <path
                    d="M30 22 L32 23 L34 22"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                />
                {/* Page lines, left */}
                <path d="M13 28 L25 30" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
                <path d="M13 34 L25 36" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
                <path d="M13 40 L21 41.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
                {/* Page lines, right */}
                <path d="M39 30 L51 28" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
                <path d="M39 36 L51 34" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
                <path d="M39 41.5 L47 40" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
            </svg>

            <div className="session-decoration-text">
                <p className="session-decoration-title">{copy.title}</p>
                <p className="session-decoration-subtitle">{copy.subtitle}</p>
            </div>
        </div>
    );
}
