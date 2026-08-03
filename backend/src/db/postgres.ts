import { Pool, type PoolClient } from 'pg';

const TEMP_DISABLE_MS = 15_000;

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;
let disabledReason: string | null = null;
let disabledUntilMs = 0;
let activeConnectionString: string | null = null;

export function resolveConnectionString(): string {
    return (
        process.env.SUPABASE_POOLER_URL ||
        process.env.SUPABASE_DIRECT_URL ||
        process.env.SUPABASE_DATABASE_URL ||
        process.env.DATABASE_URL ||
        ''
    );
}

export function summarizePgError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return 'unknown postgres error';
}

export function isConnectionLevelPostgresError(error: unknown): boolean {
    const message = summarizePgError(error).toLowerCase();
    return [
        'econnrefused',
        'connection terminated unexpectedly',
        'timeout expired',
        'terminating connection',
        'server closed the connection unexpectedly',
        'getaddrinfo',
        'enotfound',
        'connect timeout',
        'connection reset',
        'connection ended unexpectedly',
        'the database system is starting up',
        'too many clients',
        'cannot connect now',
        'remaining connection slots are reserved',
    ].some((fragment) => message.includes(fragment));
}

async function disablePoolTemporarily(reason: string): Promise<void> {
    disabledReason = reason;
    disabledUntilMs = Date.now() + TEMP_DISABLE_MS;
    console.warn(
        `[Supabase Postgres] Temporarily disabled for ${TEMP_DISABLE_MS}ms: ${disabledReason}`
    );
    initPromise = null;
    if (pool) {
        await pool.end().catch(() => { });
        pool = null;
    }
}

function getPool(): Pool | null {
    const connectionString = resolveConnectionString();
    const isConfigured = Boolean(connectionString);
    if (!isConfigured) return null;
    if (disabledReason && Date.now() >= disabledUntilMs) {
        disabledReason = null;
        disabledUntilMs = 0;
    }
    if (disabledReason) return null;
    if (pool && activeConnectionString && activeConnectionString !== connectionString) {
        pool.end().catch(() => { });
        pool = null;
        initPromise = null;
    }
    if (!pool) {
        activeConnectionString = connectionString;
        pool = new Pool({
            connectionString,
            connectionTimeoutMillis: 5000,
            ssl: connectionString.includes('supabase.co')
                ? { rejectUnauthorized: false }
                : undefined,
        });
    }
    return pool;
}

async function securePublicAppTables(client: PoolClient): Promise<void> {
    await client.query(`
        do $$
        declare
            table_row record;
            sequence_row record;
            role_name text;
        begin
            foreach role_name in array array['anon', 'authenticated']
            loop
                if to_regrole(role_name) is not null then
                    execute format('revoke all on schema public from %I', role_name);
                    execute format('grant usage on schema public to %I', role_name);
                    execute format('alter default privileges in schema public revoke all on tables from %I', role_name);
                    execute format('alter default privileges in schema public revoke all on sequences from %I', role_name);
                end if;
            end loop;

            if to_regrole('service_role') is not null then
                execute 'alter default privileges in schema public grant all on tables to service_role';
                execute 'alter default privileges in schema public grant all on sequences to service_role';
            end if;

            for table_row in
                select schemaname, tablename
                from pg_tables
                where schemaname = 'public'
                  and (tablename like 'app\\_%' escape '\\' or tablename = 'user_teacher_notes')
            loop
                foreach role_name in array array['anon', 'authenticated']
                loop
                    if to_regrole(role_name) is not null then
                        execute format(
                            'revoke all privileges on table %I.%I from %I',
                            table_row.schemaname,
                            table_row.tablename,
                            role_name
                        );
                    end if;
                end loop;

                if to_regrole('service_role') is not null then
                    execute format(
                        'grant all privileges on table %I.%I to service_role',
                        table_row.schemaname,
                        table_row.tablename
                    );
                end if;

                execute format('alter table %I.%I enable row level security', table_row.schemaname, table_row.tablename);
            end loop;

            for sequence_row in
                select sequence_schema, sequence_name
                from information_schema.sequences
                where sequence_schema = 'public'
                  and (sequence_name like 'app\\_%' escape '\\' or sequence_name = 'user_teacher_notes')
            loop
                foreach role_name in array array['anon', 'authenticated']
                loop
                    if to_regrole(role_name) is not null then
                        execute format(
                            'revoke all privileges on sequence %I.%I from %I',
                            sequence_row.sequence_schema,
                            sequence_row.sequence_name,
                            role_name
                        );
                    end if;
                end loop;

                if to_regrole('service_role') is not null then
                    execute format(
                        'grant all privileges on sequence %I.%I to service_role',
                        sequence_row.sequence_schema,
                        sequence_row.sequence_name
                    );
                end if;
            end loop;
        end$$;
    `);
}

