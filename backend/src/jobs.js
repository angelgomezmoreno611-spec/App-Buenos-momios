import { generateBatch, dayKey, resultOf } from './tickets.js';
import { deliverNotifications } from './push.js';
import { syncCsv, CSV_LEAGUES, CSV_VALIDATION } from './csvleagues.js';
import { oldbSnapshot, oldbResults, OLDB_LEAGUES, OLDB_VALIDATION, OLDB_ATTRIBUTION } from './openliga.js';

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

export async function runJob(kind, { repo, provider, push, timeZone, minProbability, csvLeagues, csvSync, market, legs, evidence, openLiga, risky, afEnabled, now = Date.now() }) {
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
          const table = CSV_VALIDATION[market ?? 'OVER_2_5'] ?? {};
          const measured = [...new Set(fixtures.map(m => m.league.id))].filter(c => table[c])
            .map(c => `${CSV_LEAGUES[c].name} ${Math.round(table[c].hitRate * 100)}% (${table[c].picks})`);
          snapshot.warnings = [...(snapshot.warnings ?? []),
            'Ligas de football-data.co.uk: datos actualizados dos veces por semana; sus resultados se liquidan con días de retraso.',
            ...(measured.length ? [`Acierto medido por partido en 2022-2026 con umbral ${minProbability} (selecciones): ${measured.join(', ')}.`] : [])];
        }
      }
      // API-Football: partidos ya analizados por el job discover (sin consultas aquí).
      if (afEnabled) {
        const af = await repo.afUpcoming(now, now + 72 * 3_600_000, { analyzed: true }).catch(() => null);
        if (af) snapshot.fixtures = [...snapshot.fixtures, ...af.filter(m => m.formFeatures)];
      }
      // OpenLigaDB (3. Liga): consulta directa, gratis; si falla, se sigue sin ella.
      if (openLiga?.leagues?.length) {
        const oldb = await oldbSnapshot(openLiga.leagues, { now, get: openLiga.get }).catch(() => null);
        if (!oldb) snapshot.warnings = [...(snapshot.warnings ?? []), 'OpenLigaDB no disponible en esta tanda.'];
        else {
          snapshot.history.push(...oldb.history);
          snapshot.fixtures = [...snapshot.fixtures, ...oldb.fixtures];
          const table = OLDB_VALIDATION[market ?? 'OVER_2_5'] ?? {};
          const measured = openLiga.leagues.filter(c => table[c])
            .map(c => `${OLDB_LEAGUES[c].name} ${Math.round(table[c].hitRate * 100)}% (${table[c].picks})`);
          if (oldb.fixtures.length) snapshot.warnings = [...(snapshot.warnings ?? []), OLDB_ATTRIBUTION,
            ...(measured.length ? [`Acierto medido por partido en 2022-2026 con umbral ${minProbability} (selecciones): ${measured.join(', ')}.`] : [])];
        }
      }
      const batch = generateBatch(snapshot, { now, timeZone, minProbability, excludedIds, market, legs, evidence, risky });
      let publishedId;
      try { publishedId = await repo.publish(batch); }
      catch (error) {
        // Sin la migración 006 la base rechaza el quinto ticket: se publica sin él.
        if (!batch.tickets.some(t => t.kind === 'risky')) throw error;
        batch.tickets = batch.tickets.filter(t => t.kind !== 'risky');
        batch.warnings = [...batch.warnings.filter(w => !w.startsWith('El arriesgado')), 'El arriesgado del día no se pudo publicar en esta tanda.'];
        publishedId = await repo.publish(batch);
      }
      return { batchId: publishedId, tickets: batch.tickets.filter(t => t.kind !== 'risky').length,
        risky: batch.tickets.some(t => t.kind === 'risky'), missingMatches: batch.missingMatches };
    }
    if (kind === 'settle') {
      const pending = await repo.pendingMatches(now);
      const all = [...new Set(pending.map(x => x.match_id))];
      // Cada partido pertenece a una sola selección: su mercado decide si se acierta.
      const marketOf = new Map(pending.map(x => [x.match_id, x.market ?? 'OVER_2_5']));
      const ids = all.filter(id => id.startsWith('fd-')), csvIds = all.filter(id => id.startsWith('fdu-'));
      const results = [];
      // API-Football: el resultado llega con la lista de "ayer" del job discover.
      const afIds = all.filter(id => id.startsWith('af-'));
      for (let i = 0; i < afIds.length; i += 100) {
        const matches = await repo.afResults(afIds.slice(i, i + 100)).catch(() => []);
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m, marketOf.get(m.id)) })));
      }
      // OpenLigaDB: una consulta pequeña por partido pendiente (máx. 10 por ejecución).
      const oldbIds = all.filter(id => id.startsWith('oldb-'));
      if (oldbIds.length && openLiga?.get) {
        const matches = await oldbResults(oldbIds, { get: openLiga.get }).catch(() => []);
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m, marketOf.get(m.id)) })));
      }
      // Ligas CSV: el resultado ya está en la base (job csv); sin consultas externas.
      for (let i = 0; i < csvIds.length; i += 100) {
        const matches = await repo.csvResults(csvIds.slice(i, i + 100)).catch(() => []);
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m, marketOf.get(m.id)) })));
      }
      // Hasta 9 consultas por ejecución, bajo la cuota gratuita de 10/min.
      for (let i = 0; i < Math.min(ids.length, 450); i += 50) {
        if (Date.now() > deadline - 6000) break;
        const matches = await provider.results(ids.slice(i, i + 50));
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m, marketOf.get(m.id)) })));
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
