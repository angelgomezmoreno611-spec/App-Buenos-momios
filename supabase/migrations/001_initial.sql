begin;

create table public.batches (
  id uuid primary key,
  day date not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.tickets (
  id uuid primary key,
  batch_id uuid not null references public.batches(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 4),
  probability double precision not null check (probability between 0 and 1),
  status text not null default 'pending' check (status in ('pending','won','lost','review')),
  unique (batch_id, ordinal),
  unique (id, batch_id)
);
create table public.selections (
  ticket_id uuid not null,
  batch_id uuid not null,
  match_id text not null,
  kickoff timestamptz not null,
  market text not null default 'OVER_2_5' check (market = 'OVER_2_5'),
  prediction jsonb not null,
  result text not null default 'pending' check (result in ('pending','won','lost','review')),
  score text,
  checked_at timestamptz,
  primary key (ticket_id, match_id),
  unique (match_id),
  foreign key (ticket_id, batch_id) references public.tickets(id, batch_id) on delete cascade
);
create index selections_pending on public.selections (kickoff) where result in ('pending','review');

create table public.batch_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);
create table public.devices (
  token text primary key check (length(token) between 20 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android','ios')),
  updated_at timestamptz not null default now()
);
create index devices_user on public.devices(user_id);
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  token text not null references public.devices(token) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','invalid','failed')),
  attempts integer not null default 0,
  lease uuid,
  locked_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  unique (ticket_id, token)
);
create index outbox_pending on public.notification_outbox(next_attempt_at) where status = 'pending';
create table public.job_lock (
  singleton boolean primary key default true check (singleton),
  owner uuid,
  locked_until timestamptz not null default '-infinity',
  next_allowed_at timestamptz not null default '-infinity'
);
insert into public.job_lock(singleton) values (true);

-- Los clientes solo leen análisis y sus propias suscripciones.
-- Todos los cambios pasan por la API autenticada; service_role queda en Node.
alter table public.batches enable row level security;
alter table public.tickets enable row level security;
alter table public.selections enable row level security;
alter table public.batch_subscriptions enable row level security;
alter table public.devices enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.job_lock enable row level security;
revoke all on public.batches, public.tickets, public.selections, public.batch_subscriptions,
  public.devices, public.notification_outbox, public.job_lock from anon, authenticated;
grant select on public.batches, public.tickets, public.selections, public.batch_subscriptions to authenticated;
grant all on public.batches, public.tickets, public.selections, public.batch_subscriptions,
  public.devices, public.notification_outbox, public.job_lock to service_role;
create policy batches_read on public.batches for select to authenticated using (true);
create policy tickets_read on public.tickets for select to authenticated using (true);
create policy selections_read on public.selections for select to authenticated using (true);
create policy subscriptions_read on public.batch_subscriptions for select to authenticated using (user_id = (select auth.uid()));

