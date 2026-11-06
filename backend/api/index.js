import { configuredApp } from '../src/config.js';
let app;

// Solo nombres de variables; nunca valores ni mensajes que puedan contenerlos.
function configProblems(env = process.env) {
  if ((env.DATA_MODE ?? 'live') === 'demo') return [];
  const problems = [];
  if (!env.SUPABASE_URL?.trim()) problems.push('SUPABASE_URL');
  if (!(env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim()) problems.push('SUPABASE_PUBLISHABLE_KEY');
  if (!(env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim()) problems.push('SUPABASE_SECRET_KEY');
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) problems.push('CRON_SECRET (mínimo 32 caracteres)');
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try { JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { problems.push('FIREBASE_SERVICE_ACCOUNT_JSON (JSON inválido)'); }
  }
  return problems;
}

export default async function handler(req, res) {
  try { app ??= configuredApp(); }
  catch {
    const problems = configProblems();
    console.error('Configuración inválida:', problems.join(', ') || 'causa no identificada');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Configura las variables del servidor antes de usar datos reales.', revisar: problems }));
    return;
  }
  return app(req, res);
}
