'use client';

import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

/**
 * Lightweight global keyboard shortcut system.
 *
 * - Supports modifier combos like `Cmd+K` / `Ctrl+K`, single keys (`t`, `r`, `/`),
 *   shift combos (`Shift+?`) and two-key chords (`g s`, `g e`).
 * - Ignores keystrokes that originate inside `<input>`, `<textarea>` or
 *   `[contenteditable]` so we never hijack normal typing. `Escape` is still
 *   delivered to allow modals/sheets to close.
 * - Provides a React context so registered shortcuts can be enumerated by
 *   the help modal (grouped, with descriptions).
 *
 * Implementation notes:
 * - The `register(combo, handler, options)` function returns an unregister
 *   callback so React effects can clean up.
 * - For chords the user has a 1.2s window between the first key and the
 *   second key. If the second key doesn't match a known continuation, the
 *   chord is discarded silently.
 */

export interface ShortcutOptions {
    description?: string;
    group?: ShortcutGroup;
}

export type ShortcutGroup = 'navigation' | 'actions' | 'misc';

export interface RegisteredShortcut {
    combo: string;
    description?: string;
    group: ShortcutGroup;
}

interface InternalShortcut extends RegisteredShortcut {
    handler: () => void;
    /** Normalized representation used for matching. */
    normalized: NormalizedCombo;
}

interface NormalizedCombo {
    /** `chord` shortcuts have two parts (`g s` => ['g', 's']). */
    parts: NormalizedPart[];
}

interface NormalizedPart {
    key: string;
    cmd: boolean;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    /**
     * `meta` means `Cmd/Ctrl` — the platform-appropriate primary modifier.
     * When matching we accept either Cmd or Ctrl.
     */
    primary: boolean;
}

const CHORD_TIMEOUT_MS = 1200;

interface KeyboardShortcutsContextValue {
    register: (combo: string, handler: () => void, options?: ShortcutOptions) => () => void;
    shortcuts: RegisteredShortcut[];
    helpOpen: boolean;
    openHelp: () => void;
    closeHelp: () => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | undefined>(undefined);

/**
 * Parse a combo string into a normalized representation.
 *
 * Exported for unit testing. Accepts:
 *   - `Cmd+K`, `Ctrl+K`, `Mod+K` (Mod = Cmd on mac / Ctrl elsewhere)
 *   - `Shift+?`
 *   - `Escape`, `Enter`, `/`, `?`
 *   - chord: `g s`, `g e` (whitespace separated)
 */
export function parseShortcut(combo: string): NormalizedCombo {
    const trimmed = combo.trim();
    if (!trimmed) {
        throw new Error('parseShortcut: empty combo');
    }
    const partStrings = trimmed.split(/\s+/);
    if (partStrings.length > 2) {
        throw new Error(`parseShortcut: chords longer than 2 keys not supported (got "${combo}")`);
    }
    return { parts: partStrings.map(parsePart) };
}

function parsePart(part: string): NormalizedPart {
    const tokens = part.split('+').map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
        throw new Error(`parseShortcut: empty part`);
    }
    let cmd = false;
    let ctrl = false;
    let shift = false;
    let alt = false;
    let primary = false;
    let key: string | null = null;
    for (const token of tokens) {
        const lower = token.toLowerCase();
        if (lower === 'cmd' || lower === 'meta' || lower === 'command' || lower === 'win') {
            cmd = true;
        } else if (lower === 'ctrl' || lower === 'control') {
            ctrl = true;
        } else if (lower === 'shift') {
            shift = true;
        } else if (lower === 'alt' || lower === 'option') {
            alt = true;
        } else if (lower === 'mod') {
            primary = true;
        } else {
            // Normalize key to a single lowercase form. Multi-char keys like
            // `Escape` keep their canonical name.
            key = lower.length === 1 ? lower : lower;
        }
    }
    if (!key) {
        throw new Error(`parseShortcut: missing main key in "${part}"`);
    }
    return { key, cmd, ctrl, shift, alt, primary };
}

