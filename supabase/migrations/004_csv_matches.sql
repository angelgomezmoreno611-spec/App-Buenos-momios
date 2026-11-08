-- Partidos de football-data.co.uk (CSV gratuitos). Su política de uso permite
-- como máximo dos descargas automáticas por semana, así que /api/jobs/csv los
-- guarda aquí y la generación diaria y la liquidación leen de esta tabla.
create table public.csv_matches (
  id text primary key check (id ~ '^fdu-[A-Z0-9]+-'),
  league text not null,
  league_name text not null,
  kickoff timestamptz not null,
  home_id text not null,
  home_name text not null,
  away_id text not null,
  away_name text not null,
  status text not null check (status in ('TIMED', 'FINISHED')),
  home_goals smallint check (home_goals >= 0),
  away_goals smallint check (away_goals >= 0),
  available_at timestamptz,
  synced_at timestamptz not null default now(),
  check (home_id <> away_id),
  check ((status = 'FINISHED') = (home_goals is not null and away_goals is not null and available_at is not null))
);
create index csv_matches_kickoff on public.csv_matches (kickoff desc);

-- Cada descarga queda registrada antes de hacerse: el job se niega a correr si
-- ya hubo dos en los últimos siete días.
create table public.csv_sync_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now()
);

alter table public.csv_matches enable row level security;
alter table public.csv_sync_runs enable row level security;
revoke all on public.csv_matches, public.csv_sync_runs from anon, authenticated;
grant all on public.csv_matches, public.csv_sync_runs to service_role;
