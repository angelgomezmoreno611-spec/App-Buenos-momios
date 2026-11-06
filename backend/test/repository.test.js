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
