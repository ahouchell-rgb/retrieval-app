-- STATUS: APPLIED (verified 2026-08-26; Supabase migration 20260826114635).
-- Cross-device continuity for unfinished pupil answers and notification read state.

create table if not exists public.student_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_key text not null check (length(draft_key) between 1 and 300),
  answer_text text not null check (length(answer_text) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, draft_key)
);

create index if not exists student_drafts_recent_idx
  on public.student_drafts(user_id, updated_at desc);

create table if not exists public.user_notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null check (length(notification_key) between 1 and 300),
  read_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);

create index if not exists user_notification_reads_recent_idx
  on public.user_notification_reads(user_id, read_at desc);

alter table public.student_drafts enable row level security;
alter table public.user_notification_reads enable row level security;

drop policy if exists student_drafts_select_own on public.student_drafts;
create policy student_drafts_select_own on public.student_drafts
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists student_drafts_insert_own on public.student_drafts;
create policy student_drafts_insert_own on public.student_drafts
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists student_drafts_update_own on public.student_drafts;
create policy student_drafts_update_own on public.student_drafts
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists student_drafts_delete_own on public.student_drafts;
create policy student_drafts_delete_own on public.student_drafts
for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists notification_reads_select_own on public.user_notification_reads;
create policy notification_reads_select_own on public.user_notification_reads
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists notification_reads_insert_own on public.user_notification_reads;
create policy notification_reads_insert_own on public.user_notification_reads
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists notification_reads_update_own on public.user_notification_reads;
create policy notification_reads_update_own on public.user_notification_reads
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists notification_reads_delete_own on public.user_notification_reads;
create policy notification_reads_delete_own on public.user_notification_reads
for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.student_drafts from anon;
revoke all on table public.user_notification_reads from anon;
grant select, insert, update, delete on table public.student_drafts to authenticated;
grant select, insert, update, delete on table public.user_notification_reads to authenticated;
grant all on table public.student_drafts to service_role;
grant all on table public.user_notification_reads to service_role;
