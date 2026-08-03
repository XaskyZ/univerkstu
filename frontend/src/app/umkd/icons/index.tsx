import type { ComponentType, SVGProps } from 'react';

/**
 * Hand-drawn outline icons for UMKD subject categories.
 *
 * All icons share the same visual language:
 *   - 24x24 viewBox
 *   - stroke = currentColor (so the parent can tint via `color: var(--primary)`)
 *   - 1.5px stroke
 *   - stroke-linecap=round, stroke-linejoin=round
 *   - no fills (outline-only, hand-drawn feel)
 *
 * The icons accept a `className` so callers can size them (e.g. `w-10 h-10`).
 */

type IconProps = { className?: string } & Pick<SVGProps<SVGSVGElement>, 'aria-hidden'>;

const baseProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};

export type UmkdCategoryKey =
    | 'programming'
    | 'databases'
    | 'networks'
    | 'infosec'
    | 'cad'
    | 'math'
    | 'physics'
    | 'chemistry'
    | 'biology'
    | 'ecology'
    | 'geology'
    | 'mining'
    | 'mechanical'
    | 'electrical'
    | 'automation'
    | 'transport'
    | 'construction'
    | 'safety'
    | 'economics'
    | 'law'
    | 'philosophy'
    | 'history'
    | 'politology'
    | 'culturology'
    | 'kazakh'
    | 'russian'
    | 'english'
    | 'pe'
    | 'military'
    | 'pedagogy'
    | 'research'
    | 'default';

// ──────────────────────────────────────────────────────────────────────────
// IT block
// ──────────────────────────────────────────────────────────────────────────

export function ProgrammingIcon({ className, ...rest }: IconProps) {
    // Code chevrons + slash: <  /  >
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M9 7l-5 5 5 5" />
            <path d="M15 7l5 5-5 5" />
            <path d="M13 5l-2 14" />
        </svg>
    );
}

export function DatabasesIcon({ className, ...rest }: IconProps) {
    // Stacked-cylinder DB silhouette
    return (
        <svg className={className} {...baseProps} {...rest}>
            <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
            <path d="M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
            <path d="M5 11.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
        </svg>
    );
}

export function NetworksIcon({ className, ...rest }: IconProps) {
    // Three nodes + lines (network graph)
    return (
        <svg className={className} {...baseProps} {...rest}>
            <circle cx="12" cy="4.5" r="2" />
            <circle cx="5" cy="18" r="2" />
            <circle cx="19" cy="18" r="2" />
            <path d="M12 6.5L6 16" />
            <path d="M12 6.5l6 9.5" />
            <path d="M7 18h10" />
        </svg>
    );
}

export function InfosecIcon({ className, ...rest }: IconProps) {
    // Shield with keyhole
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
            <circle cx="12" cy="12" r="1.5" />
            <path d="M12 13.5v2.5" />
        </svg>
    );
}

export function CadIcon({ className, ...rest }: IconProps) {
    // Compass + drafting triangle
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M12 3v3" />
            <circle cx="12" cy="6" r="1.2" />
            <path d="M12 6L6 20" />
            <path d="M12 6l6 14" />
            <path d="M8.5 13.5h7" />
        </svg>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Pure sciences
// ──────────────────────────────────────────────────────────────────────────

export function MathIcon({ className, ...rest }: IconProps) {
    // pi + radical-ish hint
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M4 8h16" />
            <path d="M8 8v9" />
            <path d="M16 8v7c0 1.2.6 2 1.5 2" />
            <path d="M11 8c0 4-1 7-3 9" />
        </svg>
    );
}

export function PhysicsIcon({ className, ...rest }: IconProps) {
    // Atom (nucleus + 2 orbits)
    return (
        <svg className={className} {...baseProps} {...rest}>
            <circle cx="12" cy="12" r="1.5" />
            <ellipse cx="12" cy="12" rx="9" ry="3.5" />
            <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)" />
            <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(-60 12 12)" />
        </svg>
    );
}

export function ChemistryIcon({ className, ...rest }: IconProps) {
    // Erlenmeyer flask with bubbles
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M9 3h6" />
            <path d="M10 3v6L5 19c-.6 1 .1 2 1.2 2h11.6c1.1 0 1.8-1 1.2-2L14 9V3" />
            <path d="M8 15h8" />
            <circle cx="10.5" cy="17.5" r="0.6" />
            <circle cx="13.5" cy="18.5" r="0.6" />
        </svg>
    );
}

export function BiologyIcon({ className, ...rest }: IconProps) {
    // Leaf with vein
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M5 19c0-9 6-15 15-15 0 9-6 15-15 15z" />
            <path d="M5 19c4-4 8-8 13-13" />
        </svg>
    );
}

