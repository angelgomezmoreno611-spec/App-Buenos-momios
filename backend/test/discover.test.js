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
  const p = formPredict({ id: 'af-1', kickoff: '2099-01-01T00:00:00Z' }, f, { line: 1.5, method: 'raw' });
  assert.ok(p.eligible && p.probability > 0.85 && p.modelVersion === 'form-af-v1');
  // Original: mínimo 4 partidos; encogido (por defecto): mínimo 2.
  const three = featuresFromPrediction(prediction(2, 2, 2, 2, 3));
  assert.equal(formPredict({ id: 'af-1', kickoff: '2099-01-01T00:00:00Z' }, three, { method: 'raw' }).eligible, false);
  assert.equal(formPredict({ id: 'af-1', kickoff: '2099-01-01T00:00:00Z' }, three).eligible, true);
  assert.equal(formPredict({ id: 'af-1', kickoff: '2099-01-01T00:00:00Z' }, featuresFromPrediction(prediction(2, 2, 2, 2, 1))).eligible, false);
  assert.equal(featuresFromPrediction({ response: [] }), null);
});

test('encogimiento: pocos partidos acercan la probabilidad a la media de la liga', async () => {
  const { lambdaFromOver15, shrinkFeatures } = await import('../src/apifootball.js');
  // Ida y vuelta: λ=2.7 da over 1.5 ≈ 0.751.
  const rate = 1 - Math.exp(-2.7) * (1 + 2.7);
  assert.ok(Math.abs(lambdaFromOver15(rate) - 2.7) < 1e-6);
  assert.equal(lambdaFromOver15(null), 2.7);
  const kick = { id: 'af-1', kickoff: '2099-01-01T00:00:00Z' };
  const big = n => featuresFromPrediction(prediction(4, 2, 3, 3, n)); // equipos muy goleadores
  const at = (n, leagueGoals) => formPredict(kick, big(n), { line: 2.5, leagueGoals }).probability;
  const raw = formPredict(kick, big(9), { line: 2.5, method: 'raw' }).probability;
  // Con 2 partidos el dato pesa menos que con 9; ninguno supera al promedio sin ajustar.
  assert.ok(at(2) < at(9) && at(9) < raw);
  // En una liga más goleadora la misma forma da más probabilidad.
  assert.ok(at(2, 3.4) > at(2, 2.3));
  const s = shrinkFeatures({ homePlayed: 2, awayPlayed: 2, homeFor: 4, homeAgainst: 0, awayFor: 0, awayAgainst: 4,
    homeLast5For: 1, homeLast5Against: 1, awayLast5For: 1, awayLast5Against: 1 }, { leagueGoals: 2.7, k: 2 });
  assert.ok(Math.abs(s.homeFor - (2 * 4 + 2 * 1.485) / 4) < 1e-9);
  assert.equal(formPredict(kick, big(3)).modelVersion, 'form-af-v1-shrink');
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
test('discover analiza solo partidos del día de la próxima tanda (hora de Mazatlán)', async () => {
  const { targetDay } = await import('../src/discover.js');
  assert.equal(targetDay(Date.parse('2026-11-16T04:00:00Z')), '2026-11-16'); // 21:00 del 15 → tanda del 16
  assert.equal(targetDay(Date.parse('2026-11-16T07:30:00Z')), '2026-11-16'); // 00:30 del 16
  assert.equal(targetDay(Date.parse('2026-11-16T19:00:00Z')), '2026-11-16'); // 12:00 del 16
  const now = Date.parse('2026-11-16T04:00:00Z');
  const mk = (id, kickoff) => ({ id: `af-${id}`, status: 'TIMED', kickoff, league: { id: 'af-500', afId: 500, name: 'Liga', round: 'Regular Season - 3' },
    home: { id: `h${id}` }, away: { id: `a${id}` } });
  const rows = [mk(1, '2026-11-16T06:30:00Z'), mk(2, '2026-11-16T18:00:00Z'), mk(3, '2026-11-17T06:30:00Z'), mk(4, '2026-11-17T08:00:00Z')];
  const asked = [], analyzed = [];
  const repo = { afUsage: async () => ({ calls: 0, lists: ['2026-11-15', '2026-11-16', '2026-11-17'] }), setAfUsage: async () => {},
    afUpcoming: async (from, until) => { asked.push([from, until]); return rows.filter(m => Date.parse(m.kickoff) >= from && Date.parse(m.kickoff) <= until); },
    afLeagueRates: async () => new Map(), saveAfFeatures: async id => analyzed.push(id) };
  const fetcher = async () => Response.json({ response: [] });
  const r = await runDiscover({ repo, key: 'k', fetcher, now, perRun: 6, sleep: async () => {} });
  assert.equal(r.targetDay, '2026-11-16');
  // 23:30 del 15 (06:30Z) es de esta noche y 01:00 del 17 (08:00Z) es de pasado mañana: fuera.
  assert.deepEqual(analyzed.sort(), ['af-2', 'af-3']);
  assert.equal(new Date(asked[0][0]).toISOString(), '2026-11-16T07:00:00.000Z');
});
test('forma propia: promedios de temporada casa/fuera y últimos 5 desde resultados guardados', async () => {
  const { featuresFromHistory } = await import('../src/apifootball.js');
  const lg = { id: 'af-700', afId: 700, name: 'Liga' };
  const r = (d, h, a, hg, ag) => ({ id: `r${d}${h}${a}`, league: lg, kickoff: new Date(Date.parse('2026-08-01T18:00:00Z') + d * 86_400_000).toISOString(),
    home: { id: h }, away: { id: a }, status: 'FINISHED', homeGoals: hg, awayGoals: ag });
  // Temporada anterior (antes de una pausa de >45 días) que no debe contar en casa/fuera.
  const old = [r(-120, 'A', 'X', 9, 9), r(-118, 'Y', 'B', 9, 9)];
  const season = [
    r(0, 'A', 'C', 3, 1), r(7, 'D', 'A', 0, 2), r(14, 'A', 'E', 2, 2), r(21, 'F', 'A', 1, 1), r(28, 'G', 'A', 0, 1),
    r(1, 'C', 'B', 1, 2), r(8, 'B', 'D', 4, 0), r(15, 'E', 'B', 0, 3), r(22, 'B', 'F', 1, 1), r(29, 'B', 'G', 2, 0)];
  const match = { id: 'af-9', league: lg, kickoff: new Date(Date.parse('2026-08-01T18:00:00Z') + 35 * 86_400_000).toISOString(), home: { id: 'A' }, away: { id: 'B' } };
  const f = featuresFromHistory(match, [...old, ...season]);
  // A en casa: 3-1 y 2-2 → 2.5 a favor, 1.5 en contra. B fuera: 2-1 y 3-0 → 2.5 a favor, 0.5 en contra.
  assert.deepEqual([f.homePlayed, f.homeFor, f.homeAgainst, f.awayPlayed, f.awayFor, f.awayAgainst], [2, 2.5, 1.5, 2, 2.5, 0.5]);
  assert.equal(f.source, 'local');
  // Últimos 5 de A en la liga (todos de esta temporada): 3-1, 2-0, 2-2, 1-1, 1-0.
  assert.equal(f.homeLast5For, (3 + 2 + 2 + 1 + 1) / 5);
  // Sin muestra (equipo nuevo) o liga parada más de 45 días: null.
  assert.equal(featuresFromHistory({ ...match, home: { id: 'Z' } }, season), null);
  assert.equal(featuresFromHistory({ ...match, kickoff: '2027-01-01T00:00:00Z' }, season), null);
});
test('discover no gasta consultas en partidos con forma propia', async () => {
  const lg = { id: 'af-700', afId: 700, name: 'Liga', round: 'Regular Season - 9' };
  const now = Date.parse('2026-11-16T04:00:00Z');
  const res = [];
  for (let i = 0; i < 6; i++) {
    const k = new Date(now - (40 - i * 7) * 86_400_000).toISOString();
    res.push({ id: `h${i}`, league: lg, kickoff: k, home: { id: 'A' }, away: { id: `o${i}` }, status: 'FINISHED', homeGoals: 2, awayGoals: 1 });
    res.push({ id: `a${i}`, league: lg, kickoff: k, home: { id: `p${i}` }, away: { id: 'B' }, status: 'FINISHED', homeGoals: 1, awayGoals: 2 });
  }
  const upcoming = [
    { id: 'af-1', status: 'TIMED', kickoff: '2026-11-16T18:00:00Z', league: lg, home: { id: 'A' }, away: { id: 'B' } },
    { id: 'af-2', status: 'TIMED', kickoff: '2026-11-16T19:00:00Z', league: { ...lg, afId: 701, id: 'af-701' }, home: { id: 'N' }, away: { id: 'M' } }];
  const analyzed = [];
  const repo = { afUsage: async () => ({ calls: 0, lists: ['2026-11-15', '2026-11-16', '2026-11-17'] }), setAfUsage: async () => {},
    afUpcoming: async () => upcoming, afFinished: async () => res, afLeagueRates: async () => new Map(), saveAfFeatures: async id => analyzed.push(id) };
  const out = await runDiscover({ repo, key: 'k', fetcher: async () => Response.json({ response: [] }), now, sleep: async () => {} });
  assert.deepEqual(analyzed, ['af-2']); // af-1 ya tiene forma propia
  assert.equal(out.localFeatures, 1);
});
