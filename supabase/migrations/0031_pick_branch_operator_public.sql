-- 0031 — wrapper público de app.pick_branch_operator
--
-- El cliente de Supabase de la app (service role en el webhook, sesión en
-- deriveToBranch) solo llama RPCs del schema `public`. La lógica sigue viviendo
-- en `app`, esto es solo la puerta.

create or replace function public.pick_branch_operator(p_agency uuid, p_branch uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.pick_branch_operator(p_agency, p_branch)
$$;

comment on function public.pick_branch_operator(uuid, uuid) is
  'Freelance de la sucursal con menos leads abiertos, solo si la sucursal no tiene admin ni vendedor. Null = que reparta el staff. Wrapper de app.pick_branch_operator.';

revoke all on function public.pick_branch_operator(uuid, uuid) from public, anon;
grant execute on function public.pick_branch_operator(uuid, uuid) to authenticated, service_role;
