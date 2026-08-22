-- STATUS: PENDING — deploy with the matching web + mark-answer changes.
-- Teacher action loop: targeted retrieval assignments, measurable intervention
-- outcomes, paper scheduling, and marking-quality provenance.

create table if not exists public.retrieval_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null check (length(btrim(title)) between 3 and 160),
  instructions text not null default '' check (length(instructions) <= 2000),
  question_count integer not null default 5 check (question_count between 1 and 30),
  available_from timestamptz,
  due_at timestamptz,
  status text not null default 'published'
    check (status in ('draft', 'published', 'closed', 'archived')),
  source text not null default 'manual'
    check (source in ('manual', 'class_gap', 'attention_queue', 'misconception', 'paper_followup')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at is null or available_from is null or due_at >= available_from)
);

create table if not exists public.retrieval_assignment_questions (
  assignment_id uuid not null references public.retrieval_assignments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (assignment_id, question_id)
);

create table if not exists public.retrieval_assignment_students (
  assignment_id uuid not null references public.retrieval_assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  baseline_pct numeric(5,2) check (baseline_pct is null or baseline_pct between 0 and 100),
  baseline_marked integer not null default 0 check (baseline_marked >= 0),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (assignment_id, student_id)
);

create index if not exists retrieval_assignments_class_status_idx
  on public.retrieval_assignments(class_id, status, due_at);
create index if not exists retrieval_assignments_teacher_idx
  on public.retrieval_assignments(teacher_id, created_at desc);
create index if not exists retrieval_assignment_questions_question_idx
  on public.retrieval_assignment_questions(question_id);
create index if not exists retrieval_assignment_students_student_idx
  on public.retrieval_assignment_students(student_id, completed_at);

alter table public.retrieval_assignments enable row level security;
alter table public.retrieval_assignment_questions enable row level security;
alter table public.retrieval_assignment_students enable row level security;

create schema if not exists private;

create or replace function private.can_manage_retrieval_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.retrieval_assignments assignment
    join public.classes class on class.id = assignment.class_id
    where assignment.id = p_assignment_id
      and (class.teacher_id = (select auth.uid()) or public.is_moderator())
  );
$$;

create or replace function private.can_view_retrieval_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_retrieval_assignment(p_assignment_id)
    or exists (
      select 1
      from public.retrieval_assignments assignment
      join public.retrieval_assignment_students pupil
        on pupil.assignment_id = assignment.id
      where assignment.id = p_assignment_id
        and pupil.student_id = (select auth.uid())
        and assignment.status = 'published'
        and (assignment.available_from is null or assignment.available_from <= now())
    );
$$;

revoke all on function private.can_manage_retrieval_assignment(uuid) from public, anon;
revoke all on function private.can_view_retrieval_assignment(uuid) from public, anon;
grant execute on function private.can_manage_retrieval_assignment(uuid) to authenticated, service_role;
grant execute on function private.can_view_retrieval_assignment(uuid) to authenticated, service_role;

drop policy if exists retrieval_assignments_teacher_all on public.retrieval_assignments;
create policy retrieval_assignments_teacher_all
on public.retrieval_assignments for all to authenticated
using (public.user_teaches_class(class_id) or public.is_moderator())
with check (
  (teacher_id = (select auth.uid()) and public.user_teaches_class(class_id))
  or public.is_moderator()
);

drop policy if exists retrieval_assignments_student_select on public.retrieval_assignments;
create policy retrieval_assignments_student_select
on public.retrieval_assignments for select to authenticated
using (private.can_view_retrieval_assignment(id));

drop policy if exists retrieval_assignment_questions_staff_all on public.retrieval_assignment_questions;
create policy retrieval_assignment_questions_staff_all
on public.retrieval_assignment_questions for all to authenticated
using (private.can_manage_retrieval_assignment(assignment_id))
with check (private.can_manage_retrieval_assignment(assignment_id));

drop policy if exists retrieval_assignment_questions_pupil_select on public.retrieval_assignment_questions;
create policy retrieval_assignment_questions_pupil_select
on public.retrieval_assignment_questions for select to authenticated
using (private.can_view_retrieval_assignment(assignment_id));

drop policy if exists retrieval_assignment_students_staff_all on public.retrieval_assignment_students;
create policy retrieval_assignment_students_staff_all
on public.retrieval_assignment_students for all to authenticated
using (private.can_manage_retrieval_assignment(assignment_id))
with check (private.can_manage_retrieval_assignment(assignment_id));

drop policy if exists retrieval_assignment_students_pupil_select on public.retrieval_assignment_students;
create policy retrieval_assignment_students_pupil_select
on public.retrieval_assignment_students for select to authenticated
using (student_id = (select auth.uid()));

