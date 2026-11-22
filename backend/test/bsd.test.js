import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBsd, bsdEvents, bsdBlocked, BSD_LEAGUES, BSD_VALIDATION, BSD_REPLACES, BSD_ATTRIBUTION } from '../src/bsd.js';
import { crossPredict, domesticLeagueOf } from '../src/model.js';
import { runJob } from '../src/jobs.js';
import { configuredApp } from '../src/config.js';
import { demoSnapshot } from '../src/demo.js';

const DAY = 86_400_000;
const ev = (id, league, home, away, date, status = 'finished', hs = 2, as = 1) =>
  ({ id, league_id: league, home_team_id: home, home_team: `T${home}`, away_team_id: away, away_team: `T${away}`, event_date: date, status,
    home_score: status === 'finished' ? hs : null, away_score: status === 'finished' ? as : null });

test('BSD: normaliza estados, ids con namespace, Liga MX unida y copas marcadas', () => {
  const m = normalizeBsd(ev(1, 18, 10, 11, '2026-11-20T01:00:00+00:00'));
  assert.deepEqual(m, { id: 'bsd-1', league: { id: 'bsd-18', name: 'MLS' }, kickoff: '2026-11-20T01:00:00.000Z', status: 'FINISHED',
    home: { id: 'bsd-10', name: 'T10' }, away: { id: 'bsd-11', name: 'T11' }, homeGoals: 2, awayGoals: 1, cup: false, neutral: false });
  assert.equal(normalizeBsd(ev(2, 20, 1, 2, '2026-11-20T01:00:00Z', 'notstarted')).league.id, 'bsd-19'); // Clausura = Liga MX
  assert.equal(normalizeBsd(ev(3, 8, 1, 2, '2026-11-26T20:00:00Z', 'notstarted')).cup, true);
  assert.equal(normalizeBsd(ev(4, 1, 1, 2, '2026-11-20T01:00:00Z', 'postponed')).status, 'POSTPONED');
  assert.equal(normalizeBsd(ev(5, 1, 1, 2, '2026-11-20T01:00:00Z', 'canceled')).status, 'CANCELLED');
  assert.equal(normalizeBsd(ev(6, 1, 1, 2, '2026-11-20T01:00:00Z', '2nd_half')).status, 'IN_PLAY');
  // Terminado sin marcador válido (BSD trae a veces -1): a revisión, sin goles.
  for (const home_score of [null, -1]) {
    const bad = normalizeBsd({ ...ev(7, 1, 1, 2, '2026-11-20T01:00:00Z'), home_score });
    assert.deepEqual([bad.status, bad.homeGoals, bad.awayGoals], ['UNKNOWN', null, null]);
  }
  assert.equal(normalizeBsd(ev(8, 1, 3, 3, '2026-11-20T01:00:00Z')), null);
  assert.equal(normalizeBsd({ id: 'x' }), null);
});

test('BSD: validación coherente, sin ligas sin nombre y reemplazos que apuntan a ligas activas', () => {
  for (const market of ['OVER_2_5', 'OVER_1_5']) for (const l of Object.keys(BSD_VALIDATION[market])) assert.ok(BSD_LEAGUES[l], l);
  // Toda liga de over 2.5 también es de over 1.5 (respaldo).
  for (const l of Object.keys(BSD_VALIDATION.OVER_2_5)) assert.ok(BSD_VALIDATION.OVER_1_5[l], l);
  for (const l of [...Object.values(BSD_REPLACES.csv), ...Object.values(BSD_REPLACES.fc)]) assert.ok(BSD_LEAGUES[l], l);
  assert.deepEqual(bsdBlocked('OVER_2_5', ['bsd-18', 'bsd-19', 'bsd-8']), ['bsd-19', 'bsd-8']);
  assert.deepEqual(bsdBlocked('OVER_1_5', ['bsd-18', 'bsd-8']), []);
});

test('BSD: recorre todas las páginas con la ruta relativa de `next`', async () => {
  const asked = [];
  const pages = {
    '/events/?date_from=2026-11-19&date_to=2026-11-30&limit=200': { results: [ev(1, 18, 1, 2, '2026-11-20T01:00:00Z')],
      next: 'https://sports.bzzoiro.com/api/v2/events/?date_from=2026-11-19&date_to=2026-11-30&limit=200&offset=200' },
    '/events/?date_from=2026-11-19&date_to=2026-11-30&limit=200&offset=200': { results: [ev(2, 18, 3, 4, '2026-11-21T01:00:00Z', 'notstarted'), { id: 'malo' }], next: null }
  };
  const out = await bsdEvents('2026-11-19', '2026-11-30', { get: async path => { asked.push(path); return pages[path]; } });
  assert.equal(asked.length, 2);
  assert.deepEqual(out.map(m => m.id), ['bsd-1', 'bsd-2']);
  await assert.rejects(bsdEvents('2026-11-19', '2026-11-30', { get: async () => ({}) }), /sin partidos/);
});