export function EcologyIcon({ className, ...rest }: IconProps) {
    // Earth/globe with leaf
    return (
        <svg className={className} {...baseProps} {...rest}>
            <circle cx="12" cy="12" r="8" />
            <path d="M4 12h16" />
            <path d="M12 4c2.5 2.5 4 5.5 4 8s-1.5 5.5-4 8c-2.5-2.5-4-5.5-4-8s1.5-5.5 4-8z" />
        </svg>
    );
}

export function GeologyIcon({ className, ...rest }: IconProps) {
    // Layered rock strata
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 19l5-6 4 3 4-5 5 8" />
            <path d="M3 19h18" />
            <path d="M7 13c1-.6 2-.6 3 0" />
            <path d="M14 11c1-.4 2-.4 3 0" />
        </svg>
    );
}

export function MiningIcon({ className, ...rest }: IconProps) {
    // Crossed pickaxe + hammer
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M4 4l16 16" />
            <path d="M4 20L20 4" />
            <path d="M3 6c2-2 4-2 6 0" />
            <path d="M15 18c2 2 4 2 6 0" />
            <path d="M18 3l3 3-2 2-3-3z" />
        </svg>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Engineering
// ──────────────────────────────────────────────────────────────────────────

export function MechanicalIcon({ className, ...rest }: IconProps) {
    // Gear / cog
    return (
        <svg className={className} {...baseProps} {...rest}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v3" />
            <path d="M12 18v3" />
            <path d="M3 12h3" />
            <path d="M18 12h3" />
            <path d="M5.6 5.6l2.1 2.1" />
            <path d="M16.3 16.3l2.1 2.1" />
            <path d="M5.6 18.4l2.1-2.1" />
            <path d="M16.3 7.7l2.1-2.1" />
        </svg>
    );
}

export function ElectricalIcon({ className, ...rest }: IconProps) {
    // Lightning bolt
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M13 3L5 13h6l-2 8 8-10h-6l2-8z" />
        </svg>
    );
}

export function AutomationIcon({ className, ...rest }: IconProps) {
    // Robot head with antenna
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M12 3v3" />
            <circle cx="12" cy="3" r="0.8" />
            <rect x="5" y="7" width="14" height="11" rx="2.5" />
            <circle cx="9" cy="12" r="1.2" />
            <circle cx="15" cy="12" r="1.2" />
            <path d="M9 16h6" />
            <path d="M5 12h-1" />
            <path d="M19 12h1" />
        </svg>
    );
}

export function TransportIcon({ className, ...rest }: IconProps) {
    // Wheeled vehicle silhouette
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 14l2-6h11l3 4h3v4" />
            <path d="M3 14h19" />
            <circle cx="7" cy="17" r="2" />
            <circle cx="17" cy="17" r="2" />
        </svg>
    );
}

export function ConstructionIcon({ className, ...rest }: IconProps) {
    // Trowel + brick wall
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 21h18" />
            <path d="M3 17h18" />
            <path d="M3 13h18" />
            <path d="M7 13v4" />
            <path d="M12 17v4" />
            <path d="M17 13v4" />
            <path d="M15 3l6 6-4 4-6-6z" />
        </svg>
    );
}

export function SafetyIcon({ className, ...rest }: IconProps) {
    // Hard hat
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M4 18c0-5 3.6-9 8-9s8 4 8 9" />
            <path d="M3 18h18" />
            <path d="M10 9V5h4v4" />
        </svg>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Humanities / social sciences
// ──────────────────────────────────────────────────────────────────────────

export function EconomicsIcon({ className, ...rest }: IconProps) {
    // Upward line chart with arrow
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 20h18" />
            <path d="M3 16l5-5 4 3 6-7" />
            <path d="M14 7h4v4" />
        </svg>
    );
}

export function LawIcon({ className, ...rest }: IconProps) {
    // Balance scales
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M12 4v16" />
            <path d="M7 20h10" />
            <path d="M5 8h14" />
            <path d="M5 8l-2 5c0 1.5 1.3 2.5 3 2.5s3-1 3-2.5L7 8" />
            <path d="M19 8l-2 5c0 1.5 1.3 2.5 3 2.5s3-1 3-2.5L21 8" />
        </svg>
    );
}

export function PhilosophyIcon({ className, ...rest }: IconProps) {
    // Lightbulb (thought) with rays
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M9 17h6" />
            <path d="M10 20h4" />
            <path d="M12 3v2" />
            <path d="M5 7l1.5 1.5" />
            <path d="M19 7l-1.5 1.5" />
            <path d="M8 13c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.6-1 3-2 4h-4c-1-1-2-2.4-2-4z" />
        </svg>
    );
}

