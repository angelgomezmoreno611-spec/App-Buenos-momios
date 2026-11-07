-- Histórico de temporadas terminadas (football-data.org) para el modelo.
-- Se descarga una vez por liga y temporada con /api/jobs/history; así cada
-- generación usa el mismo historial que el backtest sin superar la cuota gratuita.
create table public.match_history (
  id text primary key check (id ~ '^fd-[0-9]+$'),
  league text not null,
  league_name text not null,
  season smallint not null check (season between 2000 and 2100),
  kickoff timestamptz not null,
  home_id text not null,
  home_name text not null,
  away_id text not null,
  away_name text not null,
  home_goals smallint not null check (home_goals >= 0),
  away_goals smallint not null check (away_goals >= 0),
  available_at timestamptz not null,
  check (home_id <> away_id)
);
create index match_history_kickoff on public.match_history (kickoff desc);

-- Marca de temporada completa: se escribe después de guardar sus partidos.
create table public.history_seasons (
  league text not null,
  season smallint not null,
  matches integer not null check (matches >= 0),
  stored_at timestamptz not null default now(),
  primary key (league, season)
);

alter table public.match_history enable row level security;
alter table public.history_seasons enable row level security;
revoke all on public.match_history, public.history_seasons from anon, authenticated;
grant all on public.match_history, public.history_seasons to service_role;
