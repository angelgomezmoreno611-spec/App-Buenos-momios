import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballHttp } from '../src/football/http.js';
import { FootballService } from '../src/football/service.js';
import * as normalize from '../src/football/normalize.js';

const at = Date.parse('2026-11-06T12:00:00Z');
const ol = { matchID: 123, matchDateTimeUTC: '2026-11-07T15:30:00Z', leagueName: 'Bundesliga',
  team1: { teamName: 'Local' }, team2: { teamName: 'Visitante' }, matchIsFinished: true,
  matchResults: [{ resultTypeID: 1, pointsTeam1: 0, pointsTeam2: 0 }, { resultTypeID: 2, pointsTeam1: 2, pointsTeam2: 1 }],
  location: { locationStadium: 'Estadio' }, goals: [] };
const af = { fixture: { id: 123, date: ol.matchDateTimeUTC, status: { short: 'FT' } }, league: { name: 'Premier' },
  teams: { home: { id: 1, name: 'Local' }, away: { id: 2, name: 'Visitante' } }, goals: { home: 0, away: null },
  statistics: [{ team: { id: 1 }, statistics: [{ type: 'Shots', value: 0 }] }, { team: { id: 2 }, statistics: [{ type: 'Shots', value: null }] }],
  lineups: [{ team: { name: 'Local' }, formation: '4-3-3', startXI: [{ player: { name: 'Jugador' } }] }] };
const sm = { id: 123, league: { name: 'Superliga' }, starting_at_timestamp: Date.parse(ol.matchDateTimeUTC) / 1000,
  participants: [{ id: 1, name: 'Local', meta: { location: 'home' } }, { id: 2, name: 'Visitante', meta: { location: 'away' } }],
  state: { short_name: 'FT' }, scores: [{ description: 'CURRENT', score: { participant: 'home', goals: 2 } },
    { description: 'CURRENT', score: { participant: 'away', goals: 1 } }] };
const ts = { idEvent: '123', strHomeTeam: 'Local', strAwayTeam: 'Visitante', dateEvent: '2026-11-07', strLeague: 'Premier',
  intHomeScore: '0', intAwayScore: null, strStatus: 'Not Started' };
const all = { event_key: '123', event_home_team: 'Local', event_away_team: 'Visitante', event_date: '2026-11-07',
  event_time: '15:30', event_status: 'Finished', event_final_result: '2 - 1', league_name: 'Liga' };
const oddsId = 'a'.repeat(32);
const odds = { id: oddsId, home_team: 'Local', away_team: 'Visitante', commence_time: ol.matchDateTimeUTC, sport_key: 'soccer_epl',
  bookmakers: [{ title: 'Casa de ejemplo', last_update: ol.matchDateTimeUTC, markets: [{ key: 'totals', outcomes: [
    { name: 'Over', point: 2.5, price: 1.8 }, { name: 'Under', point: 2.5, price: 2.1 }, { name: 'Over', point: 3.5, price: 3.2 }
  ] }] }] };

test('normalización conserva nulos, resultados finales y namespaces de los proveedores', () => {
  const home = normalize.openLiga(ol, at);
  assert.deepEqual(home.score, { home: 2, away: 1 });
  assert.equal(home.status, 'finished');
  assert.equal(normalize.openLiga({ ...ol, matchIsFinished: false }, at).status, 'scheduled');
  assert.equal(normalize.openLiga({ ...ol, matchIsFinished: false, matchDateTimeUTC: '2026-11-01T00:00:00Z' }, at).status, 'unknown');
  assert.equal(normalize.apiFootball(af).score, null);
  assert.deepEqual(normalize.apiFootball(af).statistics, [{ name: 'Shots', home: '0', away: null }]);
  assert.equal(normalize.apiFootball(af).lineups[0].players[0], 'Jugador');
  assert.notEqual(home.id, normalize.apiFootball(af).id);
  assert.equal(normalize.sportsDb(ts).score, null);
  assert.equal(normalize.sportsDb({ ...ts, strStatus: 'Match Finished', intAwayScore: '0' }).status, 'finished');
  assert.equal(normalize.score(null), null);
  assert.equal(normalize.score(''), null);
  assert.equal(normalize.score('-1'), null);
  assert.equal(normalize.score(100000), null);
  assert.deepEqual(normalize.sportmonks(sm).score, { home: 2, away: 1 });
  assert.equal(normalize.sportmonks({ ...sm, starting_at_timestamp: 1e30 }).kickoff, null);
  assert.equal(normalize.allSports(all).kickoff, new Date(ol.matchDateTimeUTC).toISOString());
});

