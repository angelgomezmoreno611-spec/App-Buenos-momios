-- "El arriesgado del día": un quinto ticket opcional por tanda con 2 selecciones
-- over 3.5 y 2 over 2.5. Los tickets normales no cambian.
begin;

alter table public.tickets add column kind text not null default 'regular' check (kind in ('regular', 'risky'));
alter table public.tickets drop constraint tickets_ordinal_check;
alter table public.tickets add constraint tickets_ordinal_check check (ordinal between 1 and 5);
alter table public.selections drop constraint selections_market_check;
alter table public.selections add constraint selections_market_check check (market in ('OVER_1_5', 'OVER_2_5', 'OVER_3_5'));

create or replace function public.publish_batch(p_batch jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  bid uuid := (p_batch->>'id')::uuid;
  old_id uuid;
  t jsonb;
  s jsonb;
  n int;
  k text;
begin
  if p_batch->>'mode' <> 'live' or jsonb_typeof(p_batch->'tickets') <> 'array'
     or jsonb_array_length(p_batch->'tickets') > 5
     or (select count(*) from jsonb_array_elements(p_batch->'tickets') x where coalesce(x->>'kind', 'regular') = 'regular') > 4
     or (select count(*) from jsonb_array_elements(p_batch->'tickets') x where x->>'kind' = 'risky') > 1 then
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
    k := coalesce(t->>'kind', 'regular');
    if k = 'risky' and n <> 4 then raise exception 'El ticket arriesgado necesita cuatro partidos'; end if;
    if n not in (4, 6) then raise exception 'Cada ticket necesita cuatro o seis partidos'; end if;
    insert into public.tickets(id, batch_id, ordinal, probability, legs, kind)
      values ((t->>'id')::uuid, bid, (t->>'number')::smallint, (t->>'probability')::double precision, n, k);
    for s in select value from jsonb_array_elements(t->'selections') loop
      insert into public.selections(ticket_id, batch_id, match_id, kickoff, market, prediction)
        values ((t->>'id')::uuid, bid, s->'match'->>'id', (s->'match'->>'kickoff')::timestamptz,
          s->>'market', s->'prediction');
    end loop;
  end loop;
  return bid;
end;
$$;

commit;
