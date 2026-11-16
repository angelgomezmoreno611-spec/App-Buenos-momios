-- Descubrimiento con API-Football (job discover): cada 5 min de 04:00 a 05:55 UTC
-- (21:00-22:55 Mazatlán), para terminar antes de generate (23:45). Nunca se había
-- programado en producción. Mismo nombre que en schedule.example.sql: si existe,
-- cron.schedule lo actualiza. Sin pg_cron (PGlite en pruebas) no hace nada.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('momios-discover', '*/5 4-5 * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/discover',
        headers := jsonb_build_object('Content-Type','application/json','Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 60000
      );
    $cmd$);
  end if;
end
$do$;