test('OpenFootball no inventa UTC y las cuotas se limitan a la línea 2.5', () => {
  const match = normalize.openFootball({ date: '2026-11-07', time: '15:30', team1: 'Local', team2: 'Visitante', score: { ft: [0, 0] } }, 'en.1', '2026', 'Premier');
  assert.equal(match.kickoff, null);
  assert.equal(match.date, '2026-11-07');
  assert.deepEqual(match.score, { home: 0, away: 0 });
  assert.equal(normalize.oddsApi(odds).odds.length, 1);
  assert.equal(normalize.oddsApi(odds).odds[0].over, 1.8);
  assert.equal(normalize.oddsApi(odds).odds[0].under, 2.1);
});

test('ocho adaptadores usan endpoints oficiales y extraen fichas del proveedor correcto', async () => {
  const calls = [];
  const service = new FootballService({ now: () => at, env: {
    FOOTBALL_DATA_TOKEN: 'fd-test', API_FOOTBALL_KEY: 'af-test', SPORTMONKS_TOKEN: 'sm-test',
    ALLSPORTS_API_KEY: 'all-test', ODDS_API_KEY: 'odds-test'
  }, http: new FootballHttp({ now: () => at, fetcher: async (input, options) => {
    const u = new URL(input); calls.push({ u, options });
    if (u.hostname === 'api.openligadb.de') return Response.json(u.pathname.endsWith('/123') ? ol : [ol]);
    if (u.hostname === 'raw.githubusercontent.com') return Response.json({ name: 'Premier', matches: [{ date: '2026-11-07', team1: 'Local', team2: 'Visitante', score: { ft: [2, 1] } }] });
    if (u.hostname === 'api.football-data.org') {
      assert.equal(options.headers['X-Auth-Token'], 'fd-test');
      const row = { id: 123, utcDate: ol.matchDateTimeUTC, homeTeam: { name: 'Local' }, awayTeam: { name: 'Visitante' }, score: { fullTime: { home: 2, away: 1 } }, status: 'FINISHED' };
      return Response.json(u.pathname.endsWith('/123') ? row : { matches: [row] });
    }
    if (u.hostname === 'v3.football.api-sports.io') { assert.equal(options.headers['x-apisports-key'], 'af-test'); return Response.json({ errors: [], response: [af] }); }
    if (u.hostname === 'api.sportmonks.com') return Response.json({ data: u.pathname.endsWith('/123') ? sm : [sm] });
    if (u.hostname === 'www.thesportsdb.com') return Response.json({ events: [ts] });
    if (u.hostname === 'apiv2.allsportsapi.com') { assert.equal(u.searchParams.get('timezone'), 'UTC'); return Response.json({ success: 1, result: [all] }); }
    if (u.hostname === 'api.the-odds-api.com') return Response.json(u.pathname.endsWith('/odds') ? odds : [odds]);
    throw new Error('Host inesperado');
  } }) });
  for (const source of service.sources().sources.filter(source => source.implemented)) {
    const matches = await service.matches({ provider: source.id });
    assert.equal(matches.matches.length, 1, source.id);
    const detail = await service.detail({ provider: source.id, id: matches.matches[0].remoteId });
    assert.equal(detail.match.id, matches.matches[0].id, source.id);
    assert.equal(detail.match.home, 'Local', source.id);
  }
  assert.equal(calls.length, 15); // OpenFootball reutiliza el archivo ya consultado.
  assert.ok(calls.some(call => call.u.searchParams.get('markets') === 'totals'));
  assert.equal(calls.find(call => call.u.pathname.endsWith('/events')).u.searchParams.get('markets'), null);
  assert.ok(!JSON.stringify(service.sources()).includes('af-test'));
});