create function public.publish_batch(p_batch jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  bid uuid := (p_batch->>'id')::uuid;
  old_id uuid;
  t jsonb;
  s jsonb;
begin
  if p_batch->>'mode' <> 'live' or jsonb_typeof(p_batch->'tickets') <> 'array'
     or jsonb_array_length(p_batch->'tickets') > 4 then
    raise exception 'Lote inválido';
  end if;
  insert into public.batches(id, day, payload) values (bid, (p_batch->>'day')::date, p_batch)
    on conflict (day) do nothing returning id into old_id;
  if old_id is null then
    select id into old_id from public.batches where day = (p_batch->>'day')::date;
    return old_id;
  end if;
  for t in select value from jsonb_array_elements(p_batch->'tickets') loop
    if jsonb_array_length(t->'selections') <> 4 then raise exception 'Cada ticket necesita cuatro partidos'; end if;
    insert into public.tickets(id, batch_id, ordinal, probability)
      values ((t->>'id')::uuid, bid, (t->>'number')::smallint, (t->>'probability')::double precision);
    for s in select value from jsonb_array_elements(t->'selections') loop
      insert into public.selections(ticket_id, batch_id, match_id, kickoff, market, prediction)
        values ((t->>'id')::uuid, bid, s->'match'->>'id', (s->'match'->>'kickoff')::timestamptz,
          s->>'market', s->'prediction');
    end loop;
  end loop;
  return bid;
end;
$$;

create function public.subscribe_device(p_user_id uuid, p_batch_id uuid, p_token text, p_platform text)
returns void language plpgsql set search_path = '' as $$
begin
  -- p_user_id siempre procede del JWT verificado en la API, nunca del body.
  insert into public.devices(token, user_id, platform) values (p_token, p_user_id, p_platform)
    on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  insert into public.batch_subscriptions(user_id, batch_id) values (p_user_id, p_batch_id) on conflict do nothing;
end;
$$;

create function public.apply_results(p_results jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  r jsonb;
  tid uuid;
  next_status text;
begin
  for r in select value from jsonb_array_elements(p_results) loop
    update public.selections set result = r->>'result', score = r->>'score', checked_at = now()
      where match_id = r->>'matchId' and result in ('pending','review');
  end loop;
  -- Actualizar resultados y crear avisos ocurre en una sola transacción.
  for tid in select id from public.tickets where status in ('pending','review') order by id for update loop
    select case
      when count(*) <> 4 then 'review'
      when bool_or(result = 'lost') then 'lost'
      when bool_and(result = 'won') then 'won'
      when bool_or(result = 'review') then 'review'
      else 'pending' end
      into next_status from public.selections where ticket_id = tid;
    update public.tickets set status = next_status where id = tid;
    if next_status = 'won' then
      insert into public.notification_outbox(user_id, batch_id, ticket_id, token)
        select sub.user_id, sub.batch_id, tid, d.token
        from public.tickets t
        join public.batch_subscriptions sub on sub.batch_id = t.batch_id
        join public.devices d on d.user_id = sub.user_id
        where t.id = tid
        on conflict (ticket_id, token) do nothing;
    end if;
  end loop;
end;
$$;

create function public.acquire_job_lock() returns uuid
language plpgsql set search_path = '' as $$
declare v_owner uuid := gen_random_uuid(); v_count integer;
begin
  update public.job_lock set owner = v_owner, locked_until = now() + interval '2 minutes',
    next_allowed_at = now() + interval '70 seconds'
    where singleton and locked_until < now() and next_allowed_at < now();
  get diagnostics v_count = row_count;
  if v_count = 0 then return null; end if;
  return v_owner;
end;
$$;
create function public.release_job_lock(p_owner uuid) returns void
language sql set search_path = '' as $$
  update public.job_lock set locked_until = now() where singleton and owner = p_owner;
$$;

create function public.claim_notifications() returns setof public.notification_outbox
language sql set search_path = '' as $$
  with picked as (
    select id from public.notification_outbox where status = 'pending' and attempts < 8
      and next_attempt_at <= now() and (locked_until is null or locked_until < now())
      order by created_at for update skip locked limit 5
  )
  update public.notification_outbox n set locked_until = now() + interval '2 minutes',
    lease = gen_random_uuid(), attempts = attempts + 1,
    next_attempt_at = now() + make_interval(secs => least(3600, (60 * power(2, attempts))::integer))
    from picked where n.id = picked.id returning n.*;
$$;

-- Las funciones no son SECURITY DEFINER. Solo el servidor tiene EXECUTE
-- y los privilegios sobre tablas que requieren; un JWT de usuario no los hereda.
revoke all on function public.publish_batch(jsonb), public.subscribe_device(uuid,uuid,text,text),
  public.apply_results(jsonb), public.acquire_job_lock(), public.release_job_lock(uuid),
  public.claim_notifications() from public, anon, authenticated;
grant execute on function public.publish_batch(jsonb), public.subscribe_device(uuid,uuid,text,text),
  public.apply_results(jsonb), public.acquire_job_lock(), public.release_job_lock(uuid),
  public.claim_notifications() to service_role;

commit;
