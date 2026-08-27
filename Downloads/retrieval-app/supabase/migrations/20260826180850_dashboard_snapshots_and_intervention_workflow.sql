-- STATUS: APPLIED to project uvzukwoxqhcxaxtzrziy on 2026-08-26.
-- Compact, RLS-respecting dashboard reads plus a durable teacher intervention
-- workflow. The RPC runs as the caller (SECURITY INVOKER), so the existing
-- class, response and profile policies remain the authority for every row.

create table if not exists public.teacher_action_states (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  action_key text not null check (length(action_key) between 1 and 300),
  status text not null default 'open'
    check (status in ('open', 'snoozed', 'resolved')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  owner_id uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (teacher_id, class_id, action_key),
  check (status = 'resolved' or resolved_at is null),
  check (status = 'snoozed' or snoozed_until is null)
);

create index if not exists teacher_action_states_open_idx
  on public.teacher_action_states(teacher_id, class_id, status, due_at)
  where status <> 'resolved';

alter table public.teacher_action_states enable row level security;

drop policy if exists teacher_action_states_select on public.teacher_action_states;
create policy teacher_action_states_select
on public.teacher_action_states for select to authenticated
using (
  (teacher_id = (select auth.uid()) and public.user_teaches_class(class_id))
  or public.is_moderator()
);

drop policy if exists teacher_action_states_insert on public.teacher_action_states;
create policy teacher_action_states_insert
on public.teacher_action_states for insert to authenticated
with check (
  (teacher_id = (select auth.uid()) and public.user_teaches_class(class_id))
  or public.is_moderator()
);

drop policy if exists teacher_action_states_update on public.teacher_action_states;
create policy teacher_action_states_update
on public.teacher_action_states for update to authenticated
using (
  (teacher_id = (select auth.uid()) and public.user_teaches_class(class_id))
  or public.is_moderator()
)
with check (
  (teacher_id = (select auth.uid()) and public.user_teaches_class(class_id))
  or public.is_moderator()
);

drop policy if exists teacher_action_states_delete on public.teacher_action_states;
create policy teacher_action_states_delete
on public.teacher_action_states for delete to authenticated
using (
  (teacher_id = (select auth.uid()) and public.user_teaches_class(class_id))
  or public.is_moderator()
);

revoke all on table public.teacher_action_states from anon;
grant select, insert, update, delete on table public.teacher_action_states to authenticated;
grant all on table public.teacher_action_states to service_role;

create or replace function public.teacher_dashboard_snapshot(
  p_class_id uuid,
  p_weeks integer default 12
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_weeks integer := greatest(1, least(coalesce(p_weeks, 12), 12));
  v_week_start timestamptz :=
    date_trunc('week', timezone('Europe/London', now())) at time zone 'Europe/London';
  v_snapshot jsonb;
begin
  if (select auth.uid()) is null or not (
    public.user_teaches_class(p_class_id)
    or public.can_read_class_pii(p_class_id)
    or public.is_moderator()
  ) then
    raise exception 'Not authorised to view this class dashboard'
      using errcode = '42501';
  end if;

  with
  event_rows as (
    select response.student_id,
           response.answered_at,
           response.is_correct as correct,
           question.topic_id,
           topic.name as topic_name
    from public.responses response
    left join public.questions question on question.id = response.question_id
    left join public.topics topic on topic.id = question.topic_id
    where response.class_id = p_class_id
      and response.answered_at >= v_week_start - ((v_weeks - 1) * interval '7 days')
      and coalesce(response.ai_feedback, '') not like 'FLAGGED:%'

    union all

    select attempt.student_id,
           response.answered_at,
           coalesce(response.marks_awarded, 0) > 0 as correct,
           question.topic_id,
           topic.name as topic_name
    from public.paper_responses response
    join public.paper_attempts attempt on attempt.id = response.attempt_id
    left join public.paper_questions question on question.id = response.paper_question_id
    left join public.topics topic on topic.id = question.topic_id
    where attempt.class_id = p_class_id
      and attempt.mode = 'full'
      and response.answered_at >= v_week_start - ((v_weeks - 1) * interval '7 days')
      and coalesce(response.flagged, false) = false
  ),
  week_numbers as (
    select generate_series(0, v_weeks - 1) as weeks_ago
  ),
  weekly as (
    select week.weeks_ago,
           count(event.student_id)::integer as total,
           count(event.student_id) filter (where event.correct)::integer as correct
    from week_numbers week
    left join event_rows event
      on event.answered_at >= v_week_start - (week.weeks_ago * interval '7 days')
     and event.answered_at <  v_week_start - (week.weeks_ago * interval '7 days') + interval '7 days'
    group by week.weeks_ago
    order by week.weeks_ago
  ),
  member_rows as (
    select member.student_id,
           coalesce(profile.display_name, profile.full_name, 'Pupil') as student_name,
           coalesce(profile.email, '') as email,
           member.weekly_target_override
    from public.class_members member
    join public.profiles profile on profile.id = member.student_id
    where member.class_id = p_class_id
  ),
  student_totals as (
    select member.student_id,
           count(event.student_id)::integer as total,
           count(event.student_id) filter (where event.correct)::integer as correct
    from member_rows member
    left join event_rows event on event.student_id = member.student_id
    group by member.student_id
  ),
  student_flags as (
    select response.student_id, count(*)::integer as flagged
    from public.responses response
    where response.class_id = p_class_id
      and response.answered_at >= v_week_start - ((v_weeks - 1) * interval '7 days')
      and coalesce(response.ai_feedback, '') like 'FLAGGED:%'
    group by response.student_id
  ),
  student_weekly as (
    select member.student_id,
           week.weeks_ago,
           count(event.student_id)::integer as valid
    from member_rows member
    cross join week_numbers week
    left join event_rows event
      on event.student_id = member.student_id
     and event.answered_at >= v_week_start - (week.weeks_ago * interval '7 days')
     and event.answered_at <  v_week_start - (week.weeks_ago * interval '7 days') + interval '7 days'
    group by member.student_id, week.weeks_ago
  ),
  student_history as (
    select weekly.student_id,
           jsonb_agg(
             jsonb_build_object('weeksAgo', weekly.weeks_ago, 'valid', weekly.valid)
             order by weekly.weeks_ago
           ) as history
    from student_weekly weekly
    group by weekly.student_id
  ),
  topic_rollup as (
    select event.topic_id,
           event.topic_name,
           count(*)::integer as total,
           count(*) filter (where event.correct)::integer as correct
    from event_rows event
    where event.topic_id is not null and event.topic_name is not null
    group by event.topic_id, event.topic_name
  ),
  misconception_rollup as (
    select question.question_text,
           coalesce(topic.name, '') as topic_name,
           count(*)::integer as total,
           to_jsonb((array_agg(response.student_answer order by response.answered_at desc)
             filter (where nullif(btrim(response.student_answer), '') is not null))[1:3]) as answers
    from public.responses response
    join public.questions question on question.id = response.question_id
    left join public.topics topic on topic.id = question.topic_id
    where response.class_id = p_class_id
      and response.answered_at >= now() - interval '14 days'
      and response.is_correct = false
      and coalesce(response.ai_feedback, '') not like 'FLAGGED:%'
    group by question.question_text, coalesce(topic.name, '')
    order by count(*) desc
    limit 10
  ),
  intervention_pupils as (
    select assignment.id,
           assignment.title,
           assignment.due_at,
           assignment.created_at,
           count(pupil.student_id)::integer as assigned_count,
           count(pupil.student_id) filter (where pupil.completed_at is not null)::integer as completed_count,
           round(avg(pupil.baseline_pct), 0) as baseline_pct
    from public.retrieval_assignments assignment
    join public.retrieval_assignment_students pupil on pupil.assignment_id = assignment.id
    where assignment.class_id = p_class_id
      and assignment.status <> 'archived'
    group by assignment.id, assignment.title, assignment.due_at, assignment.created_at
    order by assignment.created_at desc
    limit 8
  ),
  intervention_responses as (
    select response.assignment_id,
           round(
             100.0 * count(response.id) filter (where response.is_correct)
             / nullif(count(response.id), 0),
             0
           ) as current_pct
    from public.responses response
    join intervention_pupils intervention on intervention.id = response.assignment_id
    where coalesce(response.ai_feedback, '') not like 'FLAGGED:%'
    group by response.assignment_id
  ),
  intervention_rollup as (
    select intervention.*,
           response.current_pct
    from intervention_pupils intervention
    left join intervention_responses response on response.assignment_id = intervention.id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'weeks', v_weeks,
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weeksAgo', weekly.weeks_ago,
        'total', weekly.total,
        'correct', weekly.correct
      ) order by weekly.weeks_ago) from weekly
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', member.student_id,
        'name', member.student_name,
        'email', member.email,
        'targetOverride', member.weekly_target_override,
        't', totals.total,
        'c', totals.correct,
        'flagged', coalesce(flags.flagged, 0),
        'weeklyHistory', history.history
      ) order by member.student_name)
      from member_rows member
      join student_totals totals on totals.student_id = member.student_id
      join student_history history on history.student_id = member.student_id
      left join student_flags flags on flags.student_id = member.student_id
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', topic.topic_id,
        'name', topic.topic_name,
        't', topic.total,
        'c', topic.correct,
        'pct', case when topic.total > 0 then round(100.0 * topic.correct / topic.total, 0) else 0 end
      ) order by (case when topic.total > 0 then 100.0 * topic.correct / topic.total else 0 end), topic.topic_name)
      from topic_rollup topic
    ), '[]'::jsonb),
    'misconceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'q', misconception.question_text,
        'topic', misconception.topic_name,
        'n', misconception.total,
        'ans', coalesce(misconception.answers, '[]'::jsonb)
      ) order by misconception.total desc)
      from misconception_rollup misconception
    ), '[]'::jsonb),
    'interventions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', intervention.id,
        'title', intervention.title,
        'dueAt', intervention.due_at,
        'assignedCount', intervention.assigned_count,
        'completedCount', intervention.completed_count,
        'baselinePct', intervention.baseline_pct,
        'currentPct', intervention.current_pct,
        'change', case
          when intervention.baseline_pct is null or intervention.current_pct is null then null
          else intervention.current_pct - intervention.baseline_pct
        end
      ) order by intervention.created_at desc)
      from intervention_rollup intervention
    ), '[]'::jsonb)
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

