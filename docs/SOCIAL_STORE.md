# Universal Social Store

Design notes for the universal social-entity model that will replace the
current set of parallel "post-like" tables.

## Why

Today the v4 backend stores conceptually similar content across many tables
with mostly-duplicated CRUD code:

- `app_group_posts` — group feed posts
- `app_group_tasks` — group tasks with per-user done state
- `app_group_extra_lessons` — ad-hoc scheduled lessons
- `app_coordinator_announcements` — coordinator broadcasts
- `app_chat_messages` — direct messages
- `app_global_chat_messages` — global chat messages
- `app_group_feed_reactions` — reactions, scoped to feed posts only

Each surface re-implements pagination, soft-delete, edit-history, pin/unpin,
mention extraction, and reaction toggling. Roughly ~1600 LOC of duplicated
plumbing across services and routes. New "post-like" features (polls,
events) would compound the duplication.

## Goal

Collapse every post-like entity into one universal table with a
discriminator column. A single CRUD layer handles all kinds; per-kind
specifics live inside the JSON `payload`.

## Discriminator pattern

`app_social_entity.kind` is the discriminator. The TypeScript type
`SocialPayloadByKind` maps each kind to its payload shape:

| kind             | scope_type     | payload shape (abridged)                       |
| ---------------- | -------------- | ---------------------------------------------- |
| `post`           | `group`        | `{ title?, body, tags? }`                      |
| `task`           | `group`        | `{ title, body, dueAt?, completedByUserIds? }` |
| `extra_lesson`   | `group`        | `{ subject, teacher?, room?, startsAt, ... }`  |
| `poll`           | `group`        | `{ question, options[], votes? }`              |
| `event`          | `group`        | `{ title, startsAt, location?, rsvpStatus? }`  |
| `announcement`   | `announcement` | `{ title, body, priority, targetGroups? }`     |
| `dm_message`     | `dm`           | `{ body, replyToMessageId? }`                  |
| `global_message` | `global`       | `{ body, replyToMessageId? }`                  |

`scope_id` is a namespaced identifier (e.g. `group:ITS-21`, `dm:roomId`),
built by `buildScopeId(scopeType, raw)`. Reads/writes always go through the
scope index, never against `kind` alone.

Cross-cutting tables share the same `entity_id` reference:

- `app_social_comment` — threaded comments (`depth` 0 or 1)
- `app_social_reaction` — generalized emoji reactions
- `app_social_mention` — `@user` targets for notifications
- `app_social_attachment` — file/image associations via the existing R2 registry
- `app_social_revision` — full edit history snapshots

## Phased rollout

### Phase 1a — Foundation (this change, additive)

- Add the six new tables to `backend/src/db/postgres.ts`.
- Add TypeScript types in `backend/src/types/social.ts`.
- Add the pure helpers in `backend/src/services/social.ts` —
  `validateBody`, `validateTitle`, `validateCommentBody`,
  `extractMentions`, `buildScopeId`, `isAllowedReactionEmoji`.
- Stub the CRUD methods (`createEntity`, `updateEntity`, etc.) so the
  contract surface is fixed even though no implementation exists.
- Zero impact on existing tables, routes, services, or the frontend.

### Phase 1b — CRUD implementation

Fill in the CRUD stubs against the new tables. Add per-method unit tests
with a `FakeClient` similar to `group-reactions.test.ts`. No legacy code
calls these yet; the new endpoints are exercised in tests only.

### Phase 1c — Backward-compatibility shim

Legacy routes (group feed, tasks, extra lessons, announcements, DM, global
chat) keep their public schemas but write through the universal service in
addition to writing the legacy tables. Reads still come from legacy tables.

### Phase 1d — Copy-write migration

A one-shot script copies all existing rows from the legacy tables into
`app_social_entity` (and their reactions into `app_social_reaction`),
preserving IDs where possible. Subsequent dual-writes continue. Reads are
gradually flipped to the universal table behind a feature flag.

### Phase 1d executed (date placeholder — run on demand)

Implementation: `backend/src/scripts/migrate-social-store.ts`. The script
backfills pre-shim rows for the six covered kinds (`post`, `task`,
`extra_lesson`, `announcement`, `dm_message`, `global_message`). It is
idempotent — successful copies clear themselves from the
`WHERE social_entity_id IS NULL` filter, so re-runs are safe.

Operator workflow:

