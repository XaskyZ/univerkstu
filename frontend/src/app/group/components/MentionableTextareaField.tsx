'use client';

/**
 * Drop-in textarea-with-@mention-picker used by GroupFormModal when a field
 * opts in via `mentionScope`. Extracted into its own file so the shared
 * `useMentionableTextarea` hook + `MentionPickerDropdown` UI is reused 1:1
 * with the CommentsThread and DialogsPanel composers.
 *
 * Renders a relatively-positioned wrapper so the dropdown's
 * `position: absolute` anchors directly under the textarea.
 */

import { useEffect, useRef } from 'react';
import MentionPickerDropdown from '@/components/MentionPickerDropdown';
import { useMentionableTextarea } from '@/lib/mention-autocomplete';

export interface MentionableTextareaFieldProps {
    value: string;
    onChange: (next: string) => void;
    scope: string;
    rows?: number;
    required?: boolean;
    placeholder?: string;
    disabled?: boolean;
}

export default function MentionableTextareaField({
    value,
    onChange,
    scope,
    rows = 5,
    required,
    placeholder,
    disabled,
}: MentionableTextareaFieldProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const mentions = useMentionableTextarea({ scope, value, onChange });

    // Sync DOM caret with the hook's computed position after a picker insert.
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        if (document.activeElement !== el) return;
        const pos = mentions.caretPos;
        if (pos > 0 && pos <= value.length) {
            el.setSelectionRange(pos, pos);
        }
    }, [value, mentions.caretPos]);

    return (
        <div style={{ position: 'relative' }}>
            <textarea
                ref={textareaRef}
                value={value}
                required={required}
                rows={rows}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(event) => {
                    onChange(event.target.value);
                    mentions.handleSelectionChange(
                        event.target.selectionStart ?? event.target.value.length,
                    );
                }}
                onSelect={(event) => {
                    mentions.handleSelectionChange(
                        (event.target as HTMLTextAreaElement).selectionStart ?? 0,
                    );
                }}
                onKeyDown={(event) => {
                    mentions.handleKeyDown(event);
                }}
                onBlur={() => {
                    // Defer so mouseDown on the dropdown can land first.
                    setTimeout(() => mentions.autocomplete.close(), 100);
                }}
                className="input resize-y"
            />
            <MentionPickerDropdown
                open={mentions.autocomplete.isOpen}
                candidates={mentions.autocomplete.candidates}
                selectedIndex={mentions.autocomplete.selectedIndex}
                loading={mentions.autocomplete.loading}
                onSelect={(handle) => mentions.handlePickCandidate(handle)}
                onHover={(idx) => mentions.autocomplete.setSelectedIndex(idx)}
            />
        </div>
    );
}