export function HistoryIcon({ className, ...rest }: IconProps) {
    // Hourglass + dot for the past
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M6 3h12" />
            <path d="M6 21h12" />
            <path d="M6 3c0 5 6 6 6 9s-6 4-6 9" />
            <path d="M18 3c0 5-6 6-6 9s6 4 6 9" />
        </svg>
    );
}

export function PolitologyIcon({ className, ...rest }: IconProps) {
    // Government / capitol columns
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 9l9-5 9 5" />
            <path d="M3 9h18" />
            <path d="M3 20h18" />
            <path d="M5 17h14" />
            <path d="M6 17V9" />
            <path d="M10 17V9" />
            <path d="M14 17V9" />
            <path d="M18 17V9" />
        </svg>
    );
}

export function CulturologyIcon({ className, ...rest }: IconProps) {
    // Theater masks / artistic vase silhouette
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M10 4c-3 0-5 2-5 5v3c0 3 2 5 5 5s5-2 5-5V9c0-3-2-5-5-5z" />
            <circle cx="8.5" cy="10" r="0.6" />
            <circle cx="11.5" cy="10" r="0.6" />
            <path d="M8.5 13c.5.6 1.5.6 2 0" />
            <path d="M16 6c2 0 3 1.5 3 3v3c0 2-1 3-3 3" />
        </svg>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Languages
// ──────────────────────────────────────────────────────────────────────────

export function KazakhIcon({ className, ...rest }: IconProps) {
    // Letter "Қ" stylized as a quill + page (language placeholder)
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M7 4v16" />
            <path d="M7 12l7-7" />
            <path d="M7 12l7 7" />
            <path d="M17 17v3" />
        </svg>
    );
}

export function RussianIcon({ className, ...rest }: IconProps) {
    // Letter "Я" stylized — bowl with leg
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M16 4h-5c-2 0-3.5 1.5-3.5 3.5S9 11 11 11h5" />
            <path d="M16 4v16" />
            <path d="M11 11l-4 9" />
        </svg>
    );
}

export function EnglishIcon({ className, ...rest }: IconProps) {
    // Letter "A" with crossbar
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M5 20l7-16 7 16" />
            <path d="M8 14h8" />
        </svg>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Misc
// ──────────────────────────────────────────────────────────────────────────

export function PeIcon({ className, ...rest }: IconProps) {
    // Dumbbell
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 9v6" />
            <path d="M21 9v6" />
            <rect x="5" y="7" width="3" height="10" rx="1" />
            <rect x="16" y="7" width="3" height="10" rx="1" />
            <path d="M8 12h8" />
        </svg>
    );
}

export function MilitaryIcon({ className, ...rest }: IconProps) {
    // Star + epaulette stripes
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M12 3l2.4 5 5.6.6-4 4 1 5.4-5-2.8-5 2.8 1-5.4-4-4 5.6-.6z" />
        </svg>
    );
}

export function PedagogyIcon({ className, ...rest }: IconProps) {
    // Graduation cap
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M2 9l10-5 10 5-10 5z" />
            <path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
            <path d="M22 9v5" />
        </svg>
    );
}

export function ResearchIcon({ className, ...rest }: IconProps) {
    // Magnifier over page
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M5 3h9l5 5v8" />
            <path d="M14 3v5h5" />
            <circle cx="10" cy="15" r="3" />
            <path d="M12.5 17.5l3 3" />
        </svg>
    );
}

export function DefaultIcon({ className, ...rest }: IconProps) {
    // Open book — generic study material
    return (
        <svg className={className} {...baseProps} {...rest}>
            <path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z" />
            <path d="M12 6v14" />
        </svg>
    );
}

export const UMKD_CATEGORY_ICONS: Record<UmkdCategoryKey, ComponentType<{ className?: string }>> = {
    programming: ProgrammingIcon,
    databases: DatabasesIcon,
    networks: NetworksIcon,
    infosec: InfosecIcon,
    cad: CadIcon,
    math: MathIcon,
    physics: PhysicsIcon,
    chemistry: ChemistryIcon,
    biology: BiologyIcon,
    ecology: EcologyIcon,
    geology: GeologyIcon,
    mining: MiningIcon,
    mechanical: MechanicalIcon,
    electrical: ElectricalIcon,
    automation: AutomationIcon,
    transport: TransportIcon,
    construction: ConstructionIcon,
    safety: SafetyIcon,
    economics: EconomicsIcon,
    law: LawIcon,
    philosophy: PhilosophyIcon,
    history: HistoryIcon,
    politology: PolitologyIcon,
    culturology: CulturologyIcon,
    kazakh: KazakhIcon,
    russian: RussianIcon,
    english: EnglishIcon,
    pe: PeIcon,
    military: MilitaryIcon,
    pedagogy: PedagogyIcon,
    research: ResearchIcon,
    default: DefaultIcon,
};