comment on function public.teacher_dashboard_snapshot(uuid, integer) is
  'RLS-respecting compact class dashboard snapshot; raw answers remain an explicit drill-down.';

revoke execute on function public.teacher_dashboard_snapshot(uuid, integer) from public, anon;
grant execute on function public.teacher_dashboard_snapshot(uuid, integer) to authenticated, service_role;

create or replace function public.student_home_snapshot(p_weeks integer default 8)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid := (select auth.uid());
  v_weeks integer := greatest(1, least(coalesce(p_weeks, 8), 12));
  v_week_start timestamptz :=
    date_trunc('week', timezone('Europe/London', now())) at time zone 'Europe/London';
  v_snapshot jsonb;
begin
  if v_student_id is null then
    raise exception 'Sign in to load the pupil dashboard' using errcode = '42501';
  end if;

  with
  member_classes as (
    select class.id,
           class.name,
           class.weekly_target,
           member.weekly_target_override
    from public.class_members member
    join public.classes class on class.id = member.class_id
    where member.student_id = v_student_id
  ),
  event_rows as (
    select response.class_id,
           response.answered_at
    from public.responses response
    join member_classes class on class.id = response.class_id
    where response.student_id = v_student_id
      and response.answered_at >= v_week_start - ((v_weeks - 1) * interval '7 days')
      and coalesce(response.ai_feedback, '') not like 'FLAGGED:%'

    union all

    select attempt.class_id,
           response.answered_at
    from public.paper_responses response
    join public.paper_attempts attempt on attempt.id = response.attempt_id
    join member_classes class on class.id = attempt.class_id
    where attempt.student_id = v_student_id
      and attempt.mode = 'full'
      and response.answered_at >= v_week_start - ((v_weeks - 1) * interval '7 days')
      and coalesce(response.flagged, false) = false
  ),
  class_progress as (
    select class.id as class_id,
           count(event.class_id) filter (
             where event.answered_at >= v_week_start
               and event.answered_at < v_week_start + interval '7 days'
           )::integer as valid
    from member_classes class
    left join event_rows event on event.class_id = class.id
    group by class.id
  ),
  assignment_rows as (
    select assignment.id,
           assignment.class_id,
           assignment.title,
           assignment.instructions,
           assignment.topic_id,
           assignment.question_count,
           assignment.available_from,
           assignment.due_at,
           assignment.source,
           assignment.created_at,
           pupil.baseline_pct,
           pupil.assigned_at,
           required.total,
           answered.total as answered
    from public.retrieval_assignment_students pupil
    join public.retrieval_assignments assignment on assignment.id = pupil.assignment_id
    join member_classes class on class.id = assignment.class_id
    cross join lateral (
      select count(*)::integer as total
      from public.retrieval_assignment_questions link
      where link.assignment_id = assignment.id
    ) required
    cross join lateral (
      select count(distinct response.question_id)::integer as total
      from public.responses response
      where response.assignment_id = assignment.id
        and response.student_id = v_student_id
        and coalesce(response.ai_feedback, '') not like 'FLAGGED:%'
    ) answered
    where pupil.student_id = v_student_id
      and pupil.completed_at is null
      and assignment.status = 'published'
      and (assignment.available_from is null or assignment.available_from <= now())
      and answered.total < greatest(required.total, assignment.question_count)
  ),
  paper_rows as (
    select assignment.class_id,
           assignment.instructions,
           assignment.due_at,
           assignment.attempt_limit,
           paper.id,
           paper.name,
           paper.total_marks,
           paper.exam_board,
           paper.paper_year,
           paper.paper_number,
           attempt.in_progress,
           attempt.submitted_count
    from public.paper_class_assignments assignment
    join public.papers paper on paper.id = assignment.paper_id
    join member_classes class on class.id = assignment.class_id
    cross join lateral (
      select exists (
               select 1 from public.paper_attempts item
               where item.paper_id = paper.id and item.student_id = v_student_id
                 and item.class_id = assignment.class_id and item.submitted_at is null
             ) as in_progress,
             count(*) filter (where item.submitted_at is not null)::integer as submitted_count
      from public.paper_attempts item
      where item.paper_id = paper.id
        and item.student_id = v_student_id
        and item.class_id = assignment.class_id
        and item.mode = 'full'
    ) attempt
    where assignment.published = true
      and coalesce(paper.archived, false) = false
      and (attempt.in_progress or attempt.submitted_count = 0)
  ),
  review_rows as (
    select 'flag-' || flag.id::text as id,
           flag.class_id,
           coalesce(class.name, 'Class') as class_name,
           coalesce(question.question_text, 'A reported answer') as question,
           coalesce(flag.teacher_notes, 'Your teacher has checked the mark you reported.') as note,
           flag.teacher_decision = 'overturned' as overturned,
           coalesce(flag.resolved_at, flag.created_at) as reviewed_at
    from public.marking_flags flag
    left join public.questions question on question.id = flag.question_id
    left join member_classes class on class.id = flag.class_id
    where flag.student_id = v_student_id and flag.resolved = true

    union all

    select 'response-' || response.id::text,
           response.class_id,
           coalesce(class.name, 'Class'),
           coalesce(question.question_text, 'A recent answer'),
           case when response.review_decision like 'override%'
             then 'Your teacher adjusted the original AI mark.'
             else 'Your teacher checked and confirmed this mark.' end,
           response.review_decision in ('override_correct', 'appeal_overturned'),
           response.reviewed_at
    from public.responses response
    left join public.questions question on question.id = response.question_id
    left join member_classes class on class.id = response.class_id
    where response.student_id = v_student_id
      and response.teacher_reviewed = true
      and response.reviewed_at is not null
      and not exists (
        select 1 from public.marking_flags flag where flag.response_id = response.id
      )
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'classProgress', coalesce((
      select jsonb_agg(jsonb_build_object('classId', progress.class_id, 'valid', progress.valid))
      from class_progress progress
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(task order by task ->> 'dueAt' nulls last)
      from (
        select jsonb_build_object(
          'kind', 'assignment',
          'id', assignment.id,
          'title', assignment.title,
          'classId', assignment.class_id,
          'className', class.name,
          'dueAt', assignment.due_at,
          'answered', assignment.answered,
          'total', greatest(assignment.total, assignment.question_count),
          'inProgress', assignment.answered > 0,
          'payload', jsonb_build_object(
            'id', assignment.id,
            'class_id', assignment.class_id,
            'title', assignment.title,
            'instructions', assignment.instructions,
            'topic_id', assignment.topic_id,
            'question_count', assignment.question_count,
            'available_from', assignment.available_from,
            'due_at', assignment.due_at,
            'source', assignment.source,
            'created_at', assignment.created_at,
            'baseline_pct', assignment.baseline_pct,
            'assigned_at', assignment.assigned_at,
            'answered', assignment.answered,
            'total', greatest(assignment.total, assignment.question_count)
          )
        ) as task
        from assignment_rows assignment
        join member_classes class on class.id = assignment.class_id

        union all

        select jsonb_build_object(
          'kind', 'paper',
          'id', paper.id,
          'title', paper.name,
          'classId', paper.class_id,
          'className', class.name,
          'dueAt', paper.due_at,
          'inProgress', paper.in_progress,
          'payload', jsonb_build_object('id', paper.id)
        )
        from paper_rows paper
        join member_classes class on class.id = paper.class_id
      ) tasks
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', review.id,
        'classId', review.class_id,
        'className', review.class_name,
        'question', review.question,
        'note', review.note,
        'overturned', review.overturned,
        'reviewedAt', review.reviewed_at
      ) order by review.reviewed_at desc)
      from (select * from review_rows order by reviewed_at desc limit 20) review
    ), '[]'::jsonb)
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

comment on function public.student_home_snapshot(integer) is
  'Compact RLS-respecting pupil home summary, open work and reviewed-mark notifications.';

revoke execute on function public.student_home_snapshot(integer) from public, anon;
grant execute on function public.student_home_snapshot(integer) to authenticated, service_role;