async function createSchema(client: PoolClient): Promise<void> {
    await client.query(`
        create table if not exists app_generic_cache (
            cache_key text primary key,
            data_json jsonb not null,
            created_at timestamptz not null default now(),
            expires_at timestamptz not null
        );
    `);

    await client.query(`
        create table if not exists app_users (
            user_id text primary key,
            password_encrypted text not null,
            created_at timestamptz not null default now(),
            last_login timestamptz not null default now(),
            settings_json jsonb not null default '{"language":"ru","notifications":true,"theme":"system"}'::jsonb
        );
    `);

    await client.query(`
        create table if not exists app_staff_accounts (
            user_id text primary key,
            password_encrypted text not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create table if not exists app_platonus_sessions (
            user_id text primary key,
            platonus_login text not null,
            password_encrypted text not null,
            token text not null,
            sid text not null,
            cookie_string text null,
            person_id text null,
            created_at timestamptz not null,
            expires_at timestamptz not null
        );
    `);

    await client.query(`
        alter table app_platonus_sessions
        alter column person_id drop not null;
    `);

    await client.query(`
        create index if not exists idx_app_platonus_sessions_expires_at
        on app_platonus_sessions (expires_at);
    `);

    await client.query(`
        create table if not exists app_schedule_cache (
            user_id text primary key,
            data_json jsonb not null,
            cached_at timestamptz not null,
            expires_at timestamptz not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_schedule_cache_expires_at
        on app_schedule_cache (expires_at);
    `);

    await client.query(`
        create table if not exists app_exams_cache (
            user_id text primary key,
            data_json jsonb not null,
            cached_at timestamptz not null,
            expires_at timestamptz not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_exams_cache_expires_at
        on app_exams_cache (expires_at);
    `);

    await client.query(`
        create table if not exists app_platonus_grades_cache (
            user_id text not null,
            year integer not null,
            semester integer not null,
            data_json jsonb not null,
            cached_at timestamptz not null,
            expires_at timestamptz not null,
            primary key (user_id, year, semester)
        );
    `);

    await client.query(`
        create index if not exists idx_app_platonus_grades_cache_expires_at
        on app_platonus_grades_cache (expires_at);
    `);

    // Persistent, cross-user per-subject grade store powering the subject
    // leaderboard. Unlike the per-user grade caches above, this survives so we
    // can rank users by subject across cohorts/semesters. Populated best-effort
    // when a user's Platonus grades / Univer transcript are fetched. One row per
    // (user, normalized subject, term, source); upsert keeps the latest score.
    await client.query(`
        create table if not exists app_subject_grades (
            user_id text not null,
            subject_key text not null,
            subject_label text not null,
            year integer not null,
            semester integer not null,
            source text not null,
            score numeric(6,2),
            gpa numeric(4,2),
            letter text,
            updated_at timestamptz not null default now(),
            primary key (user_id, subject_key, year, semester, source)
        );
    `);

    await client.query(`
        create index if not exists idx_subject_grades_key
        on app_subject_grades (subject_key, score desc);
    `);

    await client.query(`
        create table if not exists app_feedback (
            id bigserial primary key,
            kind text not null,
            user_id text not null,
            rating integer null,
            category text null,
            message text null,
            page text null,
            last_path text null,
            app_version text null,
            status text null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create unique index if not exists idx_app_feedback_rating_user
        on app_feedback (user_id)
        where kind = 'rating';
    `);

    await client.query(`
        create index if not exists idx_app_feedback_kind_created_at
        on app_feedback (kind, created_at desc);
    `);

    await client.query(`
        create table if not exists app_request_audit (
            id bigserial primary key,
            created_at timestamptz not null default now(),
            req_id text not null,
            route_kind text null,
            method text not null,
            url text not null,
            path text not null,
            status_code integer not null,
            duration_ms integer not null,
            ip text null,
            user_id text null,
            session_id text null,
            source text null,
            host text null,
            user_agent text null,
            referer text null,
            origin text null,
            content_length integer null,
            response_bytes integer null,
            error_code text null,
            error_message text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_request_audit_created_at
        on app_request_audit (created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_request_audit_webapp_session_summary
        on app_request_audit (source, created_at desc, session_id)
        include (user_id, path)
        where coalesce(session_id, '') <> '';
    `);

    await client.query(`
        create index if not exists idx_app_request_audit_webapp_user_summary
        on app_request_audit (source, created_at desc, user_id)
        where coalesce(user_id, '') <> '';
    `);

    await client.query(`
        create index if not exists idx_app_request_audit_error_path_user
        on app_request_audit (created_at desc, path text_pattern_ops, user_id)
        where status_code >= 400
          and coalesce(user_id, '') <> '';
    `);

    await client.query(`
        alter table app_request_audit
        alter column route_kind drop not null;
    `);

    await client.query(`
        create table if not exists app_action_logs (
            id bigserial primary key,
            created_at timestamptz not null default now(),
            user_id text not null,
            action text not null,
            details text null,
            req_id text null,
            session_id text null,
            route_kind text null,
            path text null,
            source text null,
            target_user_id text null,
            group_key text null,
            entity_id text null,
            result text null,
            metadata_json jsonb null
        );
    `);

    await client.query(`
        create index if not exists idx_app_action_logs_created_at
        on app_action_logs (created_at desc);
    `);

    await client.query(`
        create table if not exists app_runtime_traces (
            id bigserial primary key,
            created_at timestamptz not null default now(),
            source text not null,
            scope text not null,
            event text not null,
            level text not null,
            message text not null,
            user_id text null,
            session_id text null,
            req_id text null,
            route_kind text null,
            path text null,
            metadata_json jsonb null
        );
    `);

    await client.query(`
        create index if not exists idx_app_runtime_traces_created_at
        on app_runtime_traces (created_at desc);
    `);

    await client.query(`
        create table if not exists app_analytics_events (
            id bigserial primary key,
            created_at timestamptz not null default now(),
            event_at timestamptz not null,
            event_type text not null,
            session_id text not null,
            client_id text not null,
            user_id text null,
            path text null,
            referrer text null,
            utm_json jsonb null,
            device_json jsonb null,
            metrics_json jsonb null,
            meta_json jsonb null,
            ip_hash text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_analytics_events_created_at
        on app_analytics_events (created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_analytics_events_user_created
        on app_analytics_events (user_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_analytics_events_session_created
        on app_analytics_events (session_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_analytics_events_type_created
        on app_analytics_events (event_type, created_at desc);
    `);

    await client.query(`
        create table if not exists app_teacher_directory (
            id text primary key,
            canonical_name text not null,
            normalized_name text not null unique,
            created_by text not null,
            source_url text null,
            created_at timestamptz not null,
            updated_at timestamptz not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_teacher_directory_normalized_name
        on app_teacher_directory (normalized_name);
    `);

    // Phase 1 anti-abuse: verified-source signal + provenance.
    await client.query(`
        alter table app_teacher_directory
            add column if not exists is_verified boolean not null default false;
    `);
    await client.query(`
        alter table app_teacher_directory
            add column if not exists created_by_source text not null default 'user';
    `);
    // Backfill: rows that already have source_url are verified.
    await client.query(`
        update app_teacher_directory
        set is_verified = true
        where source_url is not null and is_verified = false;
    `);

    await client.query(`
        create table if not exists app_teacher_ratings (
            id text primary key,
            teacher_id text not null,
            user_id text not null,
            tier text not null,
            personal_rank integer null,
            tags_json jsonb not null default '[]'::jsonb,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            unique (teacher_id, user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_app_teacher_ratings_teacher_updated
        on app_teacher_ratings (teacher_id, updated_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_teacher_ratings_user_updated
        on app_teacher_ratings (user_id, updated_at desc);
    `);

    await client.query(`
        create table if not exists app_group_spaces (
            id text primary key,
            group_key text not null unique,
            title text not null,
            slug text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null
        );
    `);

    await client.query(`
        create table if not exists app_group_memberships (
            id text primary key,
            user_id text not null,
            group_key text not null,
            source text not null,
            active boolean not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            created_by text not null,
            reason text null,
            removed_at timestamptz null,
            removed_by text null,
            removal_reason text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_memberships_user_group_active
        on app_group_memberships (user_id, group_key, active);
    `);

    await client.query(`
        create table if not exists app_group_role_assignments (
            id text primary key,
            user_id text not null,
            role_id text not null,
            scope_type text not null,
            scope_id text not null,
            active boolean not null,
            assigned_by text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            reason text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_role_assignments_lookup
        on app_group_role_assignments (user_id, scope_type, scope_id, active);
    `);

    await client.query(`
        create table if not exists app_group_join_requests (
            id text primary key,
            user_id text not null,
            group_key text not null,
            status text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            reason text null,
            detected_group_key text null,
            reviewed_at timestamptz null,
            reviewed_by text null,
            review_note text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_join_requests_group_status
        on app_group_join_requests (group_key, status, created_at desc);
    `);

    await client.query(`
        create table if not exists app_group_membership_disputes (
            id text primary key,
            user_id text not null,
            group_key text not null,
            issue_type text not null,
            status text not null,
            reason text not null,
            detected_group_key text null,
            active_group_key text null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            reviewed_at timestamptz null,
            reviewed_by text null,
            review_note text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_membership_disputes_group_status
        on app_group_membership_disputes (group_key, status, created_at desc);
    `);

    await client.query(`
        create table if not exists app_group_posts (
            id text primary key,
            group_key text not null,
            title text not null,
            body text not null,
            author_user_id text not null,
            pinned boolean not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            deleted_at timestamptz null,
            deleted_by text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_posts_group_created
        on app_group_posts (group_key, created_at desc);
    `);

    // Phase 1c — universal social store dual-write shim.
    // Nullable link from a legacy group-post row to its mirror entity in
    // app_social_entity. `on delete set null` keeps legacy rows intact if the
    // mirror is ever wiped directly. See docs/SOCIAL_STORE.md.
    await client.query(`
        alter table app_group_posts
            add column if not exists social_entity_id uuid null;
    `);
    await client.query(`
        create index if not exists idx_app_group_posts_social_entity
        on app_group_posts (social_entity_id);
    `);

    await client.query(`
        create table if not exists app_group_feed_reactions (
            post_id uuid not null,
            user_id text not null,
            emoji text not null,
            created_at timestamptz not null default now(),
            primary key (post_id, user_id, emoji)
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_feed_reactions_post
        on app_group_feed_reactions(post_id);
    `);

    await client.query(`
        create table if not exists app_group_tasks (
            id text primary key,
            group_key text not null,
            title text not null,
            subject text null,
            description text null,
            deadline timestamptz null,
            priority text not null,
            author_user_id text not null,
            completed boolean not null,
            completed_at timestamptz null,
            completed_by text null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            deleted_at timestamptz null,
            deleted_by text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_tasks_group_created
        on app_group_tasks (group_key, created_at desc);
    `);

    // Phase 1c — universal social store dual-write shim (group_tasks).
    // Same shape as the app_group_posts mirror link: nullable uuid pointing at
    // the matching row in app_social_entity, plus an index for lookups by
    // social id. See docs/SOCIAL_STORE.md.
    await client.query(`
        alter table app_group_tasks
            add column if not exists social_entity_id uuid null;
    `);
    await client.query(`
        create index if not exists idx_app_group_tasks_social_entity
        on app_group_tasks (social_entity_id);
    `);

    await client.query(`
        create table if not exists app_group_extra_lessons (
            id text primary key,
            group_key text not null,
            title text not null,
            date timestamptz not null,
            start_time text not null,
            end_time text not null,
            room text null,
            teacher text null,
            note text null,
            author_user_id text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            deleted_at timestamptz null,
            deleted_by text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_extra_lessons_group_date
        on app_group_extra_lessons (group_key, date asc, start_time asc);
    `);

    // Phase 1c — universal social store dual-write shim (group_extra_lessons).
    // Same shape as the app_group_posts / app_group_tasks mirror links.
    await client.query(`
        alter table app_group_extra_lessons
            add column if not exists social_entity_id uuid null;
    `);
    await client.query(`
        create index if not exists idx_app_group_extra_lessons_social_entity
        on app_group_extra_lessons (social_entity_id);
    `);

    // === Universal Social Entity Store (Phase 1a — additive foundation) ===
    // One row per post / task / lesson / poll / event / announcement / dm /
    // global message. `kind` is the discriminator, `payload` holds the
    // kind-specific shape. See docs/SOCIAL_STORE.md for the migration plan.
    // Legacy tables (app_group_posts/tasks/extra_lessons, app_coordinator_
    // announcements, app_chat_messages, app_global_chat_messages,
    // app_group_feed_reactions) remain untouched during Phase 1a.
    await client.query(`
        create table if not exists app_social_entity (
            id uuid primary key default gen_random_uuid(),
            kind text not null check (kind in (
                'post', 'task', 'extra_lesson', 'poll', 'event',
                'announcement', 'dm_message', 'global_message'
            )),
            scope_type text not null check (scope_type in ('group', 'dm', 'global', 'announcement')),
            scope_id text not null,
            author_user_id text not null,
            payload jsonb not null default '{}'::jsonb,
            pinned boolean not null default false,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            deleted_at timestamptz,
            deleted_by_user_id text,
            deleted_reason text
        );
    `);

    await client.query(`
        create index if not exists idx_social_entity_scope
        on app_social_entity(scope_type, scope_id, deleted_at);
    `);

    await client.query(`
        create index if not exists idx_social_entity_kind_scope
        on app_social_entity(kind, scope_type, scope_id, deleted_at);
    `);

    await client.query(`
        create index if not exists idx_social_entity_author
        on app_social_entity(author_user_id);
    `);

    await client.query(`
        create index if not exists idx_social_entity_created
        on app_social_entity(created_at desc);
    `);

    // Threaded comments. depth = 0 for top-level; depth = 1 for replies-to-
    // comment. The service layer caps depth at 1 (no UI for deeper threads).
    await client.query(`
        create table if not exists app_social_comment (
            id uuid primary key default gen_random_uuid(),
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            parent_comment_id uuid references app_social_comment(id) on delete cascade,
            author_user_id text not null,
            body text not null,
            depth int not null default 0,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            deleted_at timestamptz
        );
    `);

    await client.query(`
        create index if not exists idx_social_comment_entity
        on app_social_comment(entity_id, deleted_at, created_at);
    `);

    await client.query(`
        create index if not exists idx_social_comment_parent
        on app_social_comment(parent_comment_id);
    `);

    // Generalized reactions across every social entity. Mirrors
    // app_group_feed_reactions' composite-PK shape but spans all kinds.
    await client.query(`
        create table if not exists app_social_reaction (
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            user_id text not null,
            emoji text not null,
            created_at timestamptz not null default now(),
            primary key (entity_id, user_id, emoji)
        );
    `);

    await client.query(`
        create index if not exists idx_social_reaction_entity
        on app_social_reaction(entity_id);
    `);

    // Distinct per-user views for social entities. Used by announcements,
    // feed cards, and moderation audit surfaces.
    await client.query(`
        create table if not exists app_social_view (
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            user_id text not null,
            viewed_at timestamptz not null default now(),
            primary key (entity_id, user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_social_view_user
        on app_social_view(user_id, viewed_at desc);
    `);

    // Viewer favorites/bookmarks for any social entity. Board uses this first,
    // but the shape is intentionally generic.
    await client.query(`
        create table if not exists app_social_favorite (
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            user_id text not null,
            created_at timestamptz not null default now(),
            primary key (entity_id, user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_social_favorite_user
        on app_social_favorite(user_id, created_at desc);
    `);

    // Targeted @user mentions. source_kind / source_id let us distinguish
    // entity-mentions ("@bob in a post") from comment-mentions
    // ("@bob in a reply to a post").
    await client.query(`
        create table if not exists app_social_mention (
            id uuid primary key default gen_random_uuid(),
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            source_kind text not null check (source_kind in ('entity', 'comment')),
            source_id uuid not null,
            author_user_id text not null,
            mentioned_user_id text not null,
            created_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create index if not exists idx_social_mention_target
        on app_social_mention(mentioned_user_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_social_mention_source
        on app_social_mention(source_kind, source_id);
    `);

    // Per-recipient read state for the Notification Center UI. The mention
    // table already encodes "(entityOrComment) generated a notification for
    // this user"; tacking `read_at` directly onto the row keeps the read
    // bookkeeping in lockstep with the source-of-truth without introducing a
    // second sparse table. Added via `add column if not exists` so existing
    // deployments pick it up on the next bootstrap pass.
    await client.query(`
        alter table app_social_mention
        add column if not exists read_at timestamptz;
    `);

    // Partial index — most rows are unread, so we only index the unread
    // recipients to keep the unread-count and inbox scans cheap.
    await client.query(`
        create index if not exists idx_social_mention_target_unread
        on app_social_mention(mentioned_user_id, created_at desc)
        where read_at is null;
    `);

    // File / image attachments. file_id refers to the existing storage/R2
    // registry; this row is just the (entity_id, file_id) association.
    await client.query(`
        create table if not exists app_social_attachment (
            id uuid primary key default gen_random_uuid(),
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            file_id text not null,
            mime text,
            size_bytes bigint,
            sort_order int not null default 0,
            created_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create index if not exists idx_social_attachment_entity
        on app_social_attachment(entity_id, sort_order);
    `);

    // Edit history. snapshot is the entity's payload at the time of the edit.
    await client.query(`
        create table if not exists app_social_revision (
            id uuid primary key default gen_random_uuid(),
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            author_user_id text not null,
            snapshot jsonb not null,
            revision_kind text not null check (revision_kind in ('create', 'update', 'delete', 'restore')),
            note text,
            created_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create index if not exists idx_social_revision_entity
        on app_social_revision(entity_id, created_at desc);
    `);

    // Per-viewer read markers for the universal social store. Tracks the last
    // time a given user observed entities in a given scope (e.g. `dm:roomId`).
    // Composite primary key (user_id, scope_type, scope_id) makes upserts cheap
    // and means a viewer can have at most one marker per scope. `last_read_at`
    // is the timestamp used for unread-count computation; `last_read_entity_id`
    // is the optional anchor entity for richer "since X" semantics later.
    //
    // This is the v4 read-receipts foundation for DMs (kind = `dm_message`).
    // The legacy `markChatRoomRead` flow remains untouched on `app_chat_rooms`.
    await client.query(`
        create table if not exists app_social_read_marker (
            user_id text not null,
            scope_type text not null,
            scope_id text not null,
            last_read_at timestamptz not null default now(),
            last_read_entity_id uuid,
            primary key (user_id, scope_type, scope_id)
        );
    `);

    await client.query(`
        create index if not exists idx_social_read_marker_user
        on app_social_read_marker(user_id);
    `);

    // Universal social moderation tables. Referenced by
    // services/social-moderation.ts (isUserMuted / muteUser / reportEntity /
    // listReports / reviewReport). Previously these were assumed to exist but
    // were never created in the lazy schema, so the FIRST call to isUserMuted
    // (e.g. posting to the student board) threw "relation does not exist".
    //
    // app_social_mute: at most one mute per (user, scope) — the composite PK
    // backs the `on conflict (user_id, scope_type, scope_id)` upsert in muteUser.
    await client.query(`
        create table if not exists app_social_mute (
            user_id text not null,
            scope_type text not null,
            scope_id text not null,
            muted_until timestamptz,
            reason text,
            moderator_user_id text not null,
            created_at timestamptz not null default now(),
            primary key (user_id, scope_type, scope_id)
        );
    `);

    // app_social_report: abuse reports against any social entity. `status`
    // moves pending → actioned | dismissed via reviewReport.
    await client.query(`
        create table if not exists app_social_report (
            id uuid primary key default gen_random_uuid(),
            entity_id uuid not null references app_social_entity(id) on delete cascade,
            reporter_user_id text not null,
            reason text,
            status text not null default 'pending',
            reviewer_user_id text,
            reviewed_at timestamptz,
            created_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create index if not exists idx_social_report_status
        on app_social_report(status, created_at desc);
    `);

    // === Link preview / unfurl cache ====================================
    // Cache of Open Graph metadata for URLs found in social entity bodies.
    // `url_hash` is sha256(normalizeUrl(url)) — keeps the PK small/binary-safe.
    // `status` distinguishes a successful fetch ('ok') from a permanent failure
    // ('failed' — non-HTML, 4xx, etc.) and a blocked target ('blocked' — SSRF
    // protection rejected the resolved IP). The router caches every outcome so
    // a misbehaving URL is not re-fetched on every message render.
    await client.query(`
        create table if not exists app_link_preview_cache (
            url_hash text primary key,
            url text not null,
            title text,
            description text,
            image_url text,
            site_name text,
            fetched_at timestamptz not null default now(),
            expires_at timestamptz not null default now() + interval '7 days',
            status text not null default 'ok'
        );
    `);

    await client.query(`
        create index if not exists idx_link_preview_expires
        on app_link_preview_cache(expires_at);
    `);

    // Phase 1c — once both app_group_posts and app_social_entity exist, wire the
    // dual-write link with a deferred FK. `do $$ ... $$` keeps the migration
    // idempotent across restarts (no built-in `add constraint if not exists`).
    await client.query(`
        do $$
        begin
            if not exists (
                select 1 from pg_constraint
                where conname = 'fk_app_group_posts_social_entity'
            ) then
                alter table app_group_posts
                    add constraint fk_app_group_posts_social_entity
                    foreign key (social_entity_id)
                    references app_social_entity(id)
                    on delete set null;
            end if;
        end$$;
    `);

    // Phase 1c — same deferred FK for app_group_tasks and app_group_extra_lessons.
    await client.query(`
        do $$
        begin
            if not exists (
                select 1 from pg_constraint
                where conname = 'fk_app_group_tasks_social_entity'
            ) then
                alter table app_group_tasks
                    add constraint fk_app_group_tasks_social_entity
                    foreign key (social_entity_id)
                    references app_social_entity(id)
                    on delete set null;
            end if;
        end$$;
    `);

    await client.query(`
        do $$
        begin
            if not exists (
                select 1 from pg_constraint
                where conname = 'fk_app_group_extra_lessons_social_entity'
            ) then
                alter table app_group_extra_lessons
                    add constraint fk_app_group_extra_lessons_social_entity
                    foreign key (social_entity_id)
                    references app_social_entity(id)
                    on delete set null;
            end if;
        end$$;
    `);

    // Phase 1c — same deferred FK for app_coordinator_announcements. Wires the
    // dual-write link to app_social_entity. `on delete set null` keeps legacy
    // announcement rows intact if the mirror entity is ever wiped directly.
    //
    // Bug fix: the `add column if not exists social_entity_id` for this table
    // lives further down in createSchema() (the legacy announcements block).
    // On a fresh schema the table is created earlier without the column, so
    // the FK creation here was failing with "column does not exist" and
    // tripping the Supabase pool circuit breaker. We now ensure the column
    // is present inside the same DO block, immediately before the FK.
    await client.query(`
        do $$
        begin
            if to_regclass('public.app_coordinator_announcements') is not null then
                execute 'alter table app_coordinator_announcements add column if not exists social_entity_id uuid null';
                if not exists (
                    select 1 from pg_constraint
                    where conname = 'fk_app_coordinator_announcements_social_entity'
                ) then
                    alter table app_coordinator_announcements
                        add constraint fk_app_coordinator_announcements_social_entity
                        foreign key (social_entity_id)
                        references app_social_entity(id)
                        on delete set null;
                end if;
            end if;
        end$$;
    `);

    // Phase 1c — deferred FK for app_chat_messages (DM dual-write link).
    // Same fix as above: the legacy column-add lives further down, so we
    // re-add the column here right before the FK to survive a fresh-schema
    // bootstrap.
    await client.query(`
        do $$
        begin
            if to_regclass('public.app_chat_messages') is not null then
                execute 'alter table app_chat_messages add column if not exists social_entity_id uuid null';
                if not exists (
                    select 1 from pg_constraint
                    where conname = 'fk_app_chat_messages_social_entity'
                ) then
                    alter table app_chat_messages
                        add constraint fk_app_chat_messages_social_entity
                        foreign key (social_entity_id)
                        references app_social_entity(id)
                        on delete set null;
                end if;
            end if;
        end$$;
    `);

    // Phase 1c — deferred FK for app_global_chat_messages dual-write link.
    // Same fix: ensure the column exists in this DO block before adding the FK.
    await client.query(`
        do $$
        begin
            if to_regclass('public.app_global_chat_messages') is not null then
                execute 'alter table app_global_chat_messages add column if not exists social_entity_id uuid null';
                if not exists (
                    select 1 from pg_constraint
                    where conname = 'fk_app_global_chat_messages_social_entity'
                ) then
                    alter table app_global_chat_messages
                        add constraint fk_app_global_chat_messages_social_entity
                        foreign key (social_entity_id)
                        references app_social_entity(id)
                        on delete set null;
                end if;
            end if;
        end$$;
    `);

    await client.query(`
        create table if not exists app_group_links (
            id text primary key,
            group_key text not null,
            title text not null,
            url text not null,
            description text null,
            created_by text not null,
            created_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_links_group
        on app_group_links (group_key, created_at desc);
    `);

    await client.query(`
        create table if not exists app_group_files (
            id text primary key,
            group_key text not null,
            file_id text not null,
            title text not null,
            description text null,
            mime text null,
            size_bytes bigint null,
            created_by text not null,
            created_at timestamptz not null default now()
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_files_group
        on app_group_files (group_key, created_at desc);
    `);

    await client.query(`
        create table if not exists app_coordinator_announcements (
            id text primary key,
            author_user_id text not null,
            title text not null,
            body text not null,
            priority text not null,
            target_mode text not null,
            target_groups_json jsonb not null default '[]'::jsonb,
            expires_at timestamptz null,
            revoked_at timestamptz null,
            created_at timestamptz not null,
            updated_at timestamptz not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_coordinator_announcements_created
        on app_coordinator_announcements (created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_coordinator_announcements_active
        on app_coordinator_announcements (revoked_at, expires_at, created_at desc);
    `);

    // Phase 1c — universal social store dual-write shim (coordinator_announcements).
    // Same shape as the app_group_posts / app_group_tasks / app_group_extra_lessons
    // mirror links: nullable uuid pointing at the matching row in
    // app_social_entity, plus an index for lookups by social id. The legacy
    // table's primary key is `text` (not uuid), so we do NOT change that —
    // the mirror link column is uuid and joins to app_social_entity(id).
    // See docs/SOCIAL_STORE.md.
    await client.query(`
        alter table app_coordinator_announcements
            add column if not exists social_entity_id uuid null;
    `);
    await client.query(`
        create index if not exists idx_app_coordinator_announcements_social_entity
        on app_coordinator_announcements (social_entity_id);
    `);

    await client.query(`
        create table if not exists app_coordinator_announcement_views (
            announcement_id text not null,
            user_id text not null,
            viewed_at timestamptz not null,
            primary key (announcement_id, user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_app_coordinator_announcement_views_announcement
        on app_coordinator_announcement_views (announcement_id, viewed_at desc);
    `);

    await client.query(`
        create table if not exists app_global_chat_messages (
            id text primary key,
            author_user_id text not null,
            body text not null,
            created_at timestamptz not null,
            pinned_at timestamptz null,
            pinned_by text null,
            deleted_at timestamptz null,
            deleted_by text null,
            delete_reason text null
        );
    `);

    await client.query(`
        alter table app_global_chat_messages
        add column if not exists pinned_at timestamptz null;
    `);

    await client.query(`
        alter table app_global_chat_messages
        add column if not exists pinned_by text null;
    `);

    await client.query(`
        alter table app_global_chat_messages
        add column if not exists deleted_at timestamptz null;
    `);

    await client.query(`
        alter table app_global_chat_messages
        add column if not exists deleted_by text null;
    `);

    await client.query(`
        alter table app_global_chat_messages
        add column if not exists delete_reason text null;
    `);

    await client.query(`
        create index if not exists idx_app_global_chat_messages_created
        on app_global_chat_messages (created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_global_chat_messages_author
        on app_global_chat_messages (author_user_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_global_chat_messages_visible
        on app_global_chat_messages (deleted_at, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_global_chat_messages_pinned
        on app_global_chat_messages (pinned_at desc, created_at desc);
    `);

    // Phase 1c — universal social store dual-write shim (global_chat_messages).
    // Nullable uuid link from a legacy global-chat message to its mirror entity
    // in app_social_entity (kind='global_message'). Same shape as the other
    // shim links; the deferred FK is added later (after app_social_entity is
    // created). See docs/SOCIAL_STORE.md.
    await client.query(`
        alter table app_global_chat_messages
            add column if not exists social_entity_id uuid null;
    `);
    await client.query(`
        create index if not exists idx_app_global_chat_messages_social_entity
        on app_global_chat_messages (social_entity_id);
    `);

    await client.query(`
        create table if not exists app_global_chat_mutes (
            id text primary key,
            user_id text not null,
            muted_by text not null,
            reason text null,
            created_at timestamptz not null,
            expires_at timestamptz null,
            revoked_at timestamptz null,
            revoked_by text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_global_chat_mutes_user_active
        on app_global_chat_mutes (user_id, revoked_at, expires_at, created_at desc);
    `);

    await client.query(`
        create table if not exists app_global_chat_reports (
            id text primary key,
            message_id text not null,
            reporter_user_id text not null,
            reason text not null,
            details text null,
            status text not null,
            created_at timestamptz not null,
            reviewed_at timestamptz null,
            reviewed_by text null,
            resolution_note text null
        );
    `);

    await client.query(`
        create unique index if not exists idx_app_global_chat_reports_unique_reporter_message
        on app_global_chat_reports (message_id, reporter_user_id);
    `);

    await client.query(`
        create index if not exists idx_app_global_chat_reports_status_created
        on app_global_chat_reports (status, created_at desc);
    `);

    // ---------------------------------------------------------------------
    // Global Feed schema removed in the /chat rewrite (May 2026).
    //
    // The `app_global_feed_posts` and `app_global_feed_reports` tables are
    // intentionally NOT created on fresh installs anymore — the feature is
    // gone from the product. Existing production rows are treated as
    // soft-deleted; no DROP TABLE is issued so the data is recoverable if
    // we ever want it back. To restore the feature, un-comment the block
    // below and re-introduce backend/src/services/global-feed.ts.
    //
    // await client.query(`
    //     create table if not exists app_global_feed_posts (
    //         id text primary key,
    //         author_user_id text not null,
    //         body text not null,
    //         parent_post_id text null,
    //         root_post_id text null,
    //         depth integer not null default 0,
    //         created_at timestamptz not null,
    //         pinned_at timestamptz null,
    //         pinned_by text null,
    //         deleted_at timestamptz null,
    //         deleted_by text null,
    //         delete_reason text null
    //     );
    // `);
    // ... (alter table / index DDL omitted; see git history if needed) ...
    // ---------------------------------------------------------------------

    await client.query(`
        create table if not exists app_friend_requests (
            id text primary key,
            requester_user_id text not null,
            target_user_id text not null,
            status text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            acted_at timestamptz null,
            acted_by text null
        );
    `);

    await client.query(`
        create unique index if not exists idx_app_friend_requests_pending_pair
        on app_friend_requests (
            least(requester_user_id, target_user_id),
            greatest(requester_user_id, target_user_id)
        )
        where status = 'pending';
    `);

    await client.query(`
        create index if not exists idx_app_friend_requests_target_status
        on app_friend_requests (target_user_id, status, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_friend_requests_requester_status
        on app_friend_requests (requester_user_id, status, created_at desc);
    `);

    await client.query(`
        create table if not exists app_friends (
            user_low text not null,
            user_high text not null,
            created_at timestamptz not null,
            created_from_request_id text null,
            primary key (user_low, user_high)
        );
    `);

    await client.query(`
        create index if not exists idx_app_friends_user_low
        on app_friends (user_low, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_friends_user_high
        on app_friends (user_high, created_at desc);
    `);

    // Phase 1c — universal social friendship table. Replaces the dual
    // legacy tables (app_friend_requests + app_friends) with a single
    // cleaner aggregate keyed on a canonical user pair. Status drives
    // the lifecycle: pending → accepted (active friendship) | rejected |
    // cancelled (by requester) | removed (post-acceptance removal).
    //
    // `pair_key` is a generated column: `least(a, b) || '::' || greatest(a, b)`.
    // Combined with status it gives us uniqueness guarantees without
    // canonicalizing in application code, and means a `pending` row and a
    // subsequent `accepted` row for the same pair can co-exist as a history
    // trail. The unique index is deferrable so multi-statement transactions
    // (e.g. accept = update old + insert new) don't have to fight each other.
    await client.query(`
        create table if not exists app_social_friendship (
            id uuid primary key default gen_random_uuid(),
            requester_user_id text not null,
            addressee_user_id text not null,
            status text not null check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'removed')),
            created_at timestamptz not null default now(),
            responded_at timestamptz null,
            note text null,
            pair_key text generated always as (
                least(requester_user_id, addressee_user_id) || '::' ||
                greatest(requester_user_id, addressee_user_id)
            ) stored
        );
    `);

    await client.query(`
        create index if not exists idx_social_friendship_requester
        on app_social_friendship(requester_user_id, status);
    `);

    await client.query(`
        create index if not exists idx_social_friendship_addressee
        on app_social_friendship(addressee_user_id, status);
    `);

    await client.query(`
        create index if not exists idx_social_friendship_pair
        on app_social_friendship(pair_key, status);
    `);

    // Uniqueness on (pair_key, status) prevents dual pending or dual accepted
    // rows for the same canonical pair. Deferrable so a transaction can
    // briefly violate it (e.g. UPDATE old row + INSERT new row in one tx).
    await client.query(`
        do $$
        begin
            if not exists (
                select 1 from pg_constraint
                where conname = 'uq_social_friendship_pair_status'
            ) then
                alter table app_social_friendship
                    add constraint uq_social_friendship_pair_status
                    unique (pair_key, status)
                    deferrable initially deferred;
            end if;
        end$$;
    `);

    // Back-link on the legacy app_friend_requests table — every legacy
    // friend-request row gets mirrored into app_social_friendship via
    // services/friends-shim.ts and the resulting uuid is stamped here.
    // Same pattern as social_entity_id on the other legacy tables.
    await client.query(`
        alter table app_friend_requests
            add column if not exists social_friendship_id uuid null;
    `);

    await client.query(`
        create index if not exists idx_app_friend_requests_social_friendship
        on app_friend_requests (social_friendship_id);
    `);

    // Deferred FK to keep deletes consistent. `on delete set null` so a
    // direct wipe of the universal row never cascades into legacy data
    // (defensive — we never delete in production today).
    await client.query(`
        do $$
        begin
            if not exists (
                select 1 from pg_constraint
                where conname = 'fk_app_friend_requests_social_friendship'
            ) then
                alter table app_friend_requests
                    add constraint fk_app_friend_requests_social_friendship
                    foreign key (social_friendship_id)
                    references app_social_friendship(id)
                    on delete set null;
            end if;
        end$$;
    `);

    await client.query(`
        create table if not exists app_chat_blocks (
            user_id text not null,
            target_user_id text not null,
            reason text null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            primary key (user_id, target_user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_app_chat_blocks_target
        on app_chat_blocks (target_user_id, created_at desc);
    `);

    await client.query(`
        create table if not exists app_chat_room_reads (
            room_id text not null,
            user_id text not null,
            last_read_at timestamptz not null,
            last_read_message_id text null,
            updated_at timestamptz not null,
            primary key (room_id, user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_app_chat_room_reads_user_updated
        on app_chat_room_reads (user_id, updated_at desc);
    `);

    await client.query(`
        create table if not exists app_chat_messages (
            id text primary key,
            room_id text not null,
            room_kind text not null,
            group_key text null,
            author_user_id text not null,
            body text not null,
            reply_to_message_id text null,
            created_at timestamptz not null,
            edited_at timestamptz null,
            deleted_at timestamptz null
        );
    `);

    await client.query(`
        create index if not exists idx_app_chat_messages_room_created
        on app_chat_messages (room_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_chat_messages_author_created
        on app_chat_messages (author_user_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_chat_messages_group_created
        on app_chat_messages (group_key, created_at desc);
    `);

    // Phase 1c — universal social store dual-write shim (chat_messages / DMs).
    // Nullable uuid link from a legacy direct-message row to its mirror entity
    // in app_social_entity (kind='dm_message'). Same shape as the other shim
    // links; the deferred FK is added later (after app_social_entity is
    // created). See docs/SOCIAL_STORE.md.
    await client.query(`
        alter table app_chat_messages
            add column if not exists social_entity_id uuid null;
    `);
    await client.query(`
        create index if not exists idx_app_chat_messages_social_entity
        on app_chat_messages (social_entity_id);
    `);

    await client.query(`
        create table if not exists app_group_content_revisions (
            id text primary key,
            group_key text not null,
            content_type text not null,
            entity_id text not null,
            edited_by text not null,
            edited_at timestamptz not null,
            snapshot_json jsonb not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_group_content_revisions_lookup
        on app_group_content_revisions (group_key, content_type, entity_id, edited_at desc);
    `);

    await client.query(`
        create table if not exists app_admin_user_snapshots (
            user_id text primary key,
            snapshot_json jsonb not null,
            updated_at timestamptz not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_admin_user_snapshots_updated_at
        on app_admin_user_snapshots (updated_at desc);
    `);

    await client.query(`
        create table if not exists app_admin_hydration_state (
            id text primary key,
            running boolean not null,
            lease_until timestamptz null,
            last_started_at timestamptz null,
            last_finished_at timestamptz null,
            last_scan_count integer not null,
            last_candidate_count integer not null,
            last_candidates_json jsonb not null,
            last_targets_json jsonb not null default '[]'::jsonb,
            last_hydrated_json jsonb not null,
            last_results_json jsonb not null default '[]'::jsonb,
            last_failed_json jsonb not null,
            trigger text null,
            updated_at timestamptz not null
        );
    `);

    await client.query(`
        alter table app_admin_hydration_state
        add column if not exists last_targets_json jsonb not null default '[]'::jsonb;
    `);

    await client.query(`
        alter table app_admin_hydration_state
        add column if not exists last_results_json jsonb not null default '[]'::jsonb;
    `);

    await client.query(`
        create index if not exists idx_app_admin_hydration_state_updated_at
        on app_admin_hydration_state (updated_at desc);
    `);

    await client.query(`
        create table if not exists app_umkd_files (
            file_id text primary key,
            filename text not null,
            length_bytes bigint null,
            chunk_size integer null,
            upload_date timestamptz not null,
            metadata_json jsonb not null
        );
    `);

    await client.query(`
        create index if not exists idx_app_umkd_files_course_id
        on app_umkd_files ((metadata_json->>'courseId'));
    `);

    await client.query(`
        create index if not exists idx_app_umkd_files_content_hash
        on app_umkd_files ((metadata_json->>'contentHash'));
    `);

    await client.query(`
        create index if not exists idx_app_umkd_files_uploaded_by
        on app_umkd_files ((metadata_json->>'uploadedBy'));
    `);

    await client.query(`
        create table if not exists app_user_sessions (
            session_id text primary key,
            user_id text not null,
            token_hash text not null unique,
            device_name text null,
            user_agent text null,
            ip text null,
            platform text null,
            browser text null,
            created_at timestamptz not null default now(),
            last_active_at timestamptz not null default now(),
            revoked_at timestamptz null
        );
    `);

    await client.query(`
        create index if not exists idx_app_user_sessions_user_id
        on app_user_sessions (user_id, last_active_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_user_sessions_token_hash
        on app_user_sessions (token_hash);
    `);

    await client.query(`
        create table if not exists app_support_requests (
            id text primary key,
            user_id text not null,
            code text not null unique,
            tier_id text not null,
            amount_kzt integer not null,
            status text not null,
            card_last4 text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            expires_at timestamptz null,
            submitted_at timestamptz null,
            transfer_at timestamptz null,
            sender_last4 text null,
            sender_bank text null,
            receipt_note text null,
            review_note text null,
            reviewed_at timestamptz null,
            reviewed_by text null,
            verified_at timestamptz null
        );
    `);

    await client.query(`
        create index if not exists idx_app_support_requests_user_created
        on app_support_requests (user_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_support_requests_status_created
        on app_support_requests (status, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_support_requests_code
        on app_support_requests (code);
    `);

    await client.query(`
        create table if not exists app_support_admin_overrides (
            user_id text primary key,
            mode text not null,
            tier_id text null,
            note text null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            updated_by text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_support_admin_overrides_mode_updated
        on app_support_admin_overrides (mode, updated_at desc);
    `);

    await client.query(`
        create table if not exists app_user_referrals (
            user_id text primary key,
            code text not null unique,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            referred_by_user_id text null,
            referred_by_code text null,
            referred_at timestamptz null,
            referred_source text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_user_referrals_code
        on app_user_referrals (code);
    `);

    await client.query(`
        create index if not exists idx_app_user_referrals_referrer
        on app_user_referrals (referred_by_user_id, referred_at desc);
    `);

    await client.query(`
        create table if not exists app_referral_reward_events (
            id text primary key,
            user_id text not null,
            reward_type text not null,
            referral_user_id text null,
            points integer not null,
            created_at timestamptz not null,
            metadata_json jsonb null,
            unique (user_id, reward_type, referral_user_id)
        );
    `);

    await client.query(`
        create index if not exists idx_app_referral_reward_events_user_created
        on app_referral_reward_events (user_id, created_at desc);
    `);

    await client.query(`
        create index if not exists idx_app_referral_reward_events_referral_user
        on app_referral_reward_events (referral_user_id, created_at desc);
    `);

    await client.query(`
        create table if not exists app_push_subscriptions (
            id            bigserial primary key,
            user_id       text not null,
            endpoint      text not null,
            p256dh        text not null,
            auth          text not null,
            user_agent    text,
            created_at    timestamptz not null default now(),
            last_seen_at  timestamptz not null default now(),
            unique (user_id, endpoint)
        );
    `);

    await client.query(`
        create index if not exists idx_app_push_subscriptions_user_id
        on app_push_subscriptions (user_id);
    `);

    await client.query(`
        create table if not exists app_push_sends (
            id          bigserial primary key,
            user_id     text not null,
            exam_id     text not null,
            kind        text not null check (kind in ('1day','1hour')),
            sent_at     timestamptz not null default now(),
            status      text not null,
            unique (user_id, exam_id, kind)
        );
    `);

    await client.query(`
        create index if not exists idx_app_push_sends_user
        on app_push_sends (user_id, sent_at desc);
    `);

    // Loosen the legacy kind CHECK so newer push fan-outs (social mention/dm/
    // comment/group-post/announcement) can be recorded for idempotency. The
    // constraint was authored when only exam reminders existed; the universal
    // social-events sink now writes additional rows with the same
    // (user_id, exam_id-as-fingerprint, kind) shape. Wrapped in a `do $$` so
    // it is idempotent across restarts.
    await client.query(`
        do $$
        begin
            if exists (
                select 1 from pg_constraint
                where conname = 'app_push_sends_kind_check'
            ) then
                alter table app_push_sends
                    drop constraint app_push_sends_kind_check;
            end if;
            if not exists (
                select 1 from pg_constraint
                where conname = 'app_push_sends_kind_check'
            ) then
                alter table app_push_sends
                    add constraint app_push_sends_kind_check
                    check (kind in (
                        '1day',
                        '1hour',
                        'social_mention',
                        'social_dm',
                        'social_comment',
                        'social_group_post',
                        'social_announcement',
                        'event_1day',
                        'event_1hour'
                    ));
            end if;
        end$$;
    `);

    await client.query(`
        create table if not exists app_umkd_parsed_content (
            file_id        text primary key references app_umkd_files (file_id) on delete cascade,
            content_hash   text not null,
            parsed_at      timestamptz not null default now(),
            parser_version int not null default 1,
            extractor      text not null,
            extract_ok     boolean not null,
            raw_text       text null,
            questions_json jsonb not null,
            error_reason   text null
        );
    `);

    await client.query(`
        create index if not exists idx_app_umkd_parsed_content_hash
        on app_umkd_parsed_content (content_hash);
    `);

    // Per-user, per-kind push notification preferences.
    //
    // The map is intentionally sparse: a missing key means "default-on", so we
    // can introduce new `PushKind` values without backfilling every existing
    // row. UI only writes a key when the user explicitly toggles it. The
    // primary-keyed (user_id) row is created lazily on the first PUT.
    await client.query(`
        create table if not exists app_notification_prefs (
            user_id        text primary key,
            enabled_kinds  jsonb not null default '{}'::jsonb,
            updated_at     timestamptz not null default now(),
            created_at     timestamptz not null default now()
        );
    `);

    // Private per-user notes attached to a normalized teacher key. Each row is
    // visible only to the owning user — there is no shared/aggregate read path.
    await client.query(`
        create table if not exists user_teacher_notes (
            user_id text not null,
            teacher_key text not null,
            note text not null default '',
            updated_at timestamptz not null default now(),
            primary key (user_id, teacher_key)
        );
    `);

    await client.query(`
        create index if not exists idx_user_teacher_notes_user
        on user_teacher_notes (user_id);
    `);

    await securePublicAppTables(client);
}