test('job bsd: ventana de 3 días atrás a 8 adelante y limpieza a 400 días', async () => {
  const now = Date.parse('2026-11-22T12:00:00Z'), stored = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {}, storeBsdMatches: async (m, before) => stored.push([m.length, before]),
    bsdAbsenceTeams: async () => new Set(), storeBsdAbsences: async () => {} };
  let path;
  const out = await runJob('bsd', { repo, now, bsd: { leagues: ['bsd-18'], get: async p => { path = p;
    return { results: [ev(1, 18, 1, 2, '2026-11-21T01:00:00Z'), ev(2, 18, 3, 4, '2026-11-25T01:00:00Z', 'notstarted')], next: null }; } } });
  assert.equal(path, '/events/?date_from=2026-11-19&date_to=2026-11-30&limit=200');
  assert.deepEqual(out, { stored: 2, finished: 1, upcoming: 1, absences: { recorded: 0, pending: 0 } }); // el 25 queda a más de 30 h
  assert.deepEqual(stored, [[2, now - 400 * DAY]]);
  assert.deepEqual(await runJob('bsd', { repo, now }), { skipped: true, reason: 'Falta BSD_TOKEN' });
});

test('job bsd guarda las bajas de los equipos que juegan en las próximas 30 h, una vez por día', async () => {
  const now = Date.parse('2026-11-22T12:00:00Z'), saved = [], asked = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {}, storeBsdMatches: async () => {},
    bsdAbsenceTeams: async day => { assert.equal(day, '2026-11-22'); return new Set(['bsd-3']); }, storeBsdAbsences: async rows => saved.push(...rows) };
  const events = [ev(1, 18, 1, 2, '2026-11-22T20:00:00Z', 'notstarted'), ev(2, 7, 3, 4, '2026-11-23T10:00:00Z', 'notstarted'),
    ev(3, 1, 5, 6, '2026-11-22T20:00:00Z', 'notstarted'), ev(4, 18, 7, 8, '2026-11-24T20:00:00Z', 'notstarted')];
  const squad = { players: [{ id: 9, name: 'Kane', position: 'F', availability: 'injured', injury_type: 'Ankle Injury', injury_expected_return: '2027-01-31' },
    { id: 10, name: 'Olise', position: 'M', availability: 'doubtful', injury_type: '', injury_expected_return: null },
    { id: 11, name: 'Musiala', position: 'M', availability: 'available', injury_type: '', injury_expected_return: null }] };
  const out = await runJob('bsd', { repo, now, bsd: { leagues: ['bsd-18'], absencesPerRun: 2, get: async p => {
    asked.push(p); return p.startsWith('/events/') ? { results: events, next: null } : squad; } } });
  // MLS (activa) y Champions (copa a medir) en ≤30 h; Premier (no activa) y el partido del 24, fuera; bsd-3 ya estaba hoy.
  assert.deepEqual(asked.slice(1), ['/teams/1/squad/', '/teams/2/squad/']);
  assert.deepEqual(out.absences, { recorded: 2, pending: 1 }); // bsd-4 queda para la siguiente vuelta
  assert.deepEqual(saved[0], { team: 'bsd-1', teamName: 'T1', matchId: 'bsd-1', kickoff: '2026-11-22T20:00:00.000Z', day: '2026-11-22', squadSize: 3,
    players: [{ id: 9, name: 'Kane', position: 'F', availability: 'injured', injuryType: 'Ankle Injury', expectedReturn: '2027-01-31' },
      { id: 10, name: 'Olise', position: 'M', availability: 'doubtful', injuryType: null, expectedReturn: null }] });
  // Si fallan las bajas, los partidos ya están guardados y el job no falla.
  const broken = await runJob('bsd', { repo: { ...repo, bsdAbsenceTeams: async () => { throw new Error('sin tabla'); } }, now,
    bsd: { leagues: ['bsd-18'], get: async () => ({ results: events, next: null }) } });
  assert.deepEqual(broken.absences, { error: 'sin tabla' });
});

// Historial goleador: equipos 1-8 en MLS (bsd-18) y 9-16 en Liga MX (bsd-19, solo respaldo).
function goalRichHistory(now) {
  const rows = [];
  let id = 1000;
  for (const [league, base] of [['bsd-18', 1], ['bsd-19', 9]]) for (let r = 0; r < 14; r++) for (let i = 0; i < 4; i++) {
    const home = base + ((i + r) % 8), away = base + ((i + r + 4) % 8);
    if (home === away) continue;
    rows.push({ id: `bsd-${id++}`, league: { id: league, name: league }, cup: false, kickoff: new Date(now - (90 - r * 6) * DAY).toISOString(),
      status: 'FINISHED', home: { id: `bsd-${home}`, name: `T${home}` }, away: { id: `bsd-${away}`, name: `T${away}` }, homeGoals: 3, awayGoals: 2,
      availableAt: new Date(now - (90 - r * 6) * DAY + 3 * 3_600_000).toISOString() });
  }
  return rows;
}
const fixture = (id, league, home, away, now, cup = false) => ({ id: `bsd-${id}`, league: { id: league, name: league }, cup,
  kickoff: new Date(now + 5 * 3_600_000).toISOString(), status: 'TIMED', home: { id: `bsd-${home}`, name: `T${home}` }, away: { id: `bsd-${away}`, name: `T${away}` },
  homeGoals: null, awayGoals: null });

