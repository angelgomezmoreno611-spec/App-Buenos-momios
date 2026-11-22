-- Tickets de 4 partidos y La soñadora de 8. Con el respaldo over 1.5 (cada over 2.5
-- que falta se cambia por 2 over 1.5) un ticket normal llega a 8 partidos y La
-- soñadora a 16. Se conservan los mínimos anteriores para leer tandas antiguas.
begin;

alter table public.tickets drop constraint tickets_legs_check;
alter table public.tickets add constraint tickets_legs_check check (legs between 3 and 16);

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
     or (select count(*) from jsonb_array_elements(p_batch->'tickets') x where coalesce(x->>'kind', 'regular') <> 'regular') > 1 then
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
    if k = 'dreamer' and n not between 6 and 16 then raise exception 'La soñadora necesita de seis a dieciséis partidos'; end if;
    if k = 'regular' and n not between 3 and 8 then raise exception 'Cada ticket necesita de tres a ocho partidos'; end if;
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
