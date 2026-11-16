-- Generar la tanda del día siguiente a las 23:45 de Mazatlán (06:45 UTC).
-- El backend usa la fecha de mañana desde las 23:40; momios-generate (00:01)
-- queda como respaldo y no duplica. Solo actúa si pg_cron está instalado
-- (en las pruebas con PGlite no existe y no hace nada).
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('momios-generate-early', '45 6 * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/generate',
        headers := jsonb_build_object('Content-Type','application/json','Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 60000
      );
    $cmd$);
  end if;
end
$do$;