function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const platform = navigator.platform || '';
    if (/Mac|iPhone|iPad|iPod/i.test(platform)) return true;
    // Modern browsers expose userAgentData; fall back to userAgent string.
    const ua = navigator.userAgent || '';
    return /Macintosh|Mac OS X/i.test(ua);
}

function eventKeyToNormalized(event: KeyboardEvent): string {
    // event.key gives us a friendly name; lowercase single chars, keep names.
    const key = event.key;
    if (!key) return '';
    if (key.length === 1) return key.toLowerCase();
    return key.toLowerCase();
}

function partMatchesEvent(part: NormalizedPart, event: KeyboardEvent, mac: boolean): boolean {
    const eventKey = eventKeyToNormalized(event);
    // For Shift+? the printable key is `?`, so the shift modifier is already
    // implied — accept the match whether the user explicitly typed Shift or not.
    if (eventKey !== part.key) {
        // Special case: `?` can appear in event.key directly because Shift+/
        // produces `?` on US layouts.
        return false;
    }
    const eventPrimary = mac ? event.metaKey : event.ctrlKey;
    if (part.primary) {
        if (!eventPrimary) return false;
    } else {
        if (part.cmd && !event.metaKey) return false;
        if (part.ctrl && !event.ctrlKey) return false;
    }
    // If the combo did NOT declare a primary/cmd/ctrl modifier, reject events
    // that have one — `Cmd+R` shouldn't trigger the `r` shortcut.
    if (!part.primary && !part.cmd && !part.ctrl) {
        if (event.metaKey || event.ctrlKey) return false;
    }
    if (part.shift && !event.shiftKey) return false;
    if (part.alt && !event.altKey) return false;
    // If the combo did NOT declare alt, allow alt to be either way only when
    // the key is non-printable. We accept alt-not-required matches for normal
    // keys to keep shortcuts permissive on layouts where alt selects symbols.
    return true;
}

function partsEqual(a: NormalizedPart, b: NormalizedPart): boolean {
    return a.key === b.key
        && a.cmd === b.cmd
        && a.ctrl === b.ctrl
        && a.shift === b.shift
        && a.alt === b.alt
        && a.primary === b.primary;
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
}

interface ProviderProps {
    children: ReactNode;
    /** Allow callers to gate the listener (e.g. disable on landing pages). */
    enabled?: boolean;
}

