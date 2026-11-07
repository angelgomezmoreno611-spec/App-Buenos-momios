import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRepository } from '../src/repository.js';

test('clave secret nueva viaja como apikey y no como JWT', async () => {
  let captured;
  const repo = new SupabaseRepository({
    url: 'https://example.supabase.co/', secretKey: 'sb_secret_test', publishableKey: 'sb_publishable_test',
    fetcher: async (url, options) => { captured = { url, ...options }; return new Response('[]'); }
  });
  await repo.request('batches?select=id&limit=0');
  assert.equal(captured.url, 'https://example.supabase.co/rest/v1/batches?select=id&limit=0');
  const headers = new Headers(captured.headers);
  assert.equal(headers.get('apikey'), 'sb_secret_test');
  assert.equal(headers.has('authorization'), false);
});

test('clave service_role antigua conserva autenticación Bearer', async () => {
  let captured;
  const repo = new SupabaseRepository({
    url: 'https://example.supabase.co', serviceKey: 'legacy-service-jwt', anonKey: 'legacy-anon-jwt',
    fetcher: async (_, options) => { captured = new Headers(options.headers); return new Response('[]'); }
  });
  await repo.request('batches?limit=0');
  assert.equal(captured.get('apikey'), 'legacy-service-jwt');
  assert.equal(captured.get('authorization'), 'Bearer legacy-service-jwt');
});

test('Auth verifica el JWT del usuario con la clave pública', async () => {
  const calls = [];
  const repo = new SupabaseRepository({
    url: 'https://example.supabase.co', secretKey: 'sb_secret_test', publishableKey: 'sb_publishable_test',
    fetcher: async (url, options) => {
      calls.push({ url, headers: new Headers(options.headers) });
      return Response.json({ id: 'verified-user' });
    }
  });
  assert.equal(await repo.authenticate(undefined), null);
  assert.deepEqual(await repo.authenticate('Bearer user-session-jwt'), { id: 'verified-user' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.co/auth/v1/user');
  assert.equal(calls[0].headers.get('apikey'), 'sb_publishable_test');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer user-session-jwt');
});

test('fallos de Supabase no incluyen claves ni respuestas privadas', async () => {
  const repo = new SupabaseRepository({
    url: 'https://example.supabase.co', secretKey: 'sb_secret_test', publishableKey: 'sb_publishable_test',
    fetcher: async () => new Response('contenido privado', { status: 401 })
  });
  await assert.rejects(repo.request('batches'), error => {
    assert.equal(error.upstreamStatus, 401);
    assert.equal(error.message, 'Base de datos: HTTP 401');
    return true;
  });
});

test('histórico: guarda por bloques, marca la temporada al final y pagina la lectura', async () => {
  const calls = [];
  const page = n => Array.from({ length: n }, (_, i) => ({ id: `fd-${i}`, league: 'PL', league_name: 'Premier',
    kickoff: '2025-09-01T12:00:00+00:00', home_id: 'fd-team-1', home_name: 'A', away_id: 'fd-team-2', away_name: 'B',
    home_goals: 2, away_goals: 1, available_at: '2026-11-07T12:00:00+00:00' }));
  const repo = new SupabaseRepository({
    url: 'https://example.supabase.co', secretKey: 'sb_secret_test', publishableKey: 'sb_publishable_test',
    fetcher: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body), prefer: new Headers(options.headers).get('prefer') });
      if (options.method === 'GET') return Response.json(url.includes('offset=0') ? page(1000) : page(5));
      return new Response('');
    }
  });
  const match = { id: 'fd-9', league: { id: 'PL', name: 'Premier' }, kickoff: '2025-09-01T12:00:00.000Z', home: { id: 'fd-team-1', name: 'A' },
    away: { id: 'fd-team-2', name: 'B' }, homeGoals: 2, awayGoals: 1, availableAt: '2026-11-07T12:00:00.000Z' };
  await repo.storeHistory('PL', 2025, Array(1200).fill(match));
  assert.deepEqual(calls.map(c => c.body.length), [500, 500, 200, 1]);
  assert.match(calls.at(-1).url, /history_seasons\?on_conflict=league,season$/);
  assert.deepEqual(calls.at(-1).body, [{ league: 'PL', season: 2025, matches: 1200 }]);
  assert.ok(calls.every(c => c.prefer === 'resolution=merge-duplicates,return=minimal'));
  calls.length = 0;
  const rows = await repo.history(Date.parse('2025-10-01T00:00:00Z'), ['PL', 'PD']);
  assert.equal(rows.length, 1005);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /kickoff=gte\.2025-10-01T00%3A00%3A00\.000Z&league=in\.\(PL,PD\)/);
  assert.deepEqual(rows[0], { id: 'fd-0', league: { id: 'PL', name: 'Premier' }, kickoff: '2025-09-01T12:00:00.000Z', status: 'FINISHED',
    home: { id: 'fd-team-1', name: 'A' }, away: { id: 'fd-team-2', name: 'B' }, homeGoals: 2, awayGoals: 1, availableAt: '2026-11-07T12:00:00.000Z' });
});