```bash
cd backend
npm run migrate:social -- --dry-run            # preview, no INSERTs
npm run migrate:social                          # apply, all six kinds
npm run migrate:social -- --kinds=post,task     # selective backfill
npm run migrate:social -- --batch-size=200 --limit=500 --verbose
```

Per-row mapping mirrors the Phase 1c shim implementations exactly (see
`backend/src/services/*-shim.ts`):

| kind             | source table                    | scope_id              | payload                                                   |
| ---------------- | ------------------------------- | --------------------- | --------------------------------------------------------- |
| `post`           | `app_group_posts`               | `group:${group_key}`  | `{ title, body }`                                         |
| `task`           | `app_group_tasks`               | `group:${group_key}`  | `{ title, body: description ?? subject ?? '', dueAt? }`   |
| `extra_lesson`   | `app_group_extra_lessons`       | `group:${group_key}`  | `{ subject, startsAt, endsAt?, teacher?, room?, note? }`  |
| `announcement`   | `app_coordinator_announcements` | `announcement:global` | `{ title, body, priority (coerced), targetGroups?, expiresAt? }` |
| `dm_message`     | `app_chat_messages`             | `dm:${room_id}`       | `{ body, replyToMessageId?, editedAt? }`                  |
| `global_message` | `app_global_chat_messages`      | `global:chat`         | `{ body }`                                                |

Preservation rules:

- The mirror entity's `created_at` is set to the legacy row's `created_at`
  (not `now()`), so the universal timeline is not skewed by the migration day.
- Soft-deleted legacy rows (`deleted_at` set, or `revoked_at` for announcements)
  have their tombstone fields replayed onto the mirror via a follow-up UPDATE.
- Legacy global-chat `pinned_at` is replayed onto `app_social_entity.pinned`.
- `@user` mentions are extracted from each migrated payload and inserted into
  `app_social_mention`.

Deliberately NOT migrated in Phase 1d:

- Per-user task completion (`completedByUserIds`) — legacy schema is a single
  boolean, see notes in `group-tasks-shim.ts`.
- Attachments — no reliable legacy → R2 storage mapping exists at this layer.
- One-off synthetic `'create'` revisions — pure noise; legacy
  `app_group_content_revisions` is the historical record.

### Reactions side-data (Phase 1c + 1d, opt-in)

Reactions are not an entity kind — they're a `(post_id, user_id, emoji)`
triple on `app_group_feed_reactions`. The universal home is
`app_social_reaction`, keyed on the parent post's mirror `entity_id`. The
rollout matches the entity shims but is decoupled from them:

- **Shim** (`backend/src/services/group-reactions-shim.ts`):
  `services/group-reactions.ts#toggleReaction` dual-writes every add/remove
  into `app_social_reaction` via two explicit primitives:
  - `shimMirrorAddGroupReaction` → `INSERT … ON CONFLICT (entity_id, user_id, emoji) DO NOTHING`.
  - `shimMirrorRemoveGroupReaction` → `DELETE … WHERE entity_id = $1 AND user_id = $2 AND emoji = $3`.
  We deliberately do NOT route through `services/social.ts#toggleReaction` for
  the remove path — that helper flips state based on current mirror contents,
  but during Phase 1 the legacy table is source-of-truth, so we mirror its
  decision verbatim. Failure is non-fatal (matches every other shim).
  When the parent post's `social_entity_id` link is missing (pre-shim row),
  the shim warns and no-ops; that triple is picked up by the backfill below.

- **Backfill** (`scripts/migrate-social-store.ts#migrateReactions`, opt-in via
  `--with-reactions`). The SELECT joins `app_group_feed_reactions` to
  `app_group_posts` on the back-link AND adds a `NOT EXISTS` against
  `app_social_reaction` so re-runs are safe. Reactions on orphan legacy posts
  (no `social_entity_id`) are skipped until their parent post migrates. The
  `created_at` from the legacy row is preserved on the mirror.

  ```bash
  npm run migrate:social -- --dry-run --with-reactions
  npm run migrate:social -- --with-reactions
  npm run migrate:social -- --kinds=post --with-reactions   # entities + reactions
  ```

  Summary stats include a `reactionsCopied` counter and a per-pass
  `reactions: { scanned, copied, skipped, failed }` breakdown.

### Phase 1e — Cutover and drop

