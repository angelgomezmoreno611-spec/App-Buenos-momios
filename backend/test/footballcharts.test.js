import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFcResult, normalizeFcFixture, syncFc, fcBlocked, FC_LEAGUES, FC_AF_IDS, FC_ATTRIBUTION } from '../src/footballcharts.js';
import { COVERED_LEAGUES } from '../src/apifootball.js';
import { runJob } from '../src/jobs.js';
import { demoSnapshot } from '../src/demo.js';

const DAY = 86_400_000;
const res = (id, date, home, away, score, stage = 'league') => ({ id, kickoff_utc: `${date}T18:00:00Z`, homeTeam: home, awayTeam: away, score, stage });

test('Football Charts: normaliza resultados y próximos partidos con el mismo id', () => {
  const r = normalizeFcResult(res(1, '2026-11-20', 'Almere City', 'NAC Breda', '2:1'), 'holland2');
  const f = normalizeFcFixture({ home_team: 'Almere City', away_team: 'NAC Breda', match_date: '2026-11-20', time: '18:00', status: 'scheduled' }, 'holland2');
  assert.equal(r.id, f.id);
  assert.deepEqual([r.status, r.homeGoals, r.awayGoals, r.league.id, f.status, f.kickoff], ['FINISHED', 2, 1, 'fc-holland2', 'TIMED', '2026-11-20T18:00:00.000Z']);
  assert.equal(normalizeFcResult(res(2, '2026-11-20', 'A', 'B', '1:1', 'playoff'), 'holland2'), null); // solo fase de liga
  assert.equal(normalizeFcResult(res(3, '2026-11-20', 'A', 'B', '1:1'), 'premier'), null); // liga no activa
  assert.equal(normalizeFcFixture({ home_team: 'A', away_team: 'B', match_date: '2026-11-20', time: '18:00', status: 'postponed' }, 'holland2'), null);
});

test('Football Charts: mercados por liga según backtest y sin duplicar API-Football', () => {
  assert.ok(fcBlocked('OVER_2_5').includes('fc-saudi1'));   // solo respaldo over 1.5
  assert.ok(fcBlocked('OVER_1_5').includes('fc-austria2')); // solo over 2.5
  assert.ok(!fcBlocked('OVER_2_5').includes('fc-holland2') && !fcBlocked('OVER_1_5').includes('fc-holland2'));
  assert.ok(FC_AF_IDS.every(id => COVERED_LEAGUES.has(id)));
  assert.equal(Object.keys(FC_LEAGUES).length, 22);
});

test('syncFc pide temporada actual y próximos; los fallos no detienen el lote', async () => {
  const asked = [];
  const get = async path => { asked.push(path);
    if (path.startsWith('/leagues/estonia')) throw new Error('HTTP 500');
    return path.includes('/results/') ? { matches: [res(1, '2026-10-01', 'A', 'B', '3:1')] }
      : { matches: [{ home_team: 'A', away_team: 'C', match_date: '2026-11-20', time: '12:00', status: 'scheduled' }] }; };
  const catalog = [{ league: 'holland2', seasons: ['2026-2027', '2025-2026'] }, { league: 'estonia', seasons: ['2026', '2025'] }];
  const out = await syncFc(['holland2', 'estonia'], { get, catalog });
  assert.deepEqual(asked.slice(0, 2), ['/leagues/holland2/results/?season=2026-2027', '/leagues/holland2/fixtures/']);
  assert.deepEqual([out.results.length, out.fixtures.length, out.done, out.failed.map(f => f.league)], [1, 1, ['holland2'], ['estonia']]);
});

test('job fc: reparte ligas por antigüedad, respeta 10 h y guarda resultados y próximos', async () => {
  const now = Date.parse('2026-11-16T03:10:00Z'), stored = [], marked = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {},
    fcSyncTimes: async () => new Map([['holland2', now - 2 * 3_600_000], ['estonia', now - 20 * 3_600_000]]),
    storeFcMatches: async rows => stored.push(...rows), markFcSync: async l => marked.push(...l) };
  const get = async path => path === '/leagues/' ? { leagues: Object.keys(FC_LEAGUES).map(league => ({ league, seasons: ['2026'] })) }
    : path.includes('/results/') ? { matches: [] } : { matches: [] };
  const out = await runJob('fc', { repo, now, fc: { key: 'k', leagues: ['holland2', 'estonia', 'saudi1'], perRun: 5, get } });
  assert.deepEqual(out.synced, ['saudi1', 'estonia']); // nunca sincronizada primero; holland2 está al día
  assert.deepEqual(marked, ['saudi1', 'estonia']);
  assert.equal((await runJob('fc', { repo, now, fc: null })).skipped, true);
});

