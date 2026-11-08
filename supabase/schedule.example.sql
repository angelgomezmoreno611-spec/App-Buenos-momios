-- Ejecutar DESPUÉS del despliegue; no es una migración automática.
-- Activa pg_cron, pg_net y Vault en Integrations del dashboard de Supabase.
-- Crea en Vault dos secretos mediante el dashboard (sin pegarlos en este repo):
--   buenos_momios_api_url = https://TU-API.vercel.app
--   buenos_momios_cron_secret = el mismo CRON_SECRET del servidor
-- Horarios en UTC. Mazatlán es UTC-7 todo el año: 07:01 UTC = 00:01 en America/Mazatlan.
-- generate va a las 00:01 (no 00:00) para que el día local ya haya cambiado.
-- Avisos: desfase de 2 minutos para evitar el lock y la cuota de fútbol.

-- Histórico: guarda una vez la temporada anterior de cada liga (sin coste si ya está).
-- Debe ir antes de generate y lejos de settle (:05,:20,:35,:50) por el lock de 70 s.
select cron.schedule('momios-history', '42 6 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/history',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
-- Ligas CSV (football-data.co.uk): su política permite máx. 2 descargas
-- automáticas por semana. Martes y viernes 12:27 UTC, tras sus actualizaciones.
select cron.schedule('momios-csv', '27 12 * * 2,5', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/csv',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
-- Descubrimiento con API-Football (plan gratuito, 100 consultas/día, 10/min):
-- cada 5 min de 05:00 a 06:55 UTC (22:00-23:55 Mazatlán), antes de generate.
-- No usa el lock compartido; cada ejecución hace ≤6 consultas en <45 s.
select cron.schedule('momios-discover', '*/5 5-6 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/discover',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
select cron.schedule('momios-generate', '1 7 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/generate',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
select cron.schedule('momios-settle', '5,20,35,50 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/settle',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
select cron.schedule('momios-notify', '7,22,37,52 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/notify',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
-- Consultar ejecuciones: select * from cron.job_run_details order by start_time desc limit 20;
-- Consultar respuestas HTTP: select * from net._http_response order by created desc limit 20;
-- Pausar: select cron.unschedule('momios-settle'); (igual para history, csv, generate y notify)
