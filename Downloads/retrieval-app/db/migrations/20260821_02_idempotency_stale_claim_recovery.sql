-- STATUS: APPLIED (2026-08-21) to project uvzukwoxqhcxaxtzrziy.
-- A worker can terminate after claiming but before recording failure. Permit an
-- identical request to take over that abandoned claim after five minutes.
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
