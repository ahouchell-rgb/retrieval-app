-- STATUS: APPLIED (2026-08-21) to project uvzukwoxqhcxaxtzrziy.
--
-- Cost-control foundations:
--   * trace every paid/free marking operation end-to-end;
--   * make pupil submissions idempotent before an AI call is made;
--   * cache identical staff AI operations without exposing their contents.

-- ── 1. End-to-end AI usage metadata ─────────────────────────────────────────
alter table public.ai_usage
  add column if not exists provider   text,
  add column if not exists model      text,
  add column if not exists request_id uuid,
  add column if not exists response_id uuid,
  add column if not exists operation  text,
  add column if not exists latency_ms integer,
  add column if not exists success    boolean;

update public.ai_usage
set provider = coalesce(provider,
      case when coalesce(input_tokens, 0) + coalesce(output_tokens, 0) > 0
           then 'anthropic' else 'local' end),
    operation = coalesce(operation, call_label),
    success = coalesce(success, true)
where provider is null or operation is null or success is null;

alter table public.ai_usage
  alter column success set default true;

alter table public.ai_usage
  drop constraint if exists ai_usage_latency_nonnegative,
  add constraint ai_usage_latency_nonnegative
    check (latency_ms is null or latency_ms >= 0) not valid;
alter table public.ai_usage validate constraint ai_usage_latency_nonnegative;

create index if not exists ai_usage_request_idx
  on public.ai_usage (request_id) where request_id is not null;
create index if not exists ai_usage_response_idx
  on public.ai_usage (response_id) where response_id is not null;
create index if not exists ai_usage_operation_idx
  on public.ai_usage (operation, ts desc);
create index if not exists ai_usage_model_idx
  on public.ai_usage (provider, model, ts desc);

-- ── 2. Persist request identity with authoritative grades ────────────────────
alter table public.responses
  add column if not exists request_id uuid,
  add column if not exists marking_source text;

create unique index if not exists responses_request_id_uidx
  on public.responses (request_id) where request_id is not null;

alter table public.paper_responses
  add column if not exists request_id uuid,
  add column if not exists marking_source text;

create unique index if not exists paper_responses_request_id_uidx
  on public.paper_responses (request_id) where request_id is not null;

