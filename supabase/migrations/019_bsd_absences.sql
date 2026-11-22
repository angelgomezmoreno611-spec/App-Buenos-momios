-- Bajas por equipo (BSD /teams/{id}/squad/): lesionados, dudosos y suspendidos de los
-- equipos que juegan en las próximas ~30 h. Se guarda una foto por equipo y día para
-- medir más adelante si las bajas cambian los goles (todavía NO alimentan el modelo).
begin;

create table public.bsd_absences (
  day date not null,
  team text not null check (team ~ '^bsd-[0-9]+$'),
  team_name text not null,
  match_id text not null check (match_id ~ '^bsd-[0-9]+$'),
  kickoff timestamptz not null,
  squad_size smallint not null check (squad_size >= 0),
  -- Solo los que no están disponibles: [{id, name, position, availability, injuryType, expectedReturn}]
  players jsonb not null check (jsonb_typeof(players) = 'array'),
  recorded_at timestamptz not null default now(),
  primary key (day, team)
);
create index bsd_absences_match on public.bsd_absences (match_id);
alter table public.bsd_absences enable row level security;
revoke all on public.bsd_absences from anon, authenticated;
grant all on public.bsd_absences to service_role;

commit;
