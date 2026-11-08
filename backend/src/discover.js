import { afGet, normalizeAfFixture, isLeagueGame, featuresFromPrediction, pickForAnalysis, AF_DAILY_BUDGET } from './apifootball.js';

const DAY = 86_400_000;
const utcDay = (t, offset = 0) => new Date(t + offset * DAY).toISOString().slice(0, 10);

// Un paso del descubrimiento. Se llama varias veces antes de generar (cron cada
// 5 min): cada ejecución hace como mucho `perRun` consultas separadas por
// `spacingMs` (límite gratuito de 10/minuto) y termina antes del límite de Vercel.
// Orden: 1) listas de ayer (resultados), hoy y mañana; 2) análisis de partidos.
export async function runDiscover({ repo, key, fetcher, now = Date.now(), perRun = 6, spacingMs = 6500, sleep, budget = AF_DAILY_BUDGET }) {
  if (!key) return { skipped: true, reason: 'Falta API_FOOTBALL_KEY' };
  const wait = sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const day = utcDay(now), usage = await repo.afUsage(day);
  let calls = 0;
  const lists = [...usage.lists], done = { lists: [], analyzed: 0, stored: 0 };
  const spend = async path => {
    if (calls) await wait(spacingMs);
    calls++;
    await repo.setAfUsage(day, usage.calls + calls, lists); // se registra antes de consultar
    return afGet(path, key, fetcher);
  };
  // 1) Listas del día (el plan gratuito solo permite de ayer a mañana).
  for (const date of [utcDay(now, -1), day, utcDay(now, 1)]) {
    if (lists.includes(date) || calls >= perRun || usage.calls + calls >= budget) continue;
    const data = await spend(`/fixtures?date=${date}`);
    const matches = (data.response ?? []).map(normalizeAfFixture).filter(m => m && isLeagueGame(m));
    await repo.storeAfMatches(matches, now - 400 * DAY);
    lists.push(date); done.lists.push(date); done.stored += matches.length;
    await repo.setAfUsage(day, usage.calls + calls, lists);
  }
  // 2) Análisis de forma reciente, priorizando ligas con más goles observados.
  const free = Math.min(perRun - calls, budget - usage.calls - calls);
  if (free > 0) {
    const pending = await repo.afUpcoming(now, Date.parse(`${utcDay(now, 1)}T23:59:59Z`), { analyzed: false });
    const rates = await repo.afLeagueRates().catch(() => new Map());
    // Ligas sin datos acumulados cuentan como 0.75 (promedio típico de over 1.5).
    const score = m => { const r = rates.get(m.league.afId); return r && r.matches >= 10 ? r.over15 : 0.75; };
    for (const m of pickForAnalysis(pending, { now, until: Infinity, limit: free, priority: score })) {
      const data = await spend(`/predictions?fixture=${m.id.slice(3)}`);
      await repo.saveAfFeatures(m.id, featuresFromPrediction(data));
      done.analyzed++;
    }
  }
  await repo.setAfUsage(day, usage.calls + calls, lists);
  return { day, calls, totalCalls: usage.calls + calls, ...done };
}