test('caché conserva fecha de consulta, evita llamadas duplicadas y valida entradas antes de consultar', async () => {
  let calls = 0, clock = at;
  const service = new FootballService({ now: () => clock, http: new FootballHttp({ now: () => clock,
    fetcher: async () => { calls++; return Response.json([ol, ol, null]); } }) });
  const [one, two] = await Promise.all([service.matches(), service.matches()]);
  assert.equal(calls, 1);
  assert.equal(one.matches.length, 1);
  assert.equal(two.fetchedAt, one.fetchedAt);
  clock += 30_000;
  assert.equal((await service.matches()).fetchedAt, one.fetchedAt);
  assert.equal(calls, 1);
  await assert.rejects(service.matches({ provider: 'besoccer' }), error => error.status === 400);
  await assert.rejects(service.matches({ provider: 'api-football' }), error => error.status === 409);
  await assert.rejects(service.matches({ competition: '../secreto' }), error => error.status === 400);
  await assert.rejects(service.matches({ season: '2026/../../' }), error => error.status === 400);
  await assert.rejects(service.matches({ date: '2026-02-30' }), error => error.status === 400);
  await assert.rejects(service.detail({ id: 'https://otro.example' }), error => error.status === 400);
  assert.equal(calls, 1);
  clock += 300_000;
  await service.matches();
  assert.equal(calls, 2);
  assert.ok(service.cacheBytes <= 4_000_000);
});

test('transporte limita memoria y cuotas y nunca expone cuerpos ni tokens del proveedor', async () => {
  const url = 'https://api.openligadb.de/getmatchdata/bl1/2026';
  const oversized = new FootballHttp({ maxBytes: 20, fetcher: async () => new Response('x'.repeat(30)) });
  await assert.rejects(oversized.get('openligadb', url), /límite de datos/);
  let calls = 0;
  const limited = new FootballHttp({ now: () => at, fetcher: async () => { calls++; return new Response('secret-token', { status: 429, headers: { 'Retry-After': '60' } }); } });
  await assert.rejects(limited.get('openligadb', url), error => error.status === 429 && !error.message.includes('secret-token'));
  await assert.rejects(limited.get('openligadb', url), error => error.status === 429);
  assert.equal(calls, 1);
  await assert.rejects(limited.get('openligadb', 'https://api.the-odds-api.com/v4/sports'), /Dirección/);
  const malformed = new FootballHttp({ fetcher: async () => new Response('<html>privado</html>') });
  await assert.rejects(malformed.get('openligadb', url), /formato inválido/);
});

test('peticiones externas en serie y demo sin llamadas de red', async () => {
  let active = 0, peak = 0;
  const http = new FootballHttp({ fetcher: async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return Response.json([]); } });
  await Promise.all([http.get('openligadb', 'https://api.openligadb.de/getmatchdata/bl1'), http.get('openfootball', 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json')]);
  assert.equal(peak, 1);
  const demo = new FootballService({ mode: 'demo', http: new FootballHttp({ fetcher: () => { throw new Error('No debe consultar'); } }), now: () => at });
  const result = await demo.matches();
  assert.equal(result.matches.length, 16);
  assert.equal((await demo.detail({ id: result.matches[0].remoteId })).match.venue, 'Estadio de ejemplo');
  assert.equal(demo.sources().sources[0].id, 'demo');
});
