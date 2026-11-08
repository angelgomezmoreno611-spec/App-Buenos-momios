import { timingSafeEqual } from 'node:crypto';
import { demoBatch } from './demo.js';
import { dayKey } from './tickets.js';
import { runJob } from './jobs.js';
import { FootballService } from './football/service.js';

const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
function secretEquals(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 8192) throw Object.assign(new Error('Petición demasiado grande'), { status: 413 });
    return req.body;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('Petición demasiado grande'), { status: 413 });
  }
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}

export function createApp({ mode = 'live', repo, provider, push, cronSecret, timeZone = 'America/Mazatlan', minProbability = 0.65, allowedOrigin, footballService, csvLeagues = [], market = 'OVER_2_5', legs = 4, evidence = null, openLiga = null }) {
  if (!['live', 'demo'].includes(mode)) throw new Error('DATA_MODE debe ser live o demo');
  let demo;
  const send = (res, status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    if (allowedOrigin && req.headers.origin === allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    const parsedUrl = new URL(req.url, 'http://localhost'), path = parsedUrl.pathname;
    try {
      if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, mode });
      if (path.startsWith('/api/jobs/')) {
        if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Método no permitido' });
        if (!secretEquals(req.headers.authorization, cronSecret ? `Bearer ${cronSecret}` : '')) return send(res, 401, { error: 'No autorizado' });
        const kind = path.split('/').at(-1);
        if (!['generate', 'settle', 'notify', 'history', 'csv'].includes(kind)) return send(res, 404, { error: 'Tarea desconocida' });
        if (mode === 'demo') return send(res, 409, { error: 'Las tareas reales están desactivadas en demo' });
        return send(res, 200, await runJob(kind, { repo, provider, push, timeZone, minProbability, csvLeagues, market, legs, evidence, openLiga }));
      }
      const footballRoute = ['/api/football/sources', '/api/football/matches', '/api/football/match'].includes(path);
      if (!footballRoute && !['/api/tickets', '/api/history', '/api/subscriptions', '/api/devices'].includes(path)) return send(res, 404, { error: 'Ruta no encontrada' });
      const methods = { '/api/tickets': ['GET'], '/api/history': ['GET', 'POST'], '/api/subscriptions': ['POST'], '/api/devices': ['DELETE'] };
      if (!(footballRoute ? ['GET'] : methods[path]).includes(req.method)) return send(res, 405, { error: 'Método no permitido' });
      const user = mode === 'demo' ? { id: 'demo' } : await repo.authenticate(req.headers.authorization);
      if (!user) return send(res, 401, { error: 'Inicia sesión para consultar tus tickets' });
      if (footballRoute) {
        if (!footballService && mode === 'demo') footballService = new FootballService({ mode });
        if (!footballService) return send(res, 503, { error: 'La consulta de fútbol no está configurada.' });
        const options = Object.fromEntries(['provider', 'competition', 'season', 'date', 'id']
          .filter(key => parsedUrl.searchParams.has(key)).map(key => [key, parsedUrl.searchParams.get(key)]));
        if (path.endsWith('/sources')) return send(res, 200, footballService.sources());
        return send(res, 200, await (path.endsWith('/matches') ? footballService.matches(options) : footballService.detail(options)));
      }
      if (path === '/api/tickets') {
        let batch;
        if (mode === 'demo') {
          if (!demo || demo.day !== dayKey()) demo = demoBatch();
          batch = demo;
        } else batch = await repo.getBatch(dayKey(Date.now(), timeZone));
        return send(res, 200, { batch, message: batch ? null : 'Todavía no se ha publicado el análisis de hoy.' });
      }
      if (path === '/api/history' && req.method === 'GET') {
        if (mode === 'demo') return send(res, 200, { batches: [] });
        const saved = await repo.request(`saved_batches?user_id=eq.${user.id}&select=batch_id,batches(day)&order=created_at.desc&limit=14`);
        const batches = [];
        for (const s of saved) {
          if (s.batches?.day) batches.push(await repo.getBatch(s.batches.day));
        }
        return send(res, 200, { batches: batches.filter(Boolean) });
      }
      if (path === '/api/history') {
        if (mode === 'demo') return send(res, 409, { error: 'El historial demo se guarda en este dispositivo.' });
        const body = await readJson(req);
        if (!uuid(body?.batchId)) return send(res, 400, { error: 'Lote inválido' });
        if (!await repo.saveBatch(user.id, body.batchId)) return send(res, 404, { error: 'Tanda no encontrada' });
        return send(res, 200, { saved: true });
      }
      if (mode === 'demo') return send(res, 409, { error: 'Las notificaciones necesitan Supabase y Firebase configurados' });
      const body = await readJson(req);
      if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096 || !/^[\w:.-]+$/.test(body.token)) return send(res, 400, { error: 'Token de dispositivo inválido' });
      if (path === '/api/devices') {
        await repo.removeDevice(user.id, body.token); return send(res, 200, { removed: true });
      }
      if (!uuid(body.batchId) || !['android', 'ios'].includes(body.platform)) return send(res, 400, { error: 'Lote o plataforma inválidos' });
      await repo.subscribe(user.id, body.batchId, body.token, body.platform);
      return send(res, 200, { subscribed: true });
    } catch (error) {
      const status = error.status ?? 500;
      // Nunca enviamos credenciales ni respuestas completas de proveedores al cliente.
      if (status >= 500) console.error('request_failed', { path, message: error.message });
      return send(res, status, { error: error.publicMessage ?? (status >= 500 ? 'No se pudo completar la consulta. Inténtalo más tarde.' : error.message) });
    }
  };
}
