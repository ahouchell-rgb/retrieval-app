-- STATUS: NOT YET APPLIED. Apply to project uvzukwoxqhcxaxtzrziy BEFORE deploying
-- the mark-preview edge function.
--
-- Cost guard for the anonymous retrieval-practice embed (mark-preview edge fn).
-- mark-preview marks answers for anonymous visitors on the interactive-science.com
-- revision booklets. It resolves the model answer server-side (shared questions
-- only) and runs the same paid AI marker as mark-answer, so we cap how many
-- anonymous marks one source (IP) can trigger per day.
--
-- This is a COST/ABUSE guard, NOT a security control:
--   * it fails OPEN in the function (a broken limiter must never block a genuine
--     learner — same philosophy as the school cost backstop in mark-answer);
--   * the data exposed to anon is already public (shared questions only; the
--     model answer never leaves the server, the grade is never recorded).

create table if not exists public.anon_mark_usage (
  bucket text not null,                       -- the rate-limit key (caller IP, hashed upstream if desired)
  day    date not null default current_date,  -- counts reset per UTC day
  count  int  not null default 0,
  primary key (bucket, day)
);

-- Atomically record one anonymous mark for a bucket and report whether it is still
-- within the daily limit. Returns true = allowed (proceed), false = over the cap.
-- SECURITY DEFINER so the service-role edge function can call it; intentionally NOT
-- granted to anon/authenticated — only mark-preview (service role) calls it.
create or replace function public.anon_mark_bump(p_bucket text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare cur int;
begin
  insert into public.anon_mark_usage (bucket, day, count)
  values (coalesce(nullif(p_bucket, ''), 'unknown'), current_date, 1)
  on conflict (bucket, day)
  do update set count = public.anon_mark_usage.count + 1
  returning count into cur;
  return cur <= greatest(p_limit, 1);
end;
$$;

revoke all on function public.anon_mark_bump(text, int) from public, anon, authenticated;

comment on table public.anon_mark_usage is
  'Per-bucket/day counter for anonymous mark-preview calls (cost guard for the public booklet embed). See 20260621_05.';
comment on function public.anon_mark_bump is
  'Atomically increment + check the daily anonymous-mark allowance for a bucket. Service-role only. See 20260621_05.';