-- A request is claimed before a provider call. A concurrent/replayed request
-- therefore cannot reach the paid path while the first request is processing.
create table if not exists public.marking_requests (
  request_id  uuid primary key,
  actor_id    uuid not null references auth.users(id) on delete cascade,
  operation   text not null,
  status      text not null default 'processing'
              check (status in ('processing', 'completed', 'failed')),
  response_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.marking_requests enable row level security;
revoke all on public.marking_requests from anon, authenticated;
grant select, insert, update, delete on public.marking_requests to service_role;

create index if not exists marking_requests_actor_idx
  on public.marking_requests (actor_id, created_at desc);

create or replace function public.claim_marking_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation text
)
returns table (claimed boolean, request_status text, existing_response_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.marking_requests%rowtype;
begin
  insert into public.marking_requests(request_id, actor_id, operation)
  values (p_request_id, p_actor_id, p_operation)
  on conflict (request_id) do nothing;

  if found then
    return query select true, 'processing'::text, null::uuid;
    return;
  end if;

  select * into existing
  from public.marking_requests mr
  where mr.request_id = p_request_id;

  if existing.actor_id <> p_actor_id or existing.operation <> p_operation then
    return query select false, 'conflict'::text, null::uuid;
    return;
  end if;

  if existing.status = 'failed'
     or (existing.status = 'processing' and existing.updated_at < now() - interval '5 minutes') then
    update public.marking_requests mr
    set status = 'processing', response_id = null, updated_at = now()
    where mr.request_id = p_request_id
      and (mr.status = 'failed'
           or (mr.status = 'processing' and mr.updated_at < now() - interval '5 minutes'));
    if found then
      return query select true, 'processing'::text, null::uuid;
      return;
    end if;
  end if;

  return query select false, existing.status, existing.response_id;
end;
$$;

revoke all on function public.claim_marking_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_marking_request(uuid, uuid, text) to service_role;

-- ── 3. Hash-based deduplication for expensive staff operations ───────────────
alter table public.paper_feedforward_sheets
  add column if not exists request_hash text;
create unique index if not exists paper_feedforward_sheets_request_hash_uidx
  on public.paper_feedforward_sheets (request_hash) where request_hash is not null;

alter table public.class_misconception_runs
  add column if not exists request_hash text;
create unique index if not exists class_misconception_runs_request_hash_uidx
  on public.class_misconception_runs (request_hash) where request_hash is not null;

create table if not exists public.ai_operation_cache (
  operation    text not null,
  request_hash text not null,
  actor_id     uuid references auth.users(id) on delete cascade,
  school_id    uuid references public.schools(id) on delete set null,
  provider     text not null,
  model        text not null,
  result       jsonb not null,
  hit_count    integer not null default 0 check (hit_count >= 0),
  created_at   timestamptz not null default now(),
  last_hit_at  timestamptz,
  primary key (operation, request_hash)
);

alter table public.ai_operation_cache enable row level security;
revoke all on public.ai_operation_cache from anon, authenticated;
grant select, insert, update, delete on public.ai_operation_cache to service_role;

create index if not exists ai_operation_cache_actor_idx
  on public.ai_operation_cache (actor_id, operation, created_at desc);

comment on table public.marking_requests is
  'Service-only idempotency claims acquired before paid marking calls.';
comment on table public.ai_operation_cache is
  'Service-only hash cache for retry-safe staff AI operations; never exposed to browser roles.';

-- Preserve the existing dashboard contract and add provider/model, reliability
-- and latency breakdowns now that each row carries them.
create or replace function public.get_ai_cost_summary(p_days integer default 30)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare result json;
begin
  if not is_moderator() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with w as (
    select * from public.ai_usage
    where ts >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  )
  select json_build_object(
    'days', p_days,
    'min_ts', (select min(ts) from w),
    'max_ts', (select max(ts) from w),
    'rows', (select count(*) from w),
    'markings', (select count(*) from w where call_label in ('first','shortcut')),
    'ai_markings', (select count(*) from w where call_label = 'first'),
    'shortcut_markings', (select count(*) from w where call_label = 'shortcut'),
    'second_calls', (select count(*) from w where call_label = 'second'),
    'failed_calls', (select count(*) from w where success is false),
    'avg_latency_ms', (select round(avg(latency_ms)) from w where latency_ms is not null),
    'input_tokens', (select coalesce(sum(input_tokens),0) from w),
    'output_tokens', (select coalesce(sum(output_tokens),0) from w),
    'cache_read_tokens', (select coalesce(sum(cache_read_tokens),0) from w),
    'cache_write_tokens', (select coalesce(sum(cache_creation_tokens),0) from w),
    'by_source', (
      select coalesce(json_object_agg(src, c), '{}'::json) from (
        select case when call_label = 'shortcut' then coalesce(source, 'shortcut') else 'ai' end as src,
               count(*) c
        from w where call_label in ('first','shortcut') group by 1
      ) s
    ),
    'by_model', (
      select coalesce(json_agg(json_build_object(
        'provider', provider, 'model', model, 'calls', calls,
        'input_tokens', input_tokens, 'output_tokens', output_tokens,
        'cache_read_tokens', cache_read_tokens, 'cache_write_tokens', cache_write_tokens
      )), '[]'::json)
      from (
        select coalesce(provider, 'unknown') provider, coalesce(model, 'unknown') model,
               count(*) calls, coalesce(sum(input_tokens),0) input_tokens,
               coalesce(sum(output_tokens),0) output_tokens,
               coalesce(sum(cache_read_tokens),0) cache_read_tokens,
               coalesce(sum(cache_creation_tokens),0) cache_write_tokens
        from w where coalesce(provider, 'local') <> 'local'
        group by 1,2 order by count(*) desc
      ) models
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_ai_cost_summary(integer) from public, anon;
grant execute on function public.get_ai_cost_summary(integer) to authenticated, service_role;
