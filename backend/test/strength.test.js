import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStrength, strengthPredict, STRENGTH_VERSION } from '../src/strength.js';
import { runJob } from '../src/jobs.js';
import { demoSnapshot } from '../src/demo.js';

const DAY = 86_400_000, now = Date.parse('2026-11-22T12:00:00Z');
// Liga de 6 equipos (todos contra todos, varias vueltas): "g" golea y recibe mucho, "c" cierra partidos.
function league(goals) {
  const teams = ['g', 'c', 'x', 'y', 'z', 'w'], rows = [];
  let day = 300;
  for (let r = 0; r < 4; r++) for (const h of teams) for (const a of teams) if (h !== a) {
    rows.push({ id: `${r}-${h}-${a}`, kickoff: new Date(now - day-- * DAY / 2).toISOString(), home: { id: h }, away: { id: a },
      homeGoals: goals(h, a)[0], awayGoals: goals(h, a)[1], neutral: false });
  }
  return rows;
}
const goals = (h, a) => [(h === 'g' ? 3 : h === 'c' ? 0 : 1) + (a === 'g' ? 2 : 0), (a === 'g' ? 3 : a === 'c' ? 0 : 1) + (h === 'g' ? 2 : 0)];

test('fitStrength: ataque y defensa reflejan quién golea y quién cierra', () => {
  const fit = fitStrength(league(goals), now);
  const t = Object.fromEntries(fit.teams.map(x => [x.team, x]));
  assert.ok(t.g.attack > t.x.attack && t.g.defense > t.x.defense); // golea y concede más
  assert.ok(t.c.attack < t.x.attack); // casi no anota
  assert.ok(fit.mu > 0 && fit.home > 0 && fit.matches === 120);
  assert.equal(t.g.games, 40);
  // Partidos futuros o sin marcador no cuentan.
  const more = fitStrength([...league(goals), { id: 'f', kickoff: new Date(now + DAY).toISOString(), home: { id: 'g' }, away: { id: 'c' }, homeGoals: 9, awayGoals: 9 },
    { id: 'n', kickoff: new Date(now - DAY).toISOString(), home: { id: 'g' }, away: { id: 'c' }, homeGoals: null, awayGoals: null }], now);
  assert.equal(more.matches, 120);
});

test('strengthPredict: más goles esperados con el goleador; rechaza datos viejos, pocos partidos y cancha neutral sin ventaja', () => {
  const fit = fitStrength(league(goals), now), team = new Map(fit.teams.map(x => [x.team, x]));
  const input = (h, a) => ({ mu: fit.mu, home: fit.home, fittedAt: fit.fittedAt, homeTeam: team.get(h), awayTeam: team.get(a) });
  const fx = (h, a, neutral = false) => ({ id: `bsd-${h}${a}`, kickoff: new Date(now + DAY).toISOString(), neutral });
  const hot = strengthPredict(fx('g', 'x'), input('g', 'x'), { asOf: now }), cold = strengthPredict(fx('c', 'x'), input('c', 'x'), { asOf: now });
  assert.ok(hot.eligible && cold.eligible && hot.probability > cold.probability);
  assert.equal(hot.modelVersion, STRENGTH_VERSION);
  assert.ok(strengthPredict(fx('g', 'x', true), input('g', 'x'), { asOf: now }).expectedHome < hot.expectedHome);
  assert.ok(strengthPredict(fx('g', 'x'), input('g', 'x'), { asOf: now, line: 1.5 }).probability > hot.probability);
  assert.match(strengthPredict(fx('g', 'x'), { ...input('g', 'x'), fittedAt: new Date(now - 4 * DAY).toISOString() }, { asOf: now }).reason, /desactualizada/);
  assert.match(strengthPredict(fx('g', 'x'), { ...input('g', 'x'), awayTeam: { ...team.get('x'), games: 3 } }, { asOf: now }).reason, /Menos de 8/);
  assert.match(strengthPredict(fx('g', 'q'), input('g', 'q'), { asOf: now }).reason, /sin fuerza/);
  assert.match(strengthPredict(fx('g', 'x'), null, { asOf: now }).reason, /sin fuerza/);
});

test('job ratings ajusta con el último año guardado y guarda equipos y parámetros', async () => {
  let since, stored;
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {},
    bsdResultsSince: async s => { since = s; return league(goals); }, storeRatings: async fit => { stored = fit; } };
  const out = await runJob('ratings', { repo, now, bsd: { leagues: [] } });
  assert.equal(since, now - 400 * DAY);
  assert.equal(out.teams, 6);
  assert.equal(stored.teams.length, 6);
  assert.equal(stored.fittedAt, new Date(now).toISOString());
  assert.deepEqual(await runJob('ratings', { repo, now }), { skipped: true, reason: 'Falta BSD_TOKEN' });
  assert.deepEqual(await runJob('ratings', { repo: { ...repo, bsdResultsSince: async () => [] }, now, bsd: {} }), { skipped: true, reason: 'Sin resultados guardados' });
});

test('generate calcula la Champions con el modelo de fuerza y no publica datos internos', async () => {
  const fit = fitStrength(league(goals), now);
  const cl = (id, h, a) => ({ id: `bsd-${id}`, league: { id: 'bsd-7', name: 'Champions League' }, cup: true, neutral: false,
    kickoff: new Date(now + 5 * 3_600_000).toISOString(), status: 'TIMED', home: { id: h, name: h }, away: { id: a, name: a }, homeGoals: null, awayGoals: null });
  const fixtures = [cl(1, 'g', 'x'), cl(2, 'g', 'y'), cl(3, 'z', 'g'), cl(4, 'w', 'g')];
  let asked;
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {}, getBatch: async () => null, usedMatches: async () => [], history: async () => [],
    bsdMatches: async (since, f) => f.leagues ? fixtures : [],
    ratings: async teams => { asked = teams; return { mu: fit.mu, home: fit.home, fittedAt: fit.fittedAt, teams: new Map(fit.teams.map(t => [t.team, t])) }; },
    publish: async b => { repo.published = b; return b.id; } };
  const provider = { competitions: () => [], snapshot: async () => ({ ...demoSnapshot(now), fixtures: [], history: [] }) };
  await runJob('generate', { repo, provider, now, timeZone: 'America/Mazatlan', legs: 3, days: 7, ticketThresholds: [0.5], bsd: { leagues: ['bsd-7'] } });
  assert.deepEqual(asked.sort(), ['g', 'w', 'x', 'y', 'z']);
  const sel = repo.published.tickets.flatMap(t => t.selections);
  assert.ok(sel.some(s => s.match.league.id === 'bsd-7' && s.market === 'OVER_2_5' && s.prediction.modelVersion === STRENGTH_VERSION));
  assert.ok(sel.every(s => !('strengthInput' in s.match)));
});
