/**
 * Pure helpers for the group-space tab unread badge.
 *
 * `GroupSpacePage` subscribes to `useSocialUnread([`group:${groupKey}`])` and
 * surfaces the resulting count next to the Feed / Tasks / Lessons tab labels.
 * The DOM coupling lives in the page component; everything testable lives here.
 *
 * The current backend read-marker contract collapses every entity kind under
 * `(user_id, 'group', groupKey)` into a single counter, so there is no
 * per-kind breakdown today — we surface the same total on every tab that
 * shows group content. Per-kind splits, if we ever need them, would slot in
 * by adding more scope keys (e.g. `group-tasks:K`) without touching this
 * helper's call sites.
 */

/**
 * Tabs that should render an unread badge derived from the
 * `group:${groupKey}` scope. The remaining tabs (files / members / requests /
 * roles) do not carry social entities and therefore never light up.
 *
 * Exported as a const so the page component can reuse it instead of hard-
 * coding the list at the call site (keeps the truth in one place).
 */
export const GROUP_UNREAD_TABS = ['feed', 'tasks', 'lessons'] as const;
export type GroupUnreadTab = (typeof GROUP_UNREAD_TABS)[number];

/**
 * Returns true when the given tab should render an unread badge driven by
 * the `group:${groupKey}` social scope. Defensive against arbitrary string
 * input so future tab additions do not accidentally light up.
 */
export function isGroupUnreadTab(tab: string | null | undefined): tab is GroupUnreadTab {
    if (typeof tab !== 'string') return false;
    return (GROUP_UNREAD_TABS as readonly string[]).includes(tab);
}

/**
 * Builds the scope key the universal-social unread cursor uses for a group.
 * Returns `null` when `groupKey` is empty/whitespace so callers can skip the
 * subscription entirely (passing an empty scope list to `useSocialUnread`
 * keeps the hook inert).
 */
export function buildGroupScopeKey(groupKey: string | null | undefined): string | null {
    if (typeof groupKey !== 'string') return null;
    const trimmed = groupKey.trim();
    if (trimmed.length === 0) return null;
    return `group:${trimmed}`;
}

/**
 * Decide whether the SSE bridge should optimistically bump the unread count
 * for a given `entity-created` frame.
 *
 * Returns `true` only when ALL of the following hold:
 *   * the beta flag is on (callers pass `socialBeta` through),
 *   * the event's scope matches the group we care about,
 *   * the author is NOT the viewer (own writes never bump their own badge).
 *
 * Keeping this as a pure helper lets us unit-test the bump-eligibility
 * predicate without spinning up an `EventSource`.
 */
export function shouldBumpGroupScope(input: {
    socialBeta: boolean;
    eventScopeType: string;
    eventScopeId: string;
    eventAuthorUserId: string;
    groupScopeKey: string | null;
    viewerUserId: string | null;
}): boolean {
    if (!input.socialBeta) return false;
    if (!input.groupScopeKey) return false;
    if (input.eventScopeType !== 'group') return false;
    const expected = `group:${input.eventScopeId}`;
    if (expected !== input.groupScopeKey) return false;
    if (!input.viewerUserId) return false;
    if (input.eventAuthorUserId === input.viewerUserId) return false;
    return true;
}
