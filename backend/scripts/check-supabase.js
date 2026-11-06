import { SupabaseRepository } from '../src/repository.js';

// Solo consultas sin filas: nunca crea usuarios, tablas, tickets ni suscripciones.
// No imprimir valores de entorno, cabeceras ni cuerpos de respuestas privadas.
async function check() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const repo = new SupabaseRepository({ url, secretKey, publishableKey });
  const auth = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: publishableKey }, signal: AbortSignal.timeout(8000)
  });
  const report = { auth: { ok: auth.ok, status: auth.status } };
  await auth.body?.cancel();

  const jwksUrl = process.env.SUPABASE_JWKS_URL?.trim() || `${url}/auth/v1/.well-known/jwks.json`;
  if (new URL(jwksUrl).origin !== new URL(url).origin) throw new Error('JWKS debe pertenecer al mismo proyecto Supabase');
  const jwks = await fetch(jwksUrl, { signal: AbortSignal.timeout(8000) });
  const keys = jwks.ok ? await jwks.json() : null;
  if (!jwks.ok) await jwks.body?.cancel();
  report.jwks = { ok: jwks.ok, status: jwks.status, publicKeys: Array.isArray(keys?.keys) ? keys.keys.length : 0 };

  report.tables = [];
  for (const [table, column] of Object.entries({
    batches: 'id', tickets: 'id', selections: 'match_id', batch_subscriptions: 'batch_id',
    devices: 'token', notification_outbox: 'id', job_lock: 'singleton', saved_batches: 'batch_id'
  })) {
    try {
      await repo.request(`${table}?select=${column}&limit=0`);
      report.tables.push({ table, ok: true });
    } catch (error) {
      if (!error.upstreamStatus) throw error;
      report.tables.push({ table, ok: false, status: error.upstreamStatus });
      if ([401, 403].includes(error.upstreamStatus)) break;
    }
  }
  report.ready = report.auth.ok && report.jwks.ok && report.tables.length === 8 && report.tables.every(table => table.ok);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}

try { await check(); }
catch (error) {
  console.error('No se pudo comprobar Supabase.', error.cause?.code ?? error.code ?? error.message);
  process.exitCode = 1;
}
