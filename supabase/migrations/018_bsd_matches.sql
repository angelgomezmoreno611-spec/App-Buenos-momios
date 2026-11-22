-- Bzzoiro Sports Data (BSD): partidos de todas sus competiciones (400 días hacia atrás
-- y 8 hacia adelante). El job bsd actualiza cada hora una ventana corta; generate y
-- settle solo leen la tabla. Copas incluidas (`cup`): la Europa League se calcula con
-- la liga local de cada equipo.
begin;

create table public.bsd_matches (
  id text primary key check (id ~ '^bsd-[0-9]+$'),
  league text not null check (league ~ '^bsd-[0-9]+$'),
  league_name text not null,
  cup boolean not null default false,
  kickoff timestamptz not null,
  home_id text not null,
  home_name text not null,
  away_id text not null,
  away_name text not null,
  status text not null check (status in ('TIMED','FINISHED','POSTPONED','CANCELLED','SUSPENDED','UNKNOWN','IN_PLAY')),
  home_goals smallint check (home_goals >= 0),
  away_goals smallint check (away_goals >= 0),
  synced_at timestamptz not null default now(),
  check (status <> 'FINISHED' or (home_goals is not null and away_goals is not null))
);
create index bsd_matches_kickoff on public.bsd_matches (kickoff);
alter table public.bsd_matches enable row level security;
revoke all on public.bsd_matches from anon, authenticated;
grant all on public.bsd_matches to service_role;

commit;

-- Cada hora en el minuto 12 (sin chocar con settle :05/:20 ni fc :08). Sin pg_cron
-- (PGlite en pruebas) no hace nada.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('momios-bsd', '12 * * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/bsd',
        headers := jsonb_build_object('Content-Type','application/json','Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 60000
      );
    $cmd$);
  end if;
end
$do$;
