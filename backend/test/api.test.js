import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { configuredApp } from '../src/config.js';
import { normalizeMatch, FootballData } from '../src/provider.js';
import { runJob } from '../src/jobs.js';
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
test('proveedor conserva goles nulos, excluye prórroga y respeta 8 ligas', async () => {
  const row = { id: 1, competition: { code: 'PL', name: 'Premier' }, homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' }, utcDate: '2026-11-05T12:00:00Z', status: 'FINISHED', score: { duration: 'REGULAR', fullTime: { home: 2, away: null } } };
  assert.equal(normalizeMatch(row).awayGoals, null);
  assert.equal(normalizeMatch({ ...row, score: { ...row.score, duration: 'EXTRA_TIME' } }).status, 'UNKNOWN');
  assert.throws(() => new FootballData({ token: 'x', competitions: 'CL' }));
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
