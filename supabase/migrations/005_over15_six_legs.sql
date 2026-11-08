-- Tickets de 6 partidos y mercado over 1.5. Los tickets ya publicados (4
-- partidos, over 2.5) siguen siendo válidos y se liquidan igual.
begin;

alter table public.tickets add column legs smallint not null default 4 check (legs in (4, 6));
alter table public.selections drop constraint selections_market_check;
alter table public.selections alter column market drop default;
alter table public.selections add constraint selections_market_check check (market in ('OVER_2_5', 'OVER_1_5'));

create or replace function public.publish_batch(p_batch jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  bid uuid := (p_batch->>'id')::uuid;
  old_id uuid;
  t jsonb;
  s jsonb;
  n int;
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
    n := jsonb_array_length(t->'selections');
    if n not in (4, 6) then raise exception 'Cada ticket necesita cuatro o seis partidos'; end if;
    insert into public.tickets(id, batch_id, ordinal, probability, legs)
      values ((t->>'id')::uuid, bid, (t->>'number')::smallint, (t->>'probability')::double precision, n);
    for s in select value from jsonb_array_elements(t->'selections') loop
      insert into public.selections(ticket_id, batch_id, match_id, kickoff, market, prediction)
        values ((t->>'id')::uuid, bid, s->'match'->>'id', (s->'match'->>'kickoff')::timestamptz,
          s->>'market', s->'prediction');
    end loop;
  end loop;
  return bid;
end;
$$;

create or replace function public.apply_results(p_results jsonb) returns void
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
      when count(*) <> (select legs from public.tickets where id = tid) then 'review'
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

commit;
