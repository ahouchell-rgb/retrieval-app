-- STATUS: APPLIED to project uvzukwoxqhcxaxtzrziy on 2026-08-26.
-- Cover the two non-leading foreign keys reported by the Supabase performance
-- advisor. The primary key already covers teacher_id.

create index if not exists teacher_action_states_class_idx
  on public.teacher_action_states(class_id);

create index if not exists teacher_action_states_owner_idx
  on public.teacher_action_states(owner_id)
  where owner_id is not null;
