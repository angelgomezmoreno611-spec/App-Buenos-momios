-- Ejecutar DESPUÉS del despliegue; no es una migración automática.
-- Activa pg_cron, pg_net y Vault en Integrations del dashboard de Supabase.
-- Crea en Vault dos secretos mediante el dashboard (sin pegarlos en este repo):
--   buenos_momios_api_url = https://TU-API.vercel.app
--   buenos_momios_cron_secret = el mismo CRON_SECRET del servidor
-- Horarios en UTC. 13:00 UTC = 06:00 en America/Mazatlan.
-- Avisos: desfase de 2 minutos para evitar el lock y la cuota de fútbol.

-- Histórico: guarda una vez la temporada anterior de cada liga (sin coste si ya está).
-- Debe ir antes de generate y con más de 70 s de separación por el lock.
select cron.schedule('momios-history', '50 12 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/history',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
select cron.schedule('momios-generate', '0 13 * * *', $$
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
-- Pausar: select cron.unschedule('momios-settle'); (igual para history, generate y notify)
