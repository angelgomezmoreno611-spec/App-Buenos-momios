-- Football Charts: resultados y próximos partidos de las ligas activas (ids fc-).
-- Los escribe el job /api/jobs/fc; generate y settle solo leen de aquí.
create table if not exists public.fc_matches (
  id text primary key check (id ~ '^fc-[a-z0-9-]+$'),
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
  synced_at timestamptz not null default now(),
  check (home_id <> away_id),
  check ((status = 'FINISHED') = (home_goals is not null and away_goals is not null))
);
create index if not exists fc_matches_kickoff on public.fc_matches (kickoff desc);
create index if not exists fc_matches_league on public.fc_matches (league, kickoff);

-- Última sincronización por liga: el job reparte las ligas entre ejecuciones.
create table if not exists public.fc_sync (
  league text primary key,
  synced_at timestamptz not null default now()
);

alter table public.fc_matches enable row level security;
alter table public.fc_sync enable row level security;
revoke all on public.fc_matches, public.fc_sync from anon, authenticated;
grant all on public.fc_matches, public.fc_sync to service_role;