grant select, insert, update, delete on public.retrieval_assignments to authenticated;
grant select, insert, update, delete on public.retrieval_assignment_questions to authenticated;
grant select, insert, update, delete on public.retrieval_assignment_students to authenticated;
grant all on public.retrieval_assignments to service_role;
grant all on public.retrieval_assignment_questions to service_role;
grant all on public.retrieval_assignment_students to service_role;

-- Keep the existing intervention RPC available to the class teacher. Some
-- older live environments had a narrower PII gate than the function comment,
-- which left the targeted-assignment pupil suggestions empty for teachers.
create or replace function public.class_intervention_list(
  p_class_id uuid,
  p_threshold int default 50,
  p_subject text default null
)
returns table(
  student_id uuid,
  student_name text,
  topic_id uuid,
  topic_name text,
  subject_id uuid,
  pct_correct numeric,
  marked int
)
language sql
stable
security definer
set search_path = ''
as $$
  select response.student_id,
         coalesce(profile.display_name, profile.full_name, 'Pupil') as student_name,
         topic.id,
         topic.name,
         topic.subject_id,
         round(
           100.0 * count(*) filter (where response.is_correct)
           / nullif(count(*) filter (where response.is_correct is not null), 0),
           0
         ) as pct_correct,
         count(*) filter (where response.is_correct is not null)::int as marked
  from public.responses response
  join public.questions question on question.id = response.question_id
  join public.topics topic on topic.id = question.topic_id
  join public.profiles profile on profile.id = response.student_id
  left join public.subjects subject on subject.id = topic.subject_id
  where response.class_id = p_class_id
    and (p_subject is null or subject.name = p_subject)
    and (
      nullif(current_setting('request.headers', true)::json ->> 'x-sciencekit-key', '')
        = (select value from private.app_config where key = 'sciencekit_key')
      or public.is_moderator()
      or public.user_teaches_class(p_class_id)
      or public.can_read_class_pii(p_class_id)
    )
  group by response.student_id,
           coalesce(profile.display_name, profile.full_name, 'Pupil'),
           topic.id,
           topic.name,
           topic.subject_id
  having count(*) filter (where response.is_correct is not null) > 0
     and round(
       100.0 * count(*) filter (where response.is_correct)
       / nullif(count(*) filter (where response.is_correct is not null), 0),
       0
     ) <= p_threshold
  order by pct_correct asc, marked desc;
$$;

revoke execute on function public.class_intervention_list(uuid, int, text) from public;
grant execute on function public.class_intervention_list(uuid, int, text) to anon, authenticated, service_role;

-- Link marked retrieval responses to the assignment that requested them and
-- preserve the original automated decision before any teacher review.
alter table public.responses
  add column if not exists assignment_id uuid references public.retrieval_assignments(id) on delete set null,
  add column if not exists original_is_correct boolean,
  add column if not exists original_marks_awarded integer,
  add column if not exists review_decision text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists marker_model text,
  add column if not exists rubric_version integer not null default 1;

alter table public.responses drop constraint if exists responses_review_decision_check;
alter table public.responses add constraint responses_review_decision_check
  check (review_decision is null or review_decision in (
    'accepted', 'override_correct', 'override_incorrect',
    'appeal_overturned', 'appeal_upheld'
  )) not valid;
alter table public.responses validate constraint responses_review_decision_check;

alter table public.responses drop constraint if exists responses_original_marks_nonnegative;
alter table public.responses add constraint responses_original_marks_nonnegative
  check (original_marks_awarded is null or original_marks_awarded >= 0) not valid;
alter table public.responses validate constraint responses_original_marks_nonnegative;

alter table public.responses drop constraint if exists responses_rubric_version_positive;
alter table public.responses add constraint responses_rubric_version_positive
  check (rubric_version > 0) not valid;
alter table public.responses validate constraint responses_rubric_version_positive;

update public.responses
set original_is_correct = coalesce(original_is_correct, is_correct),
    original_marks_awarded = coalesce(original_marks_awarded, marks_awarded)
where original_is_correct is null or original_marks_awarded is null;

create index if not exists responses_assignment_student_idx
  on public.responses(assignment_id, student_id, answered_at)
  where assignment_id is not null;
create index if not exists responses_marking_quality_idx
  on public.responses(class_id, teacher_reviewed, answered_at desc);

-- Existing marking-review grants covered the verdict columns. Add only the new
-- audit fields (plus feedback for the existing appeal-overturn annotation); row
-- access is still constrained by the staff-only responses_update RLS policy.
grant update (review_decision, reviewed_at, reviewed_by, ai_feedback)
  on public.responses to authenticated;

create or replace function private.protect_response_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.original_is_correct := coalesce(new.original_is_correct, new.is_correct);
    new.original_marks_awarded := coalesce(new.original_marks_awarded, new.marks_awarded);
  else
    new.assignment_id := old.assignment_id;
    new.original_is_correct := old.original_is_correct;
    new.original_marks_awarded := old.original_marks_awarded;
    new.marker_model := old.marker_model;
    new.rubric_version := old.rubric_version;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_response_provenance() from public, anon, authenticated;
