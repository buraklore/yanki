-- =====================================================================
-- YANKI — schema
-- psql "$DATABASE_URL" -f db/schema.sql   (or: npm run db:push)
-- Idempotent: safe to run repeatedly.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- enums (guarded so re-running is safe) --------------------
do $$ begin create type org_kind    as enum ('brand','agency');                                      exception when duplicate_object then null; end $$;
do $$ begin create type plan_key    as enum ('trial','starter','growth','business','agency');        exception when duplicate_object then null; end $$;
do $$ begin create type member_role as enum ('owner','analyst','client');                            exception when duplicate_object then null; end $$;
do $$ begin create type scan_status as enum ('queued','running','done','failed','partial');          exception when duplicate_object then null; end $$;
do $$ begin create type prompt_intent as enum
      ('transactional','brand_defence','comparison','evaluation','informational');                   exception when duplicate_object then null; end $$;

-- ---------- identity --------------------------------------------------

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  password_hash text not null,          -- scrypt: salt:hash, see lib/password.ts
  full_name     text,
  -- Interface language. Stored on the user, not the browser, so it follows
  -- them across devices and does not reset when cookies are cleared.
  locale        text not null default 'tr',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

alter table users add column if not exists locale text not null default 'tr';

create table if not exists organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             org_kind not null default 'brand',
  plan             plan_key not null default 'trial',
  trial_ends_at    timestamptz not null default now() + interval '7 days',
  white_label_host text unique,
  created_at       timestamptz not null default now()
);

create table if not exists memberships (
  org_id  uuid references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role    member_role not null default 'owner',
  primary key (org_id, user_id)
);

-- Sessions live in the database, not in a signed cookie, so revoking one is
-- a DELETE rather than a key rotation. The cookie carries a random token;
-- only its SHA-256 is stored, so a database leak cannot be replayed.
create table if not exists sessions (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip         text
);
create index if not exists sessions_user_idx on sessions (user_id);

-- ---------- workspaces -------------------------------------------------