export function KeyboardShortcutsProvider({ children, enabled = true }: ProviderProps) {
    // Use a ref for the shortcuts list so handlers see the latest entries
    // without re-binding the global listener on every register call.
    const shortcutsRef = useRef<InternalShortcut[]>([]);
    const [shortcuts, setShortcuts] = useState<RegisteredShortcut[]>([]);
    const [helpOpen, setHelpOpen] = useState(false);
    const chordRef = useRef<{ part: NormalizedPart; expiresAt: number } | null>(null);
    const isMacRef = useRef<boolean>(false);

    useEffect(() => {
        isMacRef.current = isMacPlatform();
    }, []);

    const register = useCallback(
        (combo: string, handler: () => void, options: ShortcutOptions = {}) => {
            const normalized = parseShortcut(combo);
            const entry: InternalShortcut = {
                combo,
                description: options.description,
                group: options.group ?? 'misc',
                handler,
                normalized,
            };
            shortcutsRef.current = [...shortcutsRef.current, entry];
            setShortcuts(
                shortcutsRef.current.map(({ combo: c, description, group }) => ({
                    combo: c,
                    description,
                    group,
                })),
            );
            return () => {
                shortcutsRef.current = shortcutsRef.current.filter((item) => item !== entry);
                setShortcuts(
                    shortcutsRef.current.map(({ combo: c, description, group }) => ({
                        combo: c,
                        description,
                        group,
                    })),
                );
            };
        },
        [],
    );

    const openHelp = useCallback(() => setHelpOpen(true), []);
    const closeHelp = useCallback(() => setHelpOpen(false), []);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;
        const handler = (event: KeyboardEvent) => {
            const target = event.target;
            const inputLike = shouldIgnoreTarget(target);
            // Always let Escape through so modal closers can react.
            if (inputLike && event.key !== 'Escape') return;

            const mac = isMacRef.current;
            const now = Date.now();
            const pending = chordRef.current;
            // Ignore modifier-only keystrokes — they're not actionable.
            if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta' || event.key === 'Alt') {
                return;
            }

            // Try chord match first if there's a pending first key.
            if (pending && now <= pending.expiresAt) {
                for (const entry of shortcutsRef.current) {
                    const parts = entry.normalized.parts;
                    if (parts.length !== 2) continue;
                    if (partsEqual(parts[0], pending.part) && partMatchesEvent(parts[1], event, mac)) {
                        chordRef.current = null;
                        event.preventDefault();
                        entry.handler();
                        return;
                    }
                }
                // No chord match — drop pending and fall through so the second
                // key can still match a single-key shortcut on its own.
                chordRef.current = null;
            }

            // Single-part matches.
            for (const entry of shortcutsRef.current) {
                const parts = entry.normalized.parts;
                if (parts.length !== 1) continue;
                if (partMatchesEvent(parts[0], event, mac)) {
                    event.preventDefault();
                    entry.handler();
                    return;
                }
            }

            // No single-part match — maybe this starts a chord.
            const chordStarter = shortcutsRef.current.find((entry) => {
                if (entry.normalized.parts.length !== 2) return false;
                const first = entry.normalized.parts[0];
                return partMatchesEvent(first, event, mac);
            });
            if (chordStarter) {
                event.preventDefault();
                chordRef.current = {
                    part: chordStarter.normalized.parts[0],
                    expiresAt: now + CHORD_TIMEOUT_MS,
                };
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [enabled]);

    const value = useMemo<KeyboardShortcutsContextValue>(
        () => ({ register, shortcuts, helpOpen, openHelp, closeHelp }),
        [register, shortcuts, helpOpen, openHelp, closeHelp],
    );

    return (
        <KeyboardShortcutsContext.Provider value={value}>
            {children}
        </KeyboardShortcutsContext.Provider>
    );
}

export function useKeyboardShortcuts(): KeyboardShortcutsContextValue {
    const ctx = useContext(KeyboardShortcutsContext);
    if (!ctx) {
        throw new Error('useKeyboardShortcuts must be used within a KeyboardShortcutsProvider');
    }
    return ctx;
}

/**
 * Register a single shortcut tied to the lifetime of the calling component.
 */
export function useShortcut(combo: string, handler: () => void, options: ShortcutOptions = {}) {
    const { register } = useKeyboardShortcuts();
    // Stash handler in a ref so callers don't have to memoize it.
    const handlerRef = useRef(handler);
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);
    const description = options.description;
    const group = options.group;
    useEffect(() => {
        const unregister = register(combo, () => handlerRef.current(), {
            description,
            group,
        });
        return unregister;
    }, [combo, description, group, register]);
}

/**
 * Format a combo for display in the help modal. Translates `Mod` to the
 * platform-appropriate symbol and prettifies common key names.
 */
export function formatCombo(combo: string): string {
    const mac = isMacPlatform();
    const primary = mac ? '⌘' : 'Ctrl';
    return combo
        .split(/\s+/)
        .map((part) => part
            .split('+')
            .map((token) => {
                const lower = token.toLowerCase();
                if (lower === 'mod') return primary;
                if (lower === 'cmd' || lower === 'meta' || lower === 'command') return mac ? '⌘' : 'Cmd';
                if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
                if (lower === 'shift') return mac ? '⇧' : 'Shift';
                if (lower === 'alt' || lower === 'option') return mac ? '⌥' : 'Alt';
                if (lower === 'escape') return 'Esc';
                if (lower.length === 1) return token.toUpperCase();
                return token.charAt(0).toUpperCase() + token.slice(1);
            })
            .join('+'))
        .join(' ');
}
