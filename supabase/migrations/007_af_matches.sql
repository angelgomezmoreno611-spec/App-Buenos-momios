-- Partidos descubiertos con API-Football (plan gratuito) en ligas que no cubren
-- las demás fuentes. El job /api/jobs/discover guarda la lista diaria, el
-- análisis de forma reciente ("features") y, al día siguiente, el resultado.
-- Los resultados acumulados también sirven para priorizar ligas goleadoras.
create table public.af_matches (
  id text primary key check (id ~ '^af-[0-9]+$'),
  league_id integer not null,
  league_name text not null,
  round text not null default '',
  kickoff timestamptz not null,
  home_id text not null,
  home_name text not null,
  away_id text not null,
  away_name text not null,
  status text not null check (status in ('TIMED', 'FINISHED', 'LIVE', 'UNKNOWN')),
  home_goals smallint check (home_goals >= 0),
  away_goals smallint check (away_goals >= 0),
  features jsonb,
  analyzed_at timestamptz,
  synced_at timestamptz not null default now(),
  check (home_id <> away_id),
  check ((status = 'FINISHED') = (home_goals is not null and away_goals is not null))
);
create index af_matches_kickoff on public.af_matches (kickoff desc);
create index af_matches_league on public.af_matches (league_id) where status = 'FINISHED';

-- Consultas gastadas por día (UTC): el job respeta el límite gratuito.
create table public.af_usage (
  day date primary key,
  calls integer not null default 0 check (calls >= 0),
  lists_done text[] not null default '{}'
);

-- Tasa de over 1.5 por liga con los resultados acumulados (para priorizar).
create view public.af_league_rates with (security_invoker = true) as
  select league_id, count(*)::int as matches,
    avg(((home_goals + away_goals) >= 2)::int)::double precision as over15
  from public.af_matches
  where status = 'FINISHED' and kickoff > now() - interval '120 days'
  group by league_id;

alter table public.af_matches enable row level security;
alter table public.af_usage enable row level security;
revoke all on public.af_matches, public.af_usage, public.af_league_rates from anon, authenticated;
grant all on public.af_matches, public.af_usage to service_role;
grant select on public.af_league_rates to service_role;
