'use client';

/**
 * Small inline trigger that opens the `RevisionHistoryModal` for a given
 * social entity. Rendered as a chip in the card header action row next to
 * `EntityShareButton` so every social card gets a consistent "edit history"
 * affordance.
 *
 * Modal mount is local — clicking opens it, escape / backdrop / explicit close
 * unmounts it. The wrapped fetch / diff logic lives in the modal itself; this
 * component is a single state cell.
 *
 * Gate at the call site: each card already gates on `socialFeedBeta` + valid
 * entity id; we keep the same contract here (hide button when entityId is
 * empty / falsy).
 */

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { getRevisionHistoryUi } from './revision-history-i18n';
import RevisionHistoryModal from './RevisionHistoryModal';

interface RevisionHistoryButtonProps {
    /** Universal `social_entity.id`. Required — the button hides when missing. */
    entityId: string | null | undefined;
    /** Optional extra className appended to the chip. */
    className?: string;
}

export default function RevisionHistoryButton({ entityId, className }: RevisionHistoryButtonProps) {
    const { language } = useLanguage();
    const ui = getRevisionHistoryUi(language);
    const [open, setOpen] = useState(false);

    if (typeof entityId !== 'string' || entityId.trim().length === 0) {
        return null;
    }

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                aria-label={ui.openLabel}
                title={ui.openLabel}
                className={`chip ${className ?? ''}`}
                data-size="sm"
            >
                <Clock className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden />
            </button>
            {open ? (
                <RevisionHistoryModal entityId={entityId.trim()} onClose={() => setOpen(false)} />
            ) : null}
        </>
    );
}
