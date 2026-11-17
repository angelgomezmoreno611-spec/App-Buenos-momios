-- Avisos de ticket ganado para todos los teléfonos con avisos activos.
-- Antes solo recibían aviso los usuarios suscritos a esa tanda (la suscripción
-- se hacía al abrir la app ese día); un día sin abrir la app = sin aviso.
-- Un teléfono está en `devices` solo mientras sus avisos están activados
-- (desactivar o cerrar sesión lo borra), así que basta con usar esa tabla.
begin;

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
        select d.user_id, t.batch_id, tid, d.token
        from public.tickets t cross join public.devices d
        where t.id = tid
        on conflict (ticket_id, token) do nothing;
    end if;
  end loop;
end;
$$;

commit;

-- Envío de avisos: 2 minutos después de cada settle (:05,:20,:35,:50) para no
-- chocar con su lock. Sin Firebase configurado el job responde {disabled:true}.
-- Sin pg_cron (PGlite en pruebas) no hace nada.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('momios-notify', '7,22,37,52 * * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/notify',
        headers := jsonb_build_object('Content-Type','application/json','Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 60000
      );
    $cmd$);
  end if;
end
$do$;
