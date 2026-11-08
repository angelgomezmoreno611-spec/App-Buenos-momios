import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { configuredApp } from '../src/config.js';
import { normalizeMatch, FootballData } from '../src/provider.js';
import { runJob, previousSeason } from '../src/jobs.js';
import { demoSnapshot } from '../src/demo.js';
import { deliverNotifications } from '../src/push.js';

async function request(app, path, { method = 'GET', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
  Object.assign(req, { url: path, method, headers });
  let payload;
  const res = { statusCode: 200, setHeader() {}, end(data) { payload = data ? JSON.parse(data) : null; } };
  await app(req, res);
  return { status: res.statusCode, body: payload };
}
test('demo es explícita, mantiene IDs y genera cuatro tickets', async () => {
  const app = createApp({ mode: 'demo' });
  const first = await request(app, '/api/tickets'), second = await request(app, '/api/tickets');
  assert.equal(first.status, 200);
  assert.equal(first.body.batch.mode, 'demo');
  assert.equal(first.body.batch.tickets.length, 4);
  assert.equal(first.body.batch.id, second.body.batch.id);
  assert.equal((await request(app, '/api/tickets', { method: 'POST' })).status, 405);
});
test('consulta de fútbol requiere sesión y la demo funciona sin proveedores externos', async () => {
  const live = createApp({ repo: { authenticate: async () => null } });
  assert.equal((await request(live, '/api/football/sources')).status, 401);
  assert.equal((await request(live, '/api/football/matches')).status, 401);
  assert.equal((await request(live, '/api/football/match?id=123')).status, 401);
  assert.equal((await request(live, '/api/football/matches', { method: 'POST' })).status, 405);
  const app = createApp({ mode: 'demo' });
  const sources = await request(app, '/api/football/sources');
  assert.equal(sources.body.sources[0].id, 'demo');
  const matches = await request(app, '/api/football/matches');
  assert.equal(matches.body.matches.length, 16);
  const detail = await request(app, `/api/football/match?id=${matches.body.matches[0].remoteId}`);
  assert.equal(detail.body.match.id, matches.body.matches[0].id);
});
test('datos reales y cron rechazan accesos no autenticados', async () => {
  const app = createApp({ mode: 'live', cronSecret: 'secret', repo: { authenticate: async () => null } });
  assert.equal((await request(app, '/api/tickets')).status, 401);
  assert.equal((await request(app, '/api/history')).status, 401);
  assert.equal((await request(app, '/api/history', { method: 'POST', body: {} })).status, 401);
  assert.equal((await request(app, '/api/jobs/generate')).status, 401);
  assert.equal((await request(app, '/api/jobs/generate', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.throws(() => configuredApp({}), /CRON_SECRET/);
});
test('API real admite claves nuevas y arranca sin proveedor de fútbol', async () => {
  const app = configuredApp({
    DATA_MODE: 'live', CRON_SECRET: 'x'.repeat(32),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test'
  });
  assert.deepEqual(await request(app, '/api/health'), { status: 200, body: { ok: true, mode: 'live' } });
  assert.equal((await request(app, '/api/jobs/generate')).status, 401);
  assert.throws(() => configuredApp({ DATA_MODE: 'live', CRON_SECRET: 'x'.repeat(32) }), /Supabase/);
});
test('configuración conserva nombres antiguos de claves', async () => {
  const app = configuredApp({
    DATA_MODE: 'live', CRON_SECRET: 'x'.repeat(32),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'legacy-anon-jwt', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-jwt'
  });
  assert.equal((await request(app, '/api/health')).status, 200);
});
test('guardar una tanda usa el usuario autenticado sin token ni suscripción de avisos', async () => {
  const calls = [];
  const batchId = 'caa25e21-0be8-43b5-8f2f-be26735ff824';
  const app = createApp({ repo: {
    authenticate: async () => ({ id: 'verified-user' }),
    saveBatch: async (...args) => { calls.push(args); return true; }
  } });
  const saved = await request(app, '/api/history', {
    method: 'POST', body: { batchId, userId: 'someone-else' }
  });
  assert.deepEqual(saved, { status: 200, body: { saved: true } });
  assert.deepEqual(calls, [['verified-user', batchId]]);
  assert.equal((await request(app, '/api/history', { method: 'POST', body: { batchId: 'invalid' } })).status, 400);
  assert.equal((await request(app, '/api/history', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request(app, '/api/history', { method: 'DELETE' })).status, 405);
});
test('guardar una tanda inexistente devuelve 404 y la demo usa historial local', async () => {
  const body = { batchId: 'caa25e21-0be8-43b5-8f2f-be26735ff824' };
  const app = createApp({ repo: { authenticate: async () => ({ id: 'user' }), saveBatch: async () => false } });
  assert.equal((await request(app, '/api/history', { method: 'POST', body })).status, 404);
  assert.equal((await request(createApp({ mode: 'demo' }), '/api/history', { method: 'POST', body })).status, 409);
});
test('el historial consulta tandas guardadas del usuario y conserva resultados actualizados', async () => {
  const paths = [];
  const batch = { id: 'saved', day: '2026-11-05', tickets: [{ status: 'won' }] };
  const app = createApp({ repo: {
    authenticate: async () => ({ id: 'verified-user' }),
    request: async path => { paths.push(path); return [{ batches: { day: batch.day } }, { batches: null }]; },
    getBatch: async day => { assert.equal(day, batch.day); return batch; }
  } });
  const history = await request(app, '/api/history');
  assert.deepEqual(history, { status: 200, body: { batches: [batch] } });
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^saved_batches\?user_id=eq\.verified-user&/);
  assert.match(paths[0], /limit=14$/);
});
test('registro no acepta userId del body y valida batch, token y JSON', async () => {
  let captured;
  const app = createApp({ repo: { authenticate: async () => ({ id: 'verified-user' }), subscribe: async (...args) => { captured = args; } } });
  const valid = { batchId: 'caa25e21-0be8-43b5-8f2f-be26735ff824', token: 'valid-device-token-123456789', platform: 'android', userId: 'someone-else' };
  assert.equal((await request(app, '/api/subscriptions', { method: 'POST', body: valid })).status, 200);
  assert.equal(captured[0], 'verified-user');
  assert.equal((await request(app, '/api/subscriptions', { method: 'POST', body: { ...valid, batchId: 'invalid' } })).status, 400);
  assert.equal((await request(app, '/api/subscriptions', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request(app, '/api/subscriptions', { method: 'POST', body: 'a'.repeat(9000) })).status, 413);
});
test('proveedor conserva goles nulos, excluye prórroga y respeta 9 ligas', async () => {
  const row = { id: 1, competition: { code: 'PL', name: 'Premier' }, homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' }, utcDate: '2026-11-05T12:00:00Z', status: 'FINISHED', score: { duration: 'REGULAR', fullTime: { home: 2, away: null } } };
  assert.equal(normalizeMatch(row).awayGoals, null);
  assert.equal(normalizeMatch({ ...row, score: { ...row.score, duration: 'EXTRA_TIME' } }).status, 'UNKNOWN');
  assert.throws(() => new FootballData({ token: 'x', competitions: 'CL' }));
  assert.throws(() => new FootballData({ token: 'x', competitions: 'PL,PD,BL1,SA,FL1,DED,PPL,ELC,BSA,PL2' }));
  assert.equal(new FootballData({ token: 'x' }).competitions.length, 9);
  const provider = new FootballData({ token: 'private', competitions: 'PL', fetcher: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(provider.snapshot(), /429/);
  await assert.rejects(provider.results(['bogus']), /inválido/);
});
test('jobs evitan repetir generación y liberan lock tras errores', async () => {
  let released = false;
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => { released = true; }, getBatch: async () => ({ id: 'existing' }) };
  const result = await runJob('generate', { repo });
  assert.equal(result.existing, true); assert.equal(released, true);
  released = false;
  repo.getBatch = async () => { throw new Error('database down'); };
  await assert.rejects(runJob('generate', { repo }), /database down/);
  assert.equal(released, true);
  assert.equal((await runJob('settle', { repo: { acquireLock: async () => null } })).skipped, true);
});
test('avisos reintentan fallos y no se envían a tokens de otro usuario', async () => {
  const finished = [], sent = [];
  const repo = {
    claimNotifications: async () => [{ id: 'a', lease: 'l1', attempts: 1, user_id: 'u', token: 'mine' }, { id: 'b', lease: 'l2', attempts: 1, user_id: 'u', token: 'other' }],
    ownsDevice: async (_, token) => token === 'mine',
    finishNotification: async (...args) => finished.push(args)
  };
  const push = { configured: true, send: async e => { sent.push(e); throw new Error('network'); } };
  assert.equal((await deliverNotifications(repo, push)).failed, 1);
  assert.equal(sent.length, 1);
  assert.equal(finished[0][2], 'pending');
  assert.equal(finished[1][2], 'invalid');
});

test('history guarda solo temporadas anteriores pendientes', async () => {
  assert.equal(previousSeason(Date.parse('2026-11-07T12:00:00Z')), 2025);
  assert.equal(previousSeason(Date.parse('2027-03-01T12:00:00Z')), 2025);
  assert.equal(previousSeason(Date.parse('2027-07-15T12:00:00Z')), 2026);
  // Brasileirão: temporada de año natural.
  assert.equal(previousSeason(Date.parse('2026-11-07T12:00:00Z'), 'BSA'), 2025);
  assert.equal(previousSeason(Date.parse('2027-03-01T12:00:00Z'), 'BSA'), 2026);
  const stored = [], requested = [];
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {},
    storedSeasons: async () => ['PL:2025'], storeHistory: async (...args) => { stored.push(args); } };
  const provider = { competitions: () => ['PL', 'PD', 'BSA'],
    season: async (code, year) => { requested.push(`${code}:${year}`); return [{ id: 'fd-1' }, { id: 'fd-2' }]; } };
  const result = await runJob('history', { repo, provider, now: Date.parse('2027-03-01T12:00:00Z') });
  assert.deepEqual(requested, ['PD:2025', 'BSA:2026']);
  assert.deepEqual(result, { loaded: [{ league: 'PD', season: 2025, matches: 2 }, { league: 'BSA', season: 2026, matches: 2 }], remaining: 0 });
  assert.equal(stored[0][0], 'PD');
});
test('generate combina el histórico guardado con la temporada actual', async () => {
  const now = Date.parse('2026-11-05T17:00:00Z'), full = demoSnapshot(now);
  let published, asked;
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {}, getBatch: async () => null,
    usedMatches: async () => [], publish: async batch => { published = batch; return batch.id; },
    history: async (since, leagues) => { asked = { since, leagues }; return full.history; } };
  // El proveedor solo trae partidos por jugar: sin el histórico no habría tickets.
  const provider = { competitions: () => ['DEMO'], snapshot: async () => ({ ...full, history: [] }) };
  const result = await runJob('generate', { repo, provider, now, minProbability: 0.65 });
  assert.equal(result.tickets, 4);
  assert.equal(published.tickets.length, 4);
  assert.equal(asked.since, now - 400 * 86_400_000);
  assert.deepEqual(asked.leagues, ['DEMO']);
});
test('proveedor descarga una temporada y conserva solo partidos terminados', async () => {
  let url;
  const row = (id, status, home) => ({ id, competition: { code: 'PL', name: 'Premier' }, homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' },
    utcDate: '2025-09-01T12:00:00Z', status, score: { duration: 'REGULAR', fullTime: { home, away: 1 } } });
  const provider = new FootballData({ token: 'private', competitions: 'PL',
    fetcher: async u => { url = u; return Response.json({ matches: [row(1, 'FINISHED', 2), row(2, 'POSTPONED', null), row(3, 'FINISHED', null)] }); } });
  const rows = await provider.season('PL', 2025);
  assert.match(url, /competitions\/PL\/matches\?season=2025$/);
  assert.deepEqual(rows.map(r => r.id), ['fd-1']);
  await assert.rejects(provider.season('PD', 2025), /inválida/);
});
test('una liga sin partidos publicados no detiene la generación', async () => {
  const row = { id: 7, competition: { code: 'PL', name: 'Premier' }, homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' },
    utcDate: '2026-11-09T12:00:00Z', status: 'TIMED', score: { duration: 'REGULAR', fullTime: {} } };
  const provider = new FootballData({ token: 'private', competitions: 'PL,BSA',
    fetcher: async u => Response.json({ matches: u.includes('/BSA/') ? [] : [row] }) });
  const snapshot = await provider.snapshot();
  assert.deepEqual(snapshot.fixtures.map(m => m.id), ['fd-7']);
  assert.match(snapshot.warnings.at(-1), /BSA/);
  const none = new FootballData({ token: 'private', competitions: 'BSA', fetcher: async () => Response.json({ matches: [] }) });
  await assert.rejects(none.snapshot(), /Ninguna liga/);
});
test('job csv respeta dos descargas por semana y registra antes de descargar', async () => {
  const calls = [];
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {},
    csvSyncsSince: async since => { calls.push(['since', since]); return calls.filter(c => c[0] === 'record').length; },
    recordCsvSync: async () => { calls.push(['record']); },
    storeCsvMatches: async (rows, before) => { calls.push(['store', rows.length, before]); } };
  const now = Date.parse('2026-11-10T12:27:00Z');
  const csvSync = async (codes, opts) => { calls.push(['download', codes, opts.now]); return { fixtures: [{ id: 'f' }], results: [{ id: 'r' }], files: 3 }; };
  assert.deepEqual(await runJob('csv', { repo, now, csvLeagues: ['NOR'], csvSync }), { files: 3, results: 1, fixtures: 1 });
  assert.deepEqual(calls.map(c => c[0]), ['since', 'record', 'download', 'store']);
  assert.equal(calls[0][1], now - 7 * 86_400_000);
  await runJob('csv', { repo, now, csvLeagues: ['NOR'], csvSync });
  const third = await runJob('csv', { repo, now, csvLeagues: ['NOR'], csvSync });
  assert.equal(third.skipped, true);
  assert.equal(calls.filter(c => c[0] === 'download').length, 2);
  assert.equal((await runJob('csv', { repo, now, csvLeagues: [], csvSync })).skipped, true);
});
test('generate usa partidos CSV guardados y settle los liquida sin consultas externas', async () => {
  const now = Date.parse('2026-11-05T17:00:00Z'), full = demoSnapshot(now);
  const relabel = m => ({ ...m, id: `fdu-NOR-${m.id}`, league: { id: 'NOR', name: 'Eliteserien' } });
  const csvRows = [...full.history, ...full.fixtures.map(m => ({ ...m, status: 'TIMED' }))].map(relabel);
  let published;
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {}, getBatch: async () => null,
    usedMatches: async () => [], publish: async batch => { published = batch; return batch.id; },
    history: async () => [], csvMatches: async () => csvRows };
  const provider = { competitions: () => ['PL'], snapshot: async () => ({ ...full, history: [], fixtures: [] }) };
  const result = await runJob('generate', { repo, provider, now, minProbability: 0.65, csvLeagues: ['NOR'] });
  assert.equal(result.tickets, 4);
  assert.ok(published.tickets.every(t => t.selections.every(s => s.match.id.startsWith('fdu-NOR-'))));
  assert.ok(published.warnings.some(w => /football-data\.co\.uk/.test(w)));
  assert.ok(published.warnings.some(w => /Eliteserien 76% \(157\)/.test(w)));
  // Sin la tabla CSV (migración pendiente) se genera igual con las demás ligas.
  repo.csvMatches = async () => { throw new Error('HTTP 404'); };
  provider.snapshot = async () => ({ ...full, history: [] });
  repo.history = async () => full.history;
  const fallback = await runJob('generate', { repo, provider, now, minProbability: 0.65, csvLeagues: ['NOR'] });
  assert.equal(fallback.tickets, 4);
  assert.ok(published.warnings.includes('Ligas CSV no disponibles en esta tanda.'));
  const applied = [], asked = [];
  const settleRepo = { acquireLock: async () => 'lease', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'fdu-NOR-x' }, { match_id: 'fdu-NOR-y' }],
    csvResults: async ids => { asked.push(...ids); return [{ id: 'fdu-NOR-x', status: 'FINISHED', homeGoals: 2, awayGoals: 1 }]; },
    applyResults: async r => applied.push(...r) };
  const settled = await runJob('settle', { repo: settleRepo, provider: { results: async () => { throw new Error('no debe consultar'); } }, now });
  assert.deepEqual(asked, ['fdu-NOR-x', 'fdu-NOR-y']);
  assert.deepEqual(applied, [{ matchId: 'fdu-NOR-x', result: 'won', score: '2–1' }]);
  assert.deepEqual(settled, { checked: 1, remaining: 1 });
});
test('settle aplica el mercado de cada selección (over 1.5 con 1-1 gana)', async () => {
  const applied = [];
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'fdu-NOR-a', market: 'OVER_1_5' }, { match_id: 'fdu-NOR-b', market: 'OVER_2_5' }],
    csvResults: async () => [{ id: 'fdu-NOR-a', status: 'FINISHED', homeGoals: 1, awayGoals: 1 }, { id: 'fdu-NOR-b', status: 'FINISHED', homeGoals: 1, awayGoals: 1 }],
    applyResults: async r => applied.push(...r) };
  await runJob('settle', { repo, provider: {}, now: Date.now() });
  assert.deepEqual(applied.map(r => [r.matchId, r.result]), [['fdu-NOR-a', 'won'], ['fdu-NOR-b', 'lost']]);
});
test('generate suma la 3. Liga con atribución y settle la liquida en over 1.5', async () => {
  const now = Date.parse('2026-11-05T17:00:00Z'), full = demoSnapshot(now);
  // Partidos demo con forma de respuesta de OpenLigaDB.
  const asOldb = (m, i) => ({ matchID: 1000 + i, leagueShortcut: 'bl3', matchDateTimeUTC: m.kickoff, matchIsFinished: m.status === 'FINISHED',
    team1: { teamId: Number(m.home.id.replace(/\D/g, '')) || 1, teamName: m.home.name },
    team2: { teamId: Number(m.away.id.replace(/\D/g, '')) || 2, teamName: m.away.name },
    matchResults: m.status === 'FINISHED' ? [{ resultTypeID: 2, pointsTeam1: m.homeGoals, pointsTeam2: m.awayGoals }] : [] });
  const season = [...full.history, ...full.fixtures].map(asOldb);
  let published;
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {}, getBatch: async () => null,
    usedMatches: async () => [], publish: async batch => { published = batch; return batch.id; }, history: async () => [] };
  const provider = { competitions: () => ['PL'], snapshot: async () => ({ ...full, history: [], fixtures: [] }) };
  const openLiga = { leagues: ['BL3'], get: async url => url.endsWith('/2026') ? season : [] };
  const result = await runJob('generate', { repo, provider, now, minProbability: 0.5, market: 'OVER_1_5', legs: 6, openLiga });
  assert.ok(result.tickets >= 1);
  assert.ok(published.tickets.every(t => t.selections.every(s => s.match.id.startsWith('oldb-') && s.market === 'OVER_1_5')));
  assert.ok(published.warnings.includes('Datos de 3. Liga: OpenLigaDB (licencia ODbL).'));
  openLiga.get = async () => { throw new Error('caída'); };
  await runJob('generate', { repo, provider, now, minProbability: 0.5, market: 'OVER_1_5', legs: 6, openLiga });
  assert.ok(published.warnings.includes('OpenLigaDB no disponible en esta tanda.'));
  const applied = [];
  const settleRepo = { acquireLock: async () => 'lease', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'oldb-7', market: 'OVER_1_5' }], applyResults: async r => applied.push(...r) };
  const get = async () => ({ matchID: 7, leagueShortcut: 'bl3', matchDateTimeUTC: '2026-11-01T13:00:00Z', matchIsFinished: true,
    team1: { teamId: 1, teamName: 'A' }, team2: { teamId: 2, teamName: 'B' }, matchResults: [{ resultTypeID: 2, pointsTeam1: 1, pointsTeam2: 1 }] });
  await runJob('settle', { repo: settleRepo, provider: {}, now, openLiga: { leagues: ['BL3'], get } });
  assert.deepEqual(applied, [{ matchId: 'oldb-7', result: 'won', score: '1–1' }]);
});
test('si la base rechaza el ticket arriesgado, la tanda se publica sin él', async () => {
  const now = Date.parse('2026-11-05T17:00:00Z'), full = demoSnapshot(now);
  const attempts = [];
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {}, getBatch: async () => null, usedMatches: async () => [],
    history: async () => full.history,
    publish: async batch => { attempts.push(batch.tickets.map(t => t.kind ?? 'regular')); if (batch.tickets.some(t => t.kind === 'risky')) throw new Error('Base de datos: HTTP 400'); return batch.id; } };
  const provider = { competitions: () => ['DEMO'], snapshot: async () => ({ ...full, history: [] }) };
  const result = await runJob('generate', { repo, provider, now, minProbability: 0.95, market: 'OVER_1_5', legs: 6, risky: true });
  assert.deepEqual(attempts, [['risky'], []]);
  assert.equal(result.risky, false);
});
test('settle liquida partidos de API-Football con lo guardado por discover', async () => {
  const applied = [];
  const repo = { acquireLock: async () => 'lease', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'af-1', market: 'OVER_1_5' }, { match_id: 'af-2', market: 'OVER_1_5' }],
    afResults: async ids => [{ id: 'af-1', status: 'FINISHED', homeGoals: 1, awayGoals: 0 }, { id: 'af-2', status: 'UNKNOWN', homeGoals: null, awayGoals: null }].filter(m => ids.includes(m.id)),
    applyResults: async r => applied.push(...r) };
  await runJob('settle', { repo, provider: {}, now: Date.now() });
  assert.deepEqual(applied.map(r => [r.matchId, r.result]), [['af-1', 'lost'], ['af-2', 'review']]);
});