export async function withSupabasePostgres<T>(
    handler: (client: PoolClient) => Promise<T>
): Promise<T | null> {
    const localPool = getPool();
    if (!localPool) return null;

    try {
        if (!initPromise) {
            initPromise = (async () => {
                const client = await localPool.connect();
                try {
                    await createSchema(client);
                } finally {
                    client.release();
                }
            })();
            // If schema init rejects (transient connection blip, a concurrent
            // DDL race with a maintenance script, etc.) clear the cached promise
            // so the NEXT request retries instead of permanently rejecting.
            // Without this, a single init failure made every DB request 500 for
            // the lifetime of the process — the pool's 15s cooldown never helped
            // because `await initPromise` kept re-throwing the same rejection.
            void initPromise.catch(() => { initPromise = null; });
        }

        await initPromise;
    } catch (error) {
        await disablePoolTemporarily(summarizePgError(error));
        return null;
    }

    let client: PoolClient | null = null;
    try {
        client = await localPool.connect();
        return await handler(client);
    } catch (error) {
        if (isConnectionLevelPostgresError(error)) {
            await disablePoolTemporarily(summarizePgError(error));
        } else {
            console.warn(`[Supabase Postgres] Query failed, falling back for current operation: ${summarizePgError(error)}`);
        }
        return null;
    } finally {
        client?.release();
    }
}