test('generate usa Football Charts con forma propia y respeta el mercado de cada liga', async () => {
  const now = Date.parse('2026-11-16T15:00:00Z'), full = demoSnapshot(now);
  const rows = [];
  // Historial goleador para 4 equipos locales y 4 visitantes en holland2 (2.5 y 1.5) y saudi1 (solo 1.5).
  for (const league of ['holland2', 'saudi1']) for (let i = 0; i < 7; i++) for (const [h, a] of [['A', `x${i}`], [`y${i}`, 'B'], ['C', `z${i}`], [`w${i}`, 'D']]) {
    rows.push({ id: `fc-${league}-${i}-${h}-${a}`, league: { id: `fc-${league}`, name: league }, kickoff: new Date(now - (50 - i * 6) * DAY).toISOString(),
      home: { id: `${league}-${h}` }, away: { id: `${league}-${a}` }, status: 'FINISHED', homeGoals: 3, awayGoals: 2 });
  }
  const fx = (league, h, a) => ({ id: `fc-${league}-2026-11-16-${h}-${a}`, league: { id: `fc-${league}`, name: league },
    kickoff: new Date(now + 4 * 3_600_000).toISOString(), home: { id: `${league}-${h}`, name: h }, away: { id: `${league}-${a}`, name: a }, status: 'TIMED' });
  rows.push(fx('holland2', 'A', 'B'), fx('holland2', 'C', 'D'), fx('saudi1', 'A', 'B'), fx('saudi1', 'C', 'D'));
  let published;
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {}, getBatch: async () => null, usedMatches: async () => [],
    history: async () => [], fcMatches: async () => rows, publish: async b => { published = b; return b.id; } };
  const provider = { competitions: () => [], snapshot: async () => ({ ...full, fixtures: [], history: [] }) };
  await runJob('generate', { repo, provider, now, timeZone: 'America/Mazatlan', legs: 3, sameDay: true, ticketThresholds: [0.65],
    fc: { leagues: ['holland2', 'saudi1'] } });
  const sel = published.tickets.flatMap(t => t.selections);
  assert.ok(sel.length > 0);
  // saudi1 solo puede aparecer como over 1.5; nada de 2.5 de saudi1.
  assert.ok(sel.every(s => !(s.match.league.id === 'fc-saudi1' && s.market === 'OVER_2_5')));
  assert.ok(sel.some(s => s.match.league.id === 'fc-holland2' && s.market === 'OVER_2_5'));
  assert.ok(published.warnings.includes(FC_ATTRIBUTION));
});

test('settle liquida partidos de Football Charts con lo guardado', async () => {
  const applied = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'fc-holland2-2026-11-20-a-b', market: 'OVER_2_5' }],
    fcResults: async ids => ids.map(id => ({ matchId: id, id: 'fc-holland2-2026-11-21-a-b', status: 'FINISHED', homeGoals: 2, awayGoals: 1 })),
    applyResults: async r => applied.push(...r) };
  await runJob('settle', { repo, provider: { results: async () => [] }, now: Date.now() });
  assert.deepEqual(applied, [{ matchId: 'fc-holland2-2026-11-20-a-b', result: 'won', score: '2–1' }]);
});
test('storeFcMatches quita ids repetidos (queda el terminado) y el job no sigue sin catálogo', async () => {
  const { SupabaseRepository } = await import('../src/repository.js');
  const bodies = [];
  const repo = new SupabaseRepository({ url: 'https://x.supabase.co', secretKey: 'sb_secret_test', publishableKey: 'sb_publishable_test',
    fetcher: async (url, opts) => { if (opts.method === 'POST') bodies.push(JSON.parse(opts.body)); return new Response(''); } });
  const m = { id: 'fc-holland2-2026-11-20-a-b', league: { id: 'fc-holland2', name: 'X' }, kickoff: '2026-11-20T18:00:00.000Z',
    home: { id: 'fc-holland2-a', name: 'A' }, away: { id: 'fc-holland2-b', name: 'B' } };
  await repo.storeFcMatches([{ ...m, status: 'TIMED', homeGoals: null, awayGoals: null }, { ...m, status: 'FINISHED', homeGoals: 1, awayGoals: 0 }]);
  assert.equal(bodies[0].length, 1);
  assert.equal(bodies[0][0].status, 'FINISHED');
  const jobRepo = { acquireLock: async () => 'l', releaseLock: async () => {}, fcSyncTimes: async () => new Map() };
  const asked = [];
  await assert.rejects(runJob('fc', { repo: jobRepo, now: Date.now(), fc: { key: 'k', leagues: ['holland2'], get: async p => { asked.push(p); return { error: { code: 'daily_limit' } }; } } }), /catálogo/);
  assert.deepEqual(asked, ['/leagues/']); // no gastó consultas en ligas
});