Once read traffic is fully on `app_social_entity`, legacy tables become
read-only, then are dropped. The duplicated CRUD code in the legacy
services is deleted. The frontend is unchanged through the entire
migration — the route contracts stay stable.

## SSE realtime channel

`backend/src/routes/social-stream.ts` exposes the universal social bus as a
read-only SSE stream. The backend listener taps the same `socialEvents`
`EventEmitter` that the push fan-out (`services/social-events.ts`) uses, so
a single in-process emit covers both delivery paths.

### Endpoint

```
GET /api/v3/social/stream?scopes=group:ITS-21,dm:direct:alice::bob,global:chat
```

- Auth: `app.authenticate` preHandler (JWT required, same model as the REST
  routes). Anonymous → `401 SOCIAL_UNAUTHENTICATED`.
- Query: `scopes` is a comma-separated list of `type:id` entries.
  - Allowed types: `group`, `dm`, `global`, `announcement`.
  - Unknown types, malformed entries, and duplicates are silently dropped.
  - Hard cap of 64 scopes per connection.
- Response headers:
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no` (disables nginx response buffering)
- First wire frame is the `:ok` SSE comment, used as a "stream is live"
  signal for the client's `EventSource` readyState transition.

### Authorization

Scope access is resolved **once on connect** (POC trade-off — avoids
re-checking PG on every event on the hot path):

| scopeType      | check                                                 |
| -------------- | ----------------------------------------------------- |
| `global`       | any authenticated user                                |
| `announcement` | any authenticated user                                |
| `group`        | `assertCanReadGroup(userId, rawId)` must not throw    |
| `dm`           | viewer must be a participant of the direct room       |

Rejected scopes are silently filtered out — the stream still opens with the
remaining allowed set. A client that subscribes to zero allowed scopes will
still see heartbeats but no business events.

### Event format

Each business event is a single SSE frame:

```
event: <name>\ndata: <json>\n\n
```

| event             | data payload (abridged)                                          |
| ----------------- | ---------------------------------------------------------------- |
| `entity-created`  | `{ id, kind, scopeType, scopeId, authorUserId, pinned, createdAt }` |
| `comment-created` | `{ id, entityId, parentCommentId, authorUserId, createdAt, scopeType, scopeId, parentEntity: { id, kind, authorUserId } }` |

Frames are filtered against the connection's resolved allowed scope set —
the comparison key is `${scopeType}:${scopeId}` (entities are already stored
with the canonical scope id via `buildScopeId`).

### Heartbeat

A `:heartbeat\n\n` SSE comment is written every 30 seconds while the
connection is open. This stays well below the typical proxy idle timeout
(~100s on Cloudflare / nginx defaults) so connections survive quiet windows.

### Cleanup / backpressure

- `request.raw.on('close')` (plus `'error'` and the response twin) is the
  single source of truth for client disconnect — covers both browser
  navigation and broken-pipe writes.
- The cleanup hook clears the heartbeat interval, calls `socialEvents.off`
  for both listeners, and ends the underlying response.
- Writes are wrapped in a guarded `safeWrite` helper that swallows
  `writableEnded`/`destroyed` to avoid throwing during teardown races.
- The heartbeat timer is `.unref()`ed so it never blocks process exit
  during test teardown.

### Frontend integration TODO

The browser client lands in a follow-up. Expected shape:

```ts
const es = new EventSource(`/api/v3/social/stream?scopes=${encodeURIComponent(scopes.join(','))}`, {
    withCredentials: true,
});
es.addEventListener('entity-created', (evt) => { ... });
es.addEventListener('comment-created', (evt) => { ... });
es.onerror = () => { /* EventSource auto-reconnects; back off on repeated 401 */ };
```

Frontend concerns (out of scope for this skeleton):

- Reconnect backoff: `EventSource` already auto-reconnects with the
  `retry:` directive (default 3s). The client should add jittered
  exponential backoff on persistent failure to avoid hot loops.
- Scope subscribe API: when the viewer navigates between group/dm views,
  the existing `EventSource` connection has to be torn down and reopened
  with the new `scopes` query — `EventSource` has no in-flight subscribe
  primitive.
- State merge: incoming `entity-created` / `comment-created` should patch
  the local React Query cache and trigger a lightweight refetch only when
  the cached entity is older than the event timestamp.
- Auth refresh: if the cookie expires mid-stream the server will close the
  socket on the next emit; the client should drive a silent re-login + new
  `EventSource` rather than retrying the dead one.
