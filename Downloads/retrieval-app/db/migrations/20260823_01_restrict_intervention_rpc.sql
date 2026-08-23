-- STATUS: APPLIED to project uvzukwoxqhcxaxtzrziy on 2026-08-23.
-- Keep pupil-level intervention data behind an authenticated identity.
revoke execute on function public.class_intervention_list(uuid, int, text) from public, anon;
grant execute on function public.class_intervention_list(uuid, int, text) to authenticated, service_role;
