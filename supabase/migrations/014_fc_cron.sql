-- Job de Football Charts: 4 vueltas (≤10 ligas cada una, ~23 s) a las 03:08-03:17 UTC
-- (20:08 Mazatlán, antes de discover y generate) y otra vez a las 15:08-15:17 UTC
-- para traer resultados del día. Entre settle (:05 y :20) por el lock compartido.
-- ~94 consultas/día de 200. Sin pg_cron (PGlite en pruebas) no hace nada.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('momios-fc', '8,11,14,17 3,15 * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/fc',
        headers := jsonb_build_object('Content-Type','application/json','Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 60000
      );
    $cmd$);
  end if;
end
$do$;
