-- Modelo de fuerza (src/strength.js) para la Champions: ataque y defensa de cada equipo
-- ajustados una vez al día con todos los partidos de bsd_matches. generate solo lee.
begin;

alter table public.bsd_matches add column neutral boolean not null default false;

create table public.bsd_ratings (
  team text primary key check (team ~ '^bsd-[0-9]+$'),
  attack double precision not null check (attack > 0),
  defense double precision not null check (defense > 0),
  games integer not null check (games >= 0),
  fitted_at timestamptz not null
);
create table public.bsd_rating_meta (
  singleton boolean primary key default true check (singleton),
  mu double precision not null check (mu > 0),
  home double precision not null check (home > 0),
  matches integer not null,
  fitted_at timestamptz not null
);
alter table public.bsd_ratings enable row level security;
alter table public.bsd_rating_meta enable row level security;
revoke all on public.bsd_ratings, public.bsd_rating_meta from anon, authenticated;
grant all on public.bsd_ratings, public.bsd_rating_meta to service_role;

commit;

-- 06:30 UTC (23:30 de Mazatlán), antes de generate (06:45) y lejos de settle/bsd.
-- Sin pg_cron (PGlite en pruebas) no hace nada.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('momios-ratings', '30 6 * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_api_url') || '/api/jobs/ratings',
        headers := jsonb_build_object('Content-Type','application/json','Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buenos_momios_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 60000
      );
    $cmd$);
  end if;
end
$do$;
