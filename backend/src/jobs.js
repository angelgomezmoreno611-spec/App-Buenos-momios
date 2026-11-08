import { generateBatch, dayKey, resultOf } from './tickets.js';
import { deliverNotifications } from './push.js';
import { syncCsv, CSV_LEAGUES, CSV_VALIDATION } from './csvleagues.js';

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

export async function runJob(kind, { repo, provider, push, timeZone, minProbability, csvLeagues, csvSync, now = Date.now() }) {
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
      // Ligas CSV: solo lo guardado por el job csv (sin descargar aquí).
      if (csvLeagues?.length) {
        // Si la tabla no existe o falla, se genera con las demás ligas.
        const csv = await repo.csvMatches(now - 400 * DAY).catch(() => null);
        if (!csv) snapshot.warnings = [...(snapshot.warnings ?? []), 'Ligas CSV no disponibles en esta tanda.'];
        snapshot.history.push(...(csv ?? []).filter(m => m.status === 'FINISHED' && Date.parse(m.availableAt) <= now));
        const fixtures = (csv ?? []).filter(m => m.status === 'TIMED' && csvLeagues.includes(m.league.id));
        snapshot.fixtures = [...snapshot.fixtures, ...fixtures];
        if (fixtures.length) {
          const measured = [...new Set(fixtures.map(m => m.league.id))].filter(c => CSV_VALIDATION[c])
            .map(c => `${CSV_LEAGUES[c].name} ${Math.round(CSV_VALIDATION[c].hitRate * 100)}% (${CSV_VALIDATION[c].picks})`);
          snapshot.warnings = [...(snapshot.warnings ?? []),
            'Ligas de football-data.co.uk: datos actualizados dos veces por semana; sus resultados se liquidan con días de retraso.',
            ...(measured.length ? [`Acierto medido por partido en 2022-2026 con umbral 0.65 (selecciones): ${measured.join(', ')}.`] : [])];
        }
      }
      const batch = generateBatch(snapshot, { now, timeZone, minProbability, excludedIds });
      const publishedId = await repo.publish(batch);
      return { batchId: publishedId, tickets: batch.tickets.length, missingMatches: batch.missingMatches };
    }
    if (kind === 'settle') {
      const pending = await repo.pendingMatches(now);
      const all = [...new Set(pending.map(x => x.match_id))];
      const ids = all.filter(id => id.startsWith('fd-')), csvIds = all.filter(id => id.startsWith('fdu-'));
      const results = [];
      // Ligas CSV: el resultado ya está en la base (job csv); sin consultas externas.
      for (let i = 0; i < csvIds.length; i += 100) {
        const matches = await repo.csvResults(csvIds.slice(i, i + 100)).catch(() => []);
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m) })));
      }
      // Hasta 9 consultas por ejecución, bajo la cuota gratuita de 10/min.
      for (let i = 0; i < Math.min(ids.length, 450); i += 50) {
        if (Date.now() > deadline - 6000) break;
        const matches = await provider.results(ids.slice(i, i + 50));
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m) })));
      }
      if (results.length) await repo.applyResults(results);
      return { checked: results.length, remaining: Math.max(0, all.length - results.length) };
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
    if (kind === 'csv') {
      // Política de football-data.co.uk: uso personal y como máximo dos descargas
      // automáticas por semana. Se registra el intento ANTES de descargar.
      if (!csvLeagues?.length) return { skipped: true, reason: 'Sin ligas CSV configuradas' };
      if (await repo.csvSyncsSince(now - 7 * DAY) >= 2) {
        return { skipped: true, reason: 'Ya hubo dos descargas en los últimos 7 días (límite de football-data.co.uk)' };
      }
      await repo.recordCsvSync();
      const { fixtures, results, files } = await (csvSync ?? syncCsv)(csvLeagues, { now });
      await repo.storeCsvMatches([...results, ...fixtures], now - 400 * DAY);
      return { files, results: results.length, fixtures: fixtures.length };
    }
    if (kind === 'notify') return deliverNotifications(repo, push, deadline);
    throw new Error('Tarea desconocida');
  } finally { await repo.releaseLock(owner); }
}