drop trigger if exists responses_protect_provenance on public.responses;
create trigger responses_protect_provenance
before insert or update on public.responses
for each row execute function private.protect_response_provenance();

-- Upgrade paper assignment metadata without disrupting existing assignments.
alter table public.paper_class_assignments
  add column if not exists instructions text not null default '',
  add column if not exists due_at timestamptz,
  add column if not exists attempt_limit integer not null default 1,
  add column if not exists published boolean not null default true;

alter table public.paper_class_assignments drop constraint if exists pca_attempt_limit_check;
alter table public.paper_class_assignments add constraint pca_attempt_limit_check
  check (attempt_limit between 1 and 10) not valid;
alter table public.paper_class_assignments validate constraint pca_attempt_limit_check;

alter table public.paper_class_assignments drop constraint if exists pca_schedule_order_check;
alter table public.paper_class_assignments add constraint pca_schedule_order_check
  check (
    (due_at is null or available_from is null or due_at >= available_from)
    and (available_until is null or due_at is null or available_until >= due_at)
  ) not valid;
alter table public.paper_class_assignments validate constraint pca_schedule_order_check;

create index if not exists paper_class_assignments_schedule_idx
  on public.paper_class_assignments(class_id, published, available_from, due_at);

drop policy if exists pca_student_read on public.paper_class_assignments;
create policy pca_student_read
on public.paper_class_assignments for select to authenticated
using (
  public.user_in_class(class_id)
  and published
  and (available_from is null or available_from <= now())
  and (available_until is null or available_until >= now())
);

create or replace function public.user_can_view_paper(p_paper_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.paper_class_assignments assignment
    join public.class_members member on member.class_id = assignment.class_id
    where assignment.paper_id = p_paper_id
      and member.student_id = (select auth.uid())
      and assignment.published
      and (assignment.available_from is null or assignment.available_from <= now())
      and (assignment.available_until is null or assignment.available_until >= now())
  );
$$;

revoke execute on function public.user_can_view_paper(uuid) from public, anon;
grant execute on function public.user_can_view_paper(uuid) to authenticated, service_role;

create or replace function private.can_start_paper_attempt(
  p_paper_id uuid,
  p_class_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student_id = (select auth.uid())
    and exists (
      select 1
      from public.class_members member
      join public.paper_class_assignments assignment
        on assignment.class_id = member.class_id
       and assignment.paper_id = p_paper_id
      where member.class_id = p_class_id
        and member.student_id = p_student_id
        and assignment.published
        and (assignment.available_from is null or assignment.available_from <= now())
        and (assignment.available_until is null or assignment.available_until >= now())
        and (
          select count(*)
          from public.paper_attempts attempt
          where attempt.paper_id = p_paper_id
            and attempt.class_id = p_class_id
            and attempt.student_id = p_student_id
        ) < assignment.attempt_limit
    );
$$;

revoke all on function private.can_start_paper_attempt(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_start_paper_attempt(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists pa_student_self on public.paper_attempts;
drop policy if exists pa_student_select on public.paper_attempts;
drop policy if exists pa_student_insert on public.paper_attempts;
drop policy if exists pa_student_update on public.paper_attempts;

create policy pa_student_select
on public.paper_attempts for select to authenticated
using (student_id = (select auth.uid()));

create policy pa_student_insert
on public.paper_attempts for insert to authenticated
with check (private.can_start_paper_attempt(paper_id, class_id, student_id));

create policy pa_student_update
on public.paper_attempts for update to authenticated
using (student_id = (select auth.uid()))
with check (student_id = (select auth.uid()));

create or replace function private.protect_paper_attempt_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.paper_id := old.paper_id;
  new.class_id := old.class_id;
  new.student_id := old.student_id;
  new.mode := old.mode;
  new.topic_id := old.topic_id;
  new.started_at := old.started_at;
  if (select auth.uid()) = old.student_id then
    -- Column grants already prevent these writes from the browser. This keeps
    -- the rule true even if grants are broadened later, while allowing the
    -- service-role marking function to recompute authoritative totals.
    new.total_marks := old.total_marks;
    new.awarded_marks := old.awarded_marks;
    if old.submitted_at is null and new.submitted_at is not null then
      new.submitted_at := now();
    end if;
  end if;
  if old.submitted_at is not null then
    new.submitted_at := old.submitted_at;
    new.total_marks := old.total_marks;
    new.awarded_marks := old.awarded_marks;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_paper_attempt_identity() from public, anon, authenticated;
drop trigger if exists paper_attempts_protect_identity on public.paper_attempts;
create trigger paper_attempts_protect_identity
before update on public.paper_attempts
for each row execute function private.protect_paper_attempt_identity();

notify pgrst, 'reload schema';
