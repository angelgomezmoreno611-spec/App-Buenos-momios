begin;

-- Consultar una tanda guardada no implica recibir notificaciones.
create table public.saved_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);
create index saved_batches_recent on public.saved_batches(user_id, created_at desc);

alter table public.saved_batches enable row level security;
revoke all on public.saved_batches from anon, authenticated;
grant select on public.saved_batches to authenticated;
grant all on public.saved_batches to service_role;
create policy saved_batches_read on public.saved_batches for select to authenticated
  using (user_id = (select auth.uid()));

-- Conservar el historial que ya se había guardado al activar los avisos.
insert into public.saved_batches(user_id, batch_id, created_at)
  select user_id, batch_id, created_at from public.batch_subscriptions;

create function public.save_batch(p_user_id uuid, p_batch_id uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.batches where id = p_batch_id) then
    return false;
  end if;
  insert into public.saved_batches(user_id, batch_id) values (p_user_id, p_batch_id)
    on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.save_batch(uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_batch(uuid,uuid) to service_role;

create or replace function public.subscribe_device(p_user_id uuid, p_batch_id uuid, p_token text, p_platform text)
returns void language plpgsql set search_path = '' as $$
begin
  -- p_user_id procede del JWT verificado en la API.
  insert into public.devices(token, user_id, platform) values (p_token, p_user_id, p_platform)
    on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  insert into public.batch_subscriptions(user_id, batch_id) values (p_user_id, p_batch_id) on conflict do nothing;
  insert into public.saved_batches(user_id, batch_id) values (p_user_id, p_batch_id) on conflict do nothing;
end;
$$;

commit;
