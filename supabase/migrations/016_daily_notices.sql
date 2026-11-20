-- Tandas de varios días: los tickets siguen en juego hasta resolverse y cada noche
-- (job generate, 23:45 Mazatlán) se avisa a todos los teléfonos con avisos activos
-- qué tickets siguen activos o, si ya no queda ninguno, que hay tickets nuevos.
-- Estos avisos no son de un ticket: llevan su propio título y texto, y una clave
-- (`dedupe_key`, p. ej. "status:2026-11-21") que evita repetirlos si generate
-- corre dos veces (23:45 y el respaldo de las 00:01).
begin;

alter table public.notification_outbox alter column ticket_id drop not null;
alter table public.notification_outbox add column title text check (length(title) <= 120);
alter table public.notification_outbox add column body text check (length(body) <= 600);
alter table public.notification_outbox add column dedupe_key text check (length(dedupe_key) <= 100);
-- Varios NULL no chocan entre sí: los avisos de ticket ganado siguen usando (ticket_id, token).
alter table public.notification_outbox add constraint outbox_dedupe unique (token, dedupe_key);

create function public.enqueue_notice(p_key text, p_batch_id uuid, p_title text, p_body text) returns integer
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  insert into public.notification_outbox(user_id, batch_id, token, title, body, dedupe_key)
    select d.user_id, p_batch_id, d.token, p_title, p_body, p_key from public.devices d
    on conflict (token, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.enqueue_notice(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_notice(text, uuid, text, text) to service_role;

commit;