create table if not exists workspaces (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  brand_name    text not null,
  domain        text not null,
  sector        text not null,
  sector_term   text not null,
  country       text not null default 'Turkey',
  country_code  char(2) not null default 'TR',
  language      char(2) not null default 'tr',
  city          text,
  description   text,
  aliases       text[] not null default '{}',
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists workspaces_org_idx on workspaces (org_id);

create table if not exists competitors (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  domain       text,
  aliases      text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists prompts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  text         text not null,
  intent       prompt_intent not null default 'evaluation',
  volume       integer not null default 100,
  source       text not null default 'ai',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (workspace_id, text)
);
create index if not exists prompts_ws_idx on prompts (workspace_id) where active;

-- ---------- engines ----------------------------------------------------
-- Weights approximate usage share and must sum to 1. Only surfaces we can
-- actually query are listed: an engine with no adapter would show up as a
-- permanent zero and look like bad visibility rather than a missing feature.

create table if not exists engines (
  key            text primary key,
  label          text not null,
  default_weight numeric(4,3) not null,
  method         text not null,
  min_plan       plan_key not null default 'trial',
  sort_order     smallint not null default 0
);

insert into engines (key,label,default_weight,method,min_plan,sort_order) values
  ('chatgpt',     'ChatGPT',             0.330,'official_api','trial',   1),
  ('gemini',      'Google Gemini',       0.150,'official_api','trial',   2),
  ('perplexity',  'Perplexity',          0.110,'official_api','trial',   3),
  ('ai_overviews','Google AI Overviews', 0.210,'serp_provider','starter',4),
  ('claude',      'Claude',              0.100,'official_api','starter', 5),
  ('grok',        'Grok',                0.040,'official_api','growth',  6),
  ('deepseek',    'DeepSeek',            0.040,'official_api','growth',  7),
  ('groq',        'Groq',                0.020,'official_api','growth',  8)
on conflict (key) do update
  set label = excluded.label, default_weight = excluded.default_weight,
      method = excluded.method, min_plan = excluded.min_plan, sort_order = excluded.sort_order;

create table if not exists engine_weights (
  workspace_id uuid references workspaces(id) on delete cascade,
  engine_key   text references engines(key),
  weight       numeric(4,3) not null,
  primary key (workspace_id, engine_key)
);

-- ---------- scans ------------------------------------------------------

create table if not exists scans (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scan_date    date not null default current_date,
  status       scan_status not null default 'queued',
  runs_target  smallint not null default 5,
  queued_jobs  integer not null default 0,
  started_at   timestamptz default now(),
  finished_at  timestamptz,
  error        text,
  unique (workspace_id, scan_date)
);

create table if not exists answer_runs (
  id             bigserial primary key,
  scan_id        uuid not null references scans(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  prompt_id      uuid not null references prompts(id) on delete cascade,
  engine_key     text not null references engines(key),
  run_index      smallint not null,
  asked_at       timestamptz not null default now(),
  model_version  text,
  method         text,
  latency_ms     integer,
  answer_text    text,
  mentioned      boolean,
  rank           smallint,
  cited          boolean,
  recommendation text,
  sentiment      numeric(3,2),
  degraded       text,
  unique (scan_id, prompt_id, engine_key, run_index)
);
create index if not exists runs_ws_idx  on answer_runs (workspace_id, asked_at desc);
create index if not exists runs_scan_idx on answer_runs (scan_id);

create table if not exists run_brands (
  run_id        bigint not null references answer_runs(id) on delete cascade,
  competitor_id uuid references competitors(id) on delete cascade,
  is_self       boolean not null default false,
  rank          smallint,
  unique (run_id, competitor_id, is_self)
);
create index if not exists run_brands_run_idx on run_brands (run_id);

create table if not exists run_citations (
  run_id bigint not null references answer_runs(id) on delete cascade,
  domain text not null,
  unique (run_id, domain)
);
create index if not exists citations_domain_idx on run_citations (domain);

-- ---------- rollups ----------------------------------------------------

create table if not exists cell_scores (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scan_date    date not null,
  prompt_id    uuid not null references prompts(id) on delete cascade,
  engine_key   text not null references engines(key),
  score        numeric(5,2) not null,
  ci           numeric(5,2) not null,
  m            numeric(4,3) not null,
  pi           numeric(4,3) not null,
  c            numeric(4,3) not null,
  rho          numeric(4,3) not null,
  sigma        numeric(4,3) not null,
  mean_rank    numeric(4,2),
  primary key (workspace_id, scan_date, prompt_id, engine_key)
);

create table if not exists daily_scores (
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  scan_date      date not null,
  score          numeric(5,2) not null,
  ci             numeric(5,2) not null,
  low_confidence boolean not null default false,
  mention_rate   numeric(5,2) not null,
  citation_rate  numeric(5,2) not null,
  share_of_voice numeric(5,2) not null,
  by_engine      jsonb not null default '{}',
  primary key (workspace_id, scan_date)
);

-- ---------- audit ------------------------------------------------------

create table if not exists audits (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url          text not null,
  ran_at       timestamptz not null default now(),
  total_score  numeric(5,2) not null,
  meta         jsonb not null default '{}'
);
create index if not exists audits_ws_idx on audits (workspace_id, ran_at desc);

create table if not exists audit_factors (
  audit_id   uuid not null references audits(id) on delete cascade,
  factor_key text not null,
  category   text not null,
  label      text not null,
  status     text not null,
  detail     text,
  fix        text,
  primary key (audit_id, factor_key)
);

-- ---------- job queue --------------------------------------------------

create table if not exists scan_jobs (
  id           bigserial primary key,
  scan_id      uuid not null references scans(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prompt_id    uuid not null references prompts(id) on delete cascade,
  engine_key   text not null references engines(key),
  run_index    smallint not null,
  attempts     smallint not null default 0,
  locked_until timestamptz,
  done_at      timestamptz,
  error        text,
  unique (scan_id, prompt_id, engine_key, run_index)
);
create index if not exists jobs_pending_idx on scan_jobs (done_at, locked_until) where done_at is null;

-- Claim a batch for this worker.
--
-- SKIP LOCKED lets several cron invocations run concurrently without ever
-- handing the same job to two workers.
--
-- The ordering is deliberately NOT first-in-first-out. With strict FIFO a
-- single 6,000-job workspace starves every other tenant for hours: the new
-- customer who just signed up sees an empty dashboard while someone else's
-- backlog drains. Instead we interleave — take the oldest job from each scan,
-- then the second oldest from each, and so on — so every workspace makes
-- progress on every pass and a large scan costs its owner latency, not
-- everyone else's.
create or replace function claim_jobs(batch integer, lease_seconds integer default 180)
returns setof scan_jobs language plpgsql as $$
declare
  ids bigint[];
begin
  -- Window functions cannot be combined with FOR UPDATE, so pick the ids in
  -- one statement and lock them in the next. The gap is harmless: the UPDATE
  -- re-checks locked_until, and SKIP LOCKED in a concurrent call would simply
  -- select different rows.
  select array_agg(id) into ids
    from (
      select id
        from (
          select id, row_number() over (partition by scan_id order by id) as slot
            from scan_jobs
           where done_at is null
             and (locked_until is null or locked_until < now())
             and attempts < 4
        ) ranked
       order by slot, id
       limit batch
    ) picked;

  if ids is null then
    return;
  end if;

  return query
    update scan_jobs j
       set locked_until = now() + make_interval(secs => lease_seconds),
           attempts     = j.attempts + 1
     where j.id = any(ids)
       and j.done_at is null
       and (j.locked_until is null or j.locked_until < now())
    returning j.*;
end;
$$;


-- ---------- attributes -------------------------------------------------
-- Which qualities a model attaches to which brand. This is the difference
-- between "you scored 42" and "the model calls your rival trustworthy and
-- calls you cheap" — the second is actionable, the first is not.
--
-- Extraction is a separate pass over answers we already stored, so it costs
-- one cheap model call per batch and never re-queries a provider.

create table if not exists run_attributes (
  id             bigserial primary key,
  run_id         bigint not null references answer_runs(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  -- null competitor_id means the workspace's own brand.
  competitor_id  uuid references competitors(id) on delete cascade,
  is_self        boolean not null default false,
  attribute      text not null,          -- normalised, lower case
  attribute_raw  text not null,          -- as the model wrote it
  polarity       smallint not null,      -- -1 negative, 0 neutral, 1 positive
  evidence       text,                   -- the clause it came from
  created_at     timestamptz not null default now()
);
create index if not exists run_attributes_ws_idx on run_attributes (workspace_id, attribute);
create index if not exists run_attributes_run_idx on run_attributes (run_id);
create unique index if not exists run_attributes_uniq
  on run_attributes (run_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute);

-- Marks answers that have been through the attribute pass, so a re-run only
-- looks at what is new.
alter table answer_runs add column if not exists attributes_at timestamptz;

-- ---------- change tracking and alerts ---------------------------------
-- Turning a checklist into a monitoring system: the product has to notice a
-- loss and say so, otherwise a customer fixes everything once and leaves.

create table if not exists change_events (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scan_date    date not null,
  kind         text not null,      -- score_drop | score_rise | rank_loss | rank_gain
                                   -- | lost_mention | new_mention | rival_overtake
                                   -- | rival_surge | citation_lost | citation_gained
  severity     smallint not null default 1,   -- 1 info, 2 notable, 3 urgent
  prompt_id    uuid references prompts(id) on delete cascade,
  engine_key   text references engines(key),
  competitor_id uuid references competitors(id) on delete cascade,
  before_val   numeric,
  after_val    numeric,
  detail       text,
  created_at   timestamptz not null default now()
);
create index if not exists change_events_ws_idx on change_events (workspace_id, scan_date desc);
create unique index if not exists change_events_uniq
  on change_events (workspace_id, scan_date, kind,
                    coalesce(prompt_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(engine_key, ''),
                    coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Digest delivery log. Keeps us from sending the same week twice when a cron
-- retries, and gives the customer a history they can open in the panel.
create table if not exists digests (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  period       text not null,          -- weekly | monthly
  period_start date not null,
  period_end   date not null,
  summary      jsonb not null,
  sent_at      timestamptz,
  send_error   text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, period, period_start)
);

-- Per-user notification preferences. Defaults are deliberately on: a customer
-- who never hears about a loss has no reason to keep paying.
alter table users add column if not exists notify_weekly boolean not null default true;
alter table users add column if not exists notify_alerts boolean not null default true;

-- ---------- agency / white label ---------------------------------------
alter table organizations add column if not exists brand_logo_url text;
alter table organizations add column if not exists brand_colour text;
alter table organizations add column if not exists brand_name_override text;

-- ---------- rate limiting ---------------------------------------------
-- Fixed windows in Postgres rather than memory: on serverless every request
-- may hit a different instance, so an in-memory counter limits nothing.

create table if not exists rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, key, window_start)
);
create index if not exists rate_limits_prune_idx on rate_limits (window_start);

-- ---------- password reset --------------------------------------------
-- Only the hash of the token is stored, same reasoning as sessions: a database
-- dump must not be replayable as an account takeover.

create table if not exists password_resets (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists password_resets_user_idx on password_resets (user_id);

-- ---------- usage counters (plan limits) --------------------------------

create table if not exists usage_counters (
  org_id    uuid not null references organizations(id) on delete cascade,
  period    date not null,              -- first day of the month
  metric    text not null,              -- audits | content | scans
  used      integer not null default 0,
  primary key (org_id, period, metric)
);
