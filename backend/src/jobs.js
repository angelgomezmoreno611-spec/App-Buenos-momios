import { generateBatch, dayKey, resultOf } from './tickets.js';
import { deliverNotifications } from './push.js';

const DAY = 86_400_000;
// Ligas de año natural (Brasileirão): la temporada AAAA se juega de abril a diciembre.
const CALENDAR_YEAR = new Set(['BSA']);
// Europa: la temporada empieza en julio/agosto y se nombra por su año de inicio
// (football-data usa ?season=AAAA). Devuelve la temporada anterior de la liga.
export function previousSeason(now = Date.now(), league = '') {
  const d = new Date(now), year = d.getUTCFullYear();
  if (CALENDAR_YEAR.has(league)) return year - 1;
  return (d.getUTCMonth() >= 6 ? year : year - 1) - 1;
}

export async function runJob(kind, { repo, provider, push, timeZone, minProbability, now = Date.now() }) {
  const owner = await repo.acquireLock();
  if (!owner) return { skipped: true, reason: 'Hay otra tarea ejecutándose o se está respetando el límite del proveedor' };
  const deadline = Date.now() + 45_000;
  try {
    if (kind === 'generate') {
      const day = dayKey(now, timeZone), existing = await repo.getBatch(day);
      if (existing) return { batchId: existing.id, existing: true };
      const excludedIds = await repo.usedMatches(now);
      const snapshot = await provider.snapshot(now);
      // Temporadas anteriores guardadas: misma ventana de 400 días que usa model.js.
      const stored = await repo.history(now - 400 * DAY, provider.competitions?.());
      const known = new Set(snapshot.history.map(m => m.id));
      snapshot.history = [...snapshot.history, ...stored.filter(m => !known.has(m.id))];
      const batch = generateBatch(snapshot, { now, timeZone, minProbability, excludedIds });
      const publishedId = await repo.publish(batch);
      return { batchId: publishedId, tickets: batch.tickets.length, missingMatches: batch.missingMatches };
    }
    if (kind === 'settle') {
      const pending = await repo.pendingMatches(now);
      const ids = [...new Set(pending.map(x => x.match_id))];
      // Hasta 9 consultas por ejecución, bajo la cuota gratuita de 10/min.
      const results = [];
      for (let i = 0; i < Math.min(ids.length, 450); i += 50) {
        if (Date.now() > deadline - 6000) break;
        const matches = await provider.results(ids.slice(i, i + 50));
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m) })));
      }
      if (results.length) await repo.applyResults(results);
      return { checked: results.length, remaining: Math.max(0, ids.length - results.length) };
    }
    if (kind === 'history') {
      const stored = new Set(await repo.storedSeasons());
      const pending = provider.competitions().map(code => ({ code, season: previousSeason(now, code) }))
        .filter(({ code, season }) => !stored.has(`${code}:${season}`));
      const loaded = [];
      // Una petición por liga; el lock deja 70 s entre tareas y la cuota es 10/min.
      for (const { code, season } of pending.slice(0, 8)) {
        if (Date.now() > deadline - 8000) break;
        const matches = await provider.season(code, season);
        await repo.storeHistory(code, season, matches);
        loaded.push({ league: code, season, matches: matches.length });
      }
      return { loaded, remaining: pending.length - loaded.length };
    }
    if (kind === 'notify') return deliverNotifications(repo, push, deadline);
    throw new Error('Tarea desconocida');
  } finally { await repo.releaseLock(owner); }
}