test('crossPredict: la copa usa la liga local de cada equipo e ignora partidos de copa', () => {
  const now = Date.parse('2026-11-22T12:00:00Z'), history = goalRichHistory(now);
  const cupGames = Array.from({ length: 30 }, (_, i) => ({ ...history[i], id: `bsd-c${i}`, league: { id: 'bsd-8', name: 'EL' }, cup: true }));
  assert.equal(domesticLeagueOf('bsd-1', [...history, ...cupGames, ...cupGames], now), 'bsd-18');
  const p = crossPredict(fixture(1, 'bsd-8', 1, 9, now, true), [...history, ...cupGames], { asOf: now, line: 1.5 });
  assert.equal(p.eligible, true);
  assert.deepEqual(p.domesticLeagues.sort(), ['bsd-18', 'bsd-19']);
  assert.ok(p.reasons.at(-1).includes('liga local'));
  assert.equal(crossPredict(fixture(2, 'bsd-8', 1, 99, now, true), history, { asOf: now }).reason, 'Equipo sin liga local con historial');
});

test('generate usa BSD: over 2.5 solo en ligas validadas, copa con liga local y solo como respaldo', async () => {
  const now = Date.parse('2026-11-22T12:00:00Z'), history = goalRichHistory(now);
  const fixtures = [fixture(1, 'bsd-18', 1, 5, now), fixture(2, 'bsd-18', 2, 6, now), fixture(3, 'bsd-18', 3, 7, now),
    fixture(4, 'bsd-19', 9, 13, now), fixture(5, 'bsd-19', 10, 14, now), fixture(6, 'bsd-8', 4, 11, now, true)];
  const calls = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {}, getBatch: async () => null, usedMatches: async () => [], history: async () => [],
    bsdMatches: async (since, filter) => { calls.push(filter);
      if (filter.leagues?.includes('bsd-8')) return [...history.filter(m => filter.leagues.includes(m.league.id)), ...fixtures];
      if (filter.teams) return history.filter(m => filter.teams.includes(m.home.id) || filter.teams.includes(m.away.id));
      return history.filter(m => filter.leagues.includes(m.league.id)); },
    publish: async b => { repo.published = b; return b.id; } };
  const provider = { competitions: () => [], snapshot: async () => ({ ...demoSnapshot(now), fixtures: [], history: [] }) };
  await runJob('generate', { repo, provider, now, timeZone: 'America/Mazatlan', legs: 3, days: 7, ticketThresholds: [0.6, 0.6],
    bsd: { leagues: ['bsd-18', 'bsd-19', 'bsd-8'] } });
  const sel = repo.published.tickets.flatMap(t => t.selections);
  assert.ok(sel.some(s => s.match.league.id === 'bsd-18' && s.market === 'OVER_2_5'));
  // Liga MX y Europa League nunca como over 2.5.
  assert.ok(sel.every(s => !['bsd-19', 'bsd-8'].includes(s.match.league.id) || s.market === 'OVER_1_5'));
  // Pidió el historial de los equipos de la copa y luego sus ligas que no estaban cargadas.
  assert.deepEqual(calls[1], { teams: ['bsd-4', 'bsd-11'] });
  assert.deepEqual(calls[2], { leagues: [] }); // bsd-18 y bsd-19 ya estaban en la consulta principal
  assert.ok(repo.published.warnings.includes(BSD_ATTRIBUTION));
  assert.ok(sel.every(s => !('crossLeague' in s.match) && !('cup' in s.match))); // sin datos internos
});

test('settle liquida partidos de BSD con lo guardado', async () => {
  const applied = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'bsd-1', market: 'OVER_1_5' }, { match_id: 'bsd-2', market: 'OVER_2_5' }],
    bsdResults: async ids => ids.map(id => ({ id, status: 'FINISHED', homeGoals: 1, awayGoals: 1 })),
    applyResults: async r => applied.push(...r) };
  await runJob('settle', { repo, provider: { results: async () => [] } });
  assert.deepEqual(applied, [{ matchId: 'bsd-1', result: 'won', score: '1–1' }, { matchId: 'bsd-2', result: 'lost', score: '1–1' }]);
});

test('config: BSD_COMPETITIONS valida ligas y BSD_TOKEN es opcional', () => {
  const env = { DATA_MODE: 'live', CRON_SECRET: 'x'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' };
  assert.equal(typeof configuredApp(env), 'function');
  assert.equal(typeof configuredApp({ ...env, BSD_TOKEN: 't', BSD_COMPETITIONS: '18,bsd-52' }), 'function');
  assert.throws(() => configuredApp({ ...env, BSD_TOKEN: 't', BSD_COMPETITIONS: '999' }), /BSD_COMPETITIONS/);
});
