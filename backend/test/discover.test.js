import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAfFixture, isLeagueGame, featuresFromPrediction, formPredict, pickForAnalysis, FORM_MIN } from '../src/apifootball.js';
import { runDiscover } from '../src/discover.js';
import { generateBatch } from '../src/tickets.js';

const fx = (id, league, extra = {}) => ({
  fixture: { id, date: '2026-11-09T18:00:00+00:00', status: { short: 'NS' } },
  league: { id: league, name: 'Druha Liga', country: 'Ukraine', round: 'Regular Season - 12' },
  teams: { home: { id: id * 10, name: `H${id}` }, away: { id: id * 10 + 1, name: `A${id}` } },
  score: { fulltime: { home: null, away: null } }, ...extra });
const prediction = (hf, ha, af, aa, played = 6) => ({ response: [{ teams: {
  home: { league: { fixtures: { played: { home: played } }, goals: { for: { average: { home: String(hf) } }, against: { average: { home: String(ha) } } } },
    last_5: { goals: { for: { average: String(hf) }, against: { average: String(ha) } } } },
  away: { league: { fixtures: { played: { away: played } }, goals: { for: { average: { away: String(af) } }, against: { average: { away: String(aa) } } } },
    last_5: { goals: { for: { average: String(af) }, against: { average: String(aa) } } } } } }] });

test('API-Football: normaliza, filtra copas y ligas cubiertas, y calcula forma reciente', () => {
  const m = normalizeAfFixture(fx(1, 333));
  assert.deepEqual([m.id, m.status, m.league.id, m.home.id], ['af-1', 'TIMED', 'af-333', 'af-team-10']);
  assert.equal(isLeagueGame(m), true);
  assert.equal(isLeagueGame(normalizeAfFixture(fx(2, 39))), false); // Premier League ya cubierta
  assert.equal(isLeagueGame(normalizeAfFixture({ ...fx(3, 333), league: { id: 333, name: 'Copa del Rey', country: 'Spain', round: '1st Round - 1' } })), false);
  assert.equal(isLeagueGame(normalizeAfFixture({ ...fx(4, 333), league: { id: 333, name: 'Liga', country: 'X', round: 'Semi-finals' } })), false);
  const done = normalizeAfFixture({ ...fx(5, 333), fixture: { id: 5, date: '2026-11-07T18:00:00Z', status: { short: 'FT' } }, score: { fulltime: { home: 2, away: 1 } } });
  assert.deepEqual([done.status, done.homeGoals, done.awayGoals], ['FINISHED', 2, 1]);
  assert.equal(normalizeAfFixture({ ...fx(6, 333), fixture: { id: 6, date: '2026-11-07T18:00:00Z', status: { short: 'AET' } }, score: { fulltime: { home: 1, away: 1 } } }).status, 'LIVE');
  const f = featuresFromPrediction(prediction(2.5, 1.5, 2, 2));
  assert.equal(f.homePlayed, 6);
  const p = formPredict({ id: 'af-1', kickoff: '2099-01-01T00:00:00Z' }, f, { line: 1.5 });
  assert.ok(p.eligible && p.probability > 0.85 && p.modelVersion === 'form-af-v1');
  assert.equal(formPredict({ id: 'af-1', kickoff: '2099-01-01T00:00:00Z' }, featuresFromPrediction(prediction(2, 2, 2, 2, 3))).eligible, false);
  assert.equal(featuresFromPrediction({ response: [] }), null);
});

test('pickForAnalysis reparte entre ligas y prioriza las más goleadoras', () => {
  const now = Date.parse('2026-11-09T06:00:00Z');
  const rows = [1, 2, 3, 4].map(i => normalizeAfFixture(fx(i, i <= 3 ? 500 : 600)));
  const picked = pickForAnalysis(rows, { now, until: Infinity, limit: 2, priority: m => m.league.afId === 600 ? 0.9 : 0.7 });
  assert.deepEqual(picked.map(m => m.league.afId), [600, 500]);
});

test('discover: listas una vez al día, respeta presupuesto y límite por ejecución', async () => {
  let usage = { calls: 0, lists: [] }; const stored = [], features = [], paths = [];
  const repo = {
    afUsage: async () => ({ ...usage, lists: [...usage.lists] }),
    setAfUsage: async (day, calls, lists) => { usage = { calls, lists: [...lists] }; },
    storeAfMatches: async rows => stored.push(...rows),
    afUpcoming: async () => stored.filter(m => m.status === 'TIMED' && !features.some(f => f[0] === m.id)),
    afLeagueRates: async () => new Map(),
    saveAfFeatures: async (id, f) => features.push([id, f])
  };
  const fetcher = async url => { paths.push(new URL(url).pathname + new URL(url).search);
    if (url.includes('/fixtures?date=')) return Response.json({ errors: [], response: [fx(paths.length * 100 + 1, 700), fx(paths.length * 100 + 2, 701)] });
    return Response.json({ errors: [], ...prediction(2, 1.5, 1.5, 2) }); };
  const now = Date.parse('2026-11-09T04:00:00Z'), sleeps = [];
  const first = await runDiscover({ repo, key: 'k', fetcher, now, perRun: 4, sleep: async ms => sleeps.push(ms) });
  assert.deepEqual(first.lists, ['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.equal(first.calls, 4); assert.equal(first.analyzed, 1);
  assert.deepEqual(sleeps, [6500, 6500, 6500]);
  const second = await runDiscover({ repo, key: 'k', fetcher, now, perRun: 4, sleep: async () => {} });
  assert.deepEqual(second.lists, []); // no repite listas
  assert.equal(second.analyzed, 4);
  assert.equal(usage.calls, 8);
  const capped = await runDiscover({ repo, key: 'k', fetcher, now, perRun: 4, sleep: async () => {}, budget: 9 });
  assert.equal(capped.calls, 1); // solo queda 1 del presupuesto
  assert.equal((await runDiscover({ repo, key: '', fetcher, now })).skipped, true);
  await assert.rejects(runDiscover({ repo: { ...repo, afUsage: async () => ({ calls: 0, lists: [] }) }, key: 'k', now,
    fetcher: async () => Response.json({ errors: { plan: 'Free plans do not have access' }, response: [] }), sleep: async () => {} }), /Free plans/);
});

test('generate usa partidos analizados con umbral exigente y sin datos internos', () => {
  const now = Date.parse('2026-11-09T07:01:00Z');
  const mk = (i, hf) => ({ ...normalizeAfFixture(fx(i, 800 + i)), formFeatures: featuresFromPrediction(prediction(hf, 1.5, 1.8, hf)), analyzed: true });
  const strong = [1, 2, 3, 4, 5, 6].map(i => mk(i, 3)), weak = mk(7, 0.6);
  const batch = generateBatch({ fetchedAt: new Date(now).toISOString(), history: [], fixtures: [...strong, weak] },
    { now, market: 'OVER_1_5', legs: 6, minProbability: 0.8 });
  assert.equal(batch.tickets.length, 1);
  const sel = batch.tickets[0].selections;
  assert.ok(sel.every(s => s.prediction.probability >= FORM_MIN.OVER_1_5 && !('formFeatures' in s.match)));
  assert.ok(batch.rejections.some(r => r.matchId === 'af-7'));
  assert.ok(batch.warnings.some(w => w.startsWith('Forma reciente (API-Football)')));
});
