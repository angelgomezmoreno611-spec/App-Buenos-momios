import { createHash } from 'node:crypto';

export const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : value == null ? '' : String(value).slice(0, 500);
export const score = value => /^(0|[1-9]\d*)$/.test(String(value)) && Number(value) <= 99 ? Number(value) : null;
const list = value => Array.isArray(value) ? value : [];
export const timestamp = value => {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
};
const statusOf = value => {
  const s = text(value).toUpperCase();
  if (['FINISHED', 'MATCH FINISHED', 'FULL TIME', 'FT', 'AET', 'PEN', 'AFTER PEN.', 'AFTER ET'].includes(s)) return 'finished';
  if (['IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'BREAK', 'INTERRUPTED'].includes(s) || /^\d{1,3}'?$/.test(s)) return 'live';
  if (['POSTPONED', 'PST', 'SUSPENDED', 'SUSP'].includes(s)) return 'postponed';
  if (['CANCELLED', 'CANC', 'ABD', 'ABANDONED'].includes(s)) return 'cancelled';
  if (['SCHEDULED', 'TIMED', 'NS', 'NOT STARTED', 'TBD'].includes(s) || s === '') return 'scheduled';
  return 'unknown';
};
const base = (provider, id, home, away, other = {}) => {
  if (!text(id) || !text(home) || !text(away) || text(home) === text(away)) return null;
  const kickoff = timestamp(other.kickoff);
  return { id: `${provider}:${id}`, remoteId: text(id), provider, home: text(home), away: text(away),
    league: text(other.league), kickoff, date: kickoff?.slice(0, 10) ?? other.date ?? null,
    status: statusOf(other.status), score: other.score ?? null, venue: text(other.venue) || null,
    referee: text(other.referee) || null, round: text(other.round) || null,
    statistics: other.statistics ?? [], lineups: other.lineups ?? [], events: other.events ?? [], odds: other.odds ?? [] };
};
const pair = (home, away) => score(home) !== null && score(away) !== null ? { home: score(home), away: score(away) } : null;

export function openLiga(row, now = Date.now()) {
  const result = list(row.matchResults).find(result => result.resultTypeID === 2);
  return base('openligadb', row.matchID, row.team1?.teamName, row.team2?.teamName, {
    kickoff: row.matchDateTimeUTC, league: row.leagueName, round: row.group?.groupName,
    status: row.matchIsFinished === true ? 'FINISHED' : Date.parse(row.matchDateTimeUTC) > now ? 'SCHEDULED' : 'UNKNOWN',
    score: result ? pair(result.pointsTeam1, result.pointsTeam2) : null,
    venue: [row.location?.locationStadium, row.location?.locationCity].filter(Boolean).join(', '),
    events: list(row.goals).slice(0, 30).map(goal => `${goal.matchMinute ?? '?'}′ · ${text(goal.goalGetterName) || 'Gol'} · ${goal.scoreTeam1 ?? '?'}–${goal.scoreTeam2 ?? '?'}`)
  });
}

export function openFootball(row, competition, season, league) {
  const id = createHash('sha256').update(JSON.stringify([competition, season, row.date, row.team1, row.team2])).digest('hex').slice(0, 24);
  const ft = list(row.score?.ft);
  return base('openfootball', id, row.team1, row.team2, { league,
    date: /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') ? row.date : null,
    // Las horas de los archivos no incluyen zona: no inventar una conversión UTC.
    score: pair(ft[0], ft[1]), status: ft.length === 2 ? 'FINISHED' : 'SCHEDULED', round: row.round });
}

export function footballData(row) {
  return base('football-data', row.id, row.homeTeam?.name, row.awayTeam?.name, {
    kickoff: row.utcDate, league: row.competition?.name, status: row.status,
    score: pair(row.score?.fullTime?.home, row.score?.fullTime?.away),
    venue: row.venue, round: row.matchday == null ? null : `Jornada ${row.matchday}`,
    referee: list(row.referees).map(referee => text(referee.name)).filter(Boolean).join(', ')
  });
}

export function apiFootball(row) {
  const stats = new Map();
  for (const team of list(row.statistics)) for (const stat of list(team.statistics)) {
    const key = text(stat.type);
    const entry = stats.get(key) ?? { name: key, home: null, away: null };
    if (team.team?.id === row.teams?.home?.id) entry.home = stat.value == null ? null : text(stat.value);
    if (team.team?.id === row.teams?.away?.id) entry.away = stat.value == null ? null : text(stat.value);
    stats.set(key, entry);
  }
  return base('api-football', row.fixture?.id, row.teams?.home?.name, row.teams?.away?.name, {
    kickoff: row.fixture?.date, league: row.league?.name, status: row.fixture?.status?.short,
    score: pair(row.goals?.home, row.goals?.away), venue: row.fixture?.venue?.name,
    referee: row.fixture?.referee, round: row.league?.round, statistics: [...stats.values()].slice(0, 40),
    lineups: list(row.lineups).slice(0, 2).map(team => ({ team: text(team.team?.name), formation: text(team.formation),
      players: list(team.startXI).slice(0, 11).map(p => text(p.player?.name)).filter(Boolean) })),
    events: list(row.events).slice(0, 60).map(event => `${event.time?.elapsed ?? '?'}′ · ${text(event.type)} · ${text(event.player?.name)} · ${text(event.detail)}`)
  });
}

export function sportmonks(row) {
  const teams = list(row.participants), home = teams.find(team => team.meta?.location === 'home'), away = teams.find(team => team.meta?.location === 'away');
  const goals = list(row.scores).filter(s => s.description === 'CURRENT');
  const h = goals.find(s => s.score?.participant === 'home'), a = goals.find(s => s.score?.participant === 'away');
  const stats = new Map();
  for (const stat of list(row.statistics)) {
    const name = text(stat.type?.name) || `Estadística ${stat.type_id}`;
    const entry = stats.get(name) ?? { name, home: null, away: null };
    if (stat.participant_id === home?.id) entry.home = stat.data?.value == null ? null : text(stat.data.value);
    if (stat.participant_id === away?.id) entry.away = stat.data?.value == null ? null : text(stat.data.value);
    stats.set(name, entry);
  }
  const milliseconds = row.starting_at_timestamp * 1000;
  const kickoff = Number.isFinite(milliseconds) && Math.abs(milliseconds) < 8_640_000_000_000_000 ? new Date(milliseconds).toISOString() : null;
  return base('sportmonks', row.id, home?.name, away?.name, { kickoff, league: row.league?.name,
    status: row.state?.short_name ?? 'UNKNOWN', score: pair(h?.score?.goals, a?.score?.goals), venue: row.venue?.name,
    statistics: [...stats.values()].slice(0, 40),
    lineups: [home, away].filter(Boolean).map(team => ({ team: text(team.name), formation: '',
      players: list(row.lineups).filter(player => player.team_id === team.id && player.type_id === 11)
        .slice(0, 11).map(player => text(player.player_name)).filter(Boolean) })),
    events: list(row.events).slice(0, 60).map(event => `${event.minute ?? '?'}′ · ${text(event.type?.name)} · ${text(event.player_name)}`)
  });
}

export function sportsDb(row) {
  return base('thesportsdb', row.idEvent, row.strHomeTeam, row.strAwayTeam, {
    kickoff: row.strTimestamp, date: /^\d{4}-\d{2}-\d{2}$/.test(row.dateEvent ?? '') ? row.dateEvent : null,
    league: row.strLeague, status: row.strPostponed === 'yes' ? 'POSTPONED' : row.strStatus ?? 'UNKNOWN',
    score: pair(row.intHomeScore, row.intAwayScore), venue: row.strVenue, referee: row.strOfficial,
    round: row.intRound == null ? null : `Jornada ${row.intRound}`
  });
}

export function allSports(row) {
  const goals = text(row.event_final_result).split(/\s*-\s*/);
  return base('allsports', row.event_key, row.event_home_team, row.event_away_team, {
    kickoff: row.event_date && row.event_time ? `${row.event_date}T${row.event_time.length === 5 ? row.event_time + ':00' : row.event_time}Z` : null,
    league: row.league_name, status: row.event_status, score: pair(goals[0], goals[1]),
    venue: row.event_stadium, referee: row.event_referee, round: row.league_round,
    statistics: list(row.statistics).slice(0, 40).map(stat => ({ name: text(stat.type), home: stat.home == null ? null : text(stat.home), away: stat.away == null ? null : text(stat.away) })),
    lineups: ['home_team', 'away_team'].map((side, i) => ({ team: text(i === 0 ? row.event_home_team : row.event_away_team), formation: '',
      players: list(row.lineups?.[side]?.starting_lineups).slice(0, 11).map(player => text(player.player)).filter(Boolean) })),
    events: list(row.goalscorers).slice(0, 30).map(goal => `${text(goal.time)}′ · ${text(goal.home_scorer) || text(goal.away_scorer)} · ${text(goal.score)}`)
  });
}

export function oddsApi(row) {
  const odds = [];
  for (const book of list(row.bookmakers).slice(0, 5)) for (const market of list(book.markets)) {
    if (market.key !== 'totals') continue;
    const outcomes = list(market.outcomes).filter(outcome => outcome.point === 2.5);
    const over = outcomes.find(outcome => outcome.name === 'Over'), under = outcomes.find(outcome => outcome.name === 'Under');
    if (!over && !under) continue;
    odds.push({ bookmaker: text(book.title), line: 2.5,
      over: typeof over?.price === 'number' && over.price > 1 ? over.price : null,
      under: typeof under?.price === 'number' && under.price > 1 ? under.price : null,
      updatedAt: timestamp(market.last_update ?? book.last_update) });
  }
  return base('the-odds-api', row.id, row.home_team, row.away_team, {
    kickoff: row.commence_time, league: row.sport_title ?? row.sport_key, status: 'UNKNOWN', odds
  });
}
