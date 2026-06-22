-- STATUS: NOT YET APPLIED. Apply to project uvzukwoxqhcxaxtzrziy.
--
-- Anonymous funnel analytics for the public booklet embed (interactive-science).
-- Events: booklet_viewed -> widget_opened -> question_answered -> signup_clicked,
-- keyed by a client session_id + ref (booklet slug) / from_source. Lets us see
-- which booklets actually convert readers into practisers and sign-ups, so we know
-- where to invest (move #5). Writes come ONLY from the emit-funnel-event edge
-- function (service role); reads are moderator-gated via get_funnel_summary.

create table if not exists public.anon_funnel_events (
  id            bigint generated always as identity primary key,
  session_id    text,
  event         text not null,
  ref           text,
  from_source   text,
  topic_id      uuid,
  topic_name    text,
  correct       boolean,
  marks_awarded int,
  created_at    timestamptz not null default now()
);
create index if not exists anon_funnel_events_created_idx on public.anon_funnel_events (created_at desc);
create index if not exists anon_funnel_events_ref_idx on public.anon_funnel_events (ref, created_at desc);

-- No RLS policies + revoke API roles: the table is not reachable through PostgREST
-- by anon/authenticated. The edge function uses the service role (bypasses this),
-- and the dashboard reads through the SECURITY DEFINER RPC below.
alter table public.anon_funnel_events enable row level security;
revoke all on public.anon_funnel_events from anon, authenticated;

create or replace function public.get_funnel_summary(p_days int default 14)
returns table (
  ref text,
  sessions bigint,
  viewed bigint,
  opened bigint,
  answered bigint,
  answered_correct bigint,
  signup_clicked bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorised';
  end if;
  return query
    select
      e.ref,
      count(distinct e.session_id),
      count(distinct e.session_id) filter (where e.event = 'booklet_viewed'),
      count(distinct e.session_id) filter (where e.event = 'widget_opened'),
      count(distinct e.session_id) filter (where e.event = 'question_answered'),
      count(distinct e.session_id) filter (where e.event = 'question_answered' and e.correct),
      count(distinct e.session_id) filter (where e.event = 'signup_clicked')
    from public.anon_funnel_events e
    where e.created_at >= now() - (greatest(p_days, 1) || ' days')::interval
    group by e.ref
    order by count(distinct e.session_id) desc;
end;
$$;

revoke all on function public.get_funnel_summary(int) from public, anon;
grant execute on function public.get_funnel_summary(int) to authenticated;

comment on table public.anon_funnel_events is
  'Anonymous public-booklet-embed funnel events (service-role write via emit-funnel-event; moderator-gated read via get_funnel_summary). See 20260621_07.';