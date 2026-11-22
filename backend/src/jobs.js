import { generateBatch, batchDay, resultOf, DREAMER, activeTickets, statusNotice, newBatchNotice } from './tickets.js';
import { deliverNotifications } from './push.js';
import { lambdaFromOver15, featuresFromHistory } from './apifootball.js';
import { syncCsv, CSV_LEAGUES, CSV_VALIDATION } from './csvleagues.js';
import { oldbSnapshot, oldbResults, OLDB_LEAGUES, OLDB_VALIDATION, OLDB_ATTRIBUTION } from './openliga.js';
import { syncFc, fcBlocked, FC_ATTRIBUTION } from './footballcharts.js';
import { bsdEvents, bsdBlocked, BSD_CROSS, BSD_ATTRIBUTION } from './bsd.js';

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

export async function runJob(kind, { repo, provider, push, timeZone, minProbability, csvLeagues, csvSync, market, legs, maxTickets, evidence, openLiga, dreamer, sameDay, days = sameDay ? 1 : null, ticketThresholds, backupOnly = [], fc = null, bsd = null, afEnabled, now = Date.now() }) {
  const owner = await repo.acquireLock();
  if (!owner) return { skipped: true, reason: 'Hay otra tarea ejecutándose o se está respetando el límite del proveedor' };
  const deadline = Date.now() + 45_000;
  try {
    if (kind === 'generate') {
      const day = batchDay(now, timeZone), existing = await repo.getBatch(day);
      if (existing) return { batchId: existing.id, existing: true };
      // Avisos para todos los teléfonos; si fallan (p. ej. sin la migración 016) la
      // tanda sigue igual. Se envían en esta misma ejecución para que lleguen a las 23:45.
      const notify = async (key, batchId, notice) => {
        try {
          const queued = await repo.enqueueNotice?.(key, batchId, notice) ?? 0;
          const delivery = queued && push?.configured ? await deliverNotifications(repo, push, deadline) : null;
          return { queued, ...(delivery ? { sent: delivery.sent, failed: delivery.failed } : {}) };
        } catch (error) { return { error: error.message }; }
      };
      // La tanda en juego se conserva mientras le quede algún ticket activo: solo se avisa su estado.
      const latest = repo.latestBatch ? await repo.latestBatch() : null;
      const active = activeTickets(latest, now);
      if (active.length) {
        return { batchId: latest.id, kept: true, active: active.map(t => t.number),
          notice: await notify(`status:${day}`, latest.id, statusNotice(latest, now)) };
      }
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
        // Partidos con análisis de API-Football o, si no lo tienen, con forma calculada
        // por nosotros desde los resultados guardados (sin consultas).
        const upcoming = await repo.afUpcoming(now, now + (days ? days + 1 : 3) * DAY).catch(() => null);
        const finished = upcoming?.length ? await Promise.resolve()
          .then(() => repo.afFinished(upcoming.map(m => m.league.afId), now - 400 * DAY)).catch(() => []) : [];
        const af = upcoming?.map(m => m.formFeatures ? m : { ...m, formFeatures: featuresFromHistory(m, finished) }) ?? null;
        // Media de goles de cada liga (tasa de over 1.5 acumulada) para encoger promedios.
        const rates = af ? await Promise.resolve().then(() => repo.afLeagueRates()).catch(() => new Map()) : new Map();
        const goalsOf = m => { const r = rates.get(m.league.afId); return r && r.matches >= 10 ? lambdaFromOver15(r.over15) : undefined; };
        if (af) snapshot.fixtures = [...snapshot.fixtures, ...af.filter(m => m.formFeatures).map(m => ({ ...m, formLeagueGoals: goalsOf(m) }))];
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
      // Football Charts: lo guardado por el job fc (sin consultas aquí). Forma propia
      // calculada con sus resultados; por mercado, solo las ligas que pasaron backtest.
      let fcBackup = [], fcBlocked15 = [];
      if (fc?.leagues?.length) {
        const rows = await repo.fcMatches(now - 400 * DAY).catch(() => null);
        if (!rows) snapshot.warnings = [...(snapshot.warnings ?? []), 'Football Charts no disponible en esta tanda.'];
        else {
          const active = new Set(fc.leagues.map(s => `fc-${s}`)), finished = rows.filter(m => m.status === 'FINISHED');
          const goalsOf = league => { const recent = finished.filter(m => m.league.id === league && Date.parse(m.kickoff) > now - 120 * DAY);
            return recent.length >= 10 ? lambdaFromOver15(recent.filter(m => m.homeGoals + m.awayGoals >= 2).length / recent.length) : undefined; };
          const upcoming = rows.filter(m => m.status === 'TIMED' && active.has(m.league.id) && Date.parse(m.kickoff) > now)
            .map(m => ({ ...m, formFeatures: featuresFromHistory(m, finished), formLeagueGoals: goalsOf(m.league.id) }))
            .filter(m => m.formFeatures);
          snapshot.fixtures = [...snapshot.fixtures, ...upcoming];
          // Sin validar en over 2.5 → fuera como over 2.5 (backupOnly); sin validar en 1.5 → fuera del respaldo.
          fcBackup = fcBlocked('OVER_2_5', fc.leagues);
          fcBlocked15 = fcBlocked('OVER_1_5', fc.leagues);
          if (upcoming.length) snapshot.warnings = [...(snapshot.warnings ?? []), FC_ATTRIBUTION];
        }
      }
      // BSD: lo guardado por el job bsd (sin consultas aquí). Modelo principal con su
      // historial; la Europa League, con la liga local de cada equipo (crossPredict).
      let bsdBackup = [], bsdBlocked15 = [];
      if (bsd?.leagues?.length) {
        const since = now - 400 * DAY;
        const rows = await Promise.resolve().then(() => repo.bsdMatches(since, { leagues: bsd.leagues })).catch(() => null);
        if (!rows) snapshot.warnings = [...(snapshot.warnings ?? []), 'Bzzoiro Sports Data no disponible en esta tanda.'];
        else {
          const cross = new Set(bsd.leagues.filter(l => BSD_CROSS.has(l)));
          const upcoming = rows.filter(m => m.status === 'TIMED' && Date.parse(m.kickoff) > now);
          // Historial de las ligas locales de los equipos de copa (dos consultas pequeñas).
          let local = [];
          const teams = [...new Set(upcoming.filter(m => cross.has(m.league.id)).flatMap(m => [m.home.id, m.away.id]))];
          if (teams.length) {
            const own = await Promise.resolve().then(() => repo.bsdMatches(since, { teams })).catch(() => []);
            const leagues = [...new Set(own.map(m => m.league.id))].filter(l => !bsd.leagues.includes(l));
            local = await Promise.resolve().then(() => repo.bsdMatches(since, { leagues })).catch(() => []);
          }
          // Sin hora real de publicación: el resultado se da por conocido 3 h después del inicio.
          snapshot.history.push(...[...rows, ...local].filter(m => m.status === 'FINISHED')
            .map(m => ({ ...m, availableAt: new Date(Date.parse(m.kickoff) + 3 * 3_600_000).toISOString() }))
            .filter(m => Date.parse(m.availableAt) <= now));
          snapshot.fixtures = [...snapshot.fixtures, ...upcoming.map(m => cross.has(m.league.id) ? { ...m, crossLeague: true } : m)];
          bsdBackup = bsdBlocked('OVER_2_5', bsd.leagues);
          bsdBlocked15 = bsdBlocked('OVER_1_5', bsd.leagues);
          if (upcoming.length) snapshot.warnings = [...(snapshot.warnings ?? []), BSD_ATTRIBUTION];
        }
      }
      const batch = generateBatch(snapshot, { now, timeZone, minProbability, excludedIds, market, legs, maxTickets, evidence, dreamer, day, days,
        ticketThresholds, backupOnly: [...backupOnly, ...fcBackup, ...bsdBackup], blocked15: [...fcBlocked15, ...bsdBlocked15] });
      let publishedId;
      try { publishedId = await repo.publish(batch); }
      catch (error) {
        // Sin la migración 008 la base rechaza La soñadora: se publica sin ella.
        if (!batch.tickets.some(t => t.kind === 'dreamer')) throw error;
        batch.tickets = batch.tickets.filter(t => t.kind !== 'dreamer');
        batch.warnings = [...batch.warnings.filter(w => !w.startsWith(DREAMER.name)), `${DREAMER.name} no se pudo publicar en esta tanda.`];
        publishedId = await repo.publish(batch);
      }
      // Solo se avisa una tanda que se acaba de crear (publish devuelve el id existente si ya había).
      const notice = publishedId === batch.id ? await notify(`new:${batch.id}`, batch.id, newBatchNotice(batch, latest, timeZone)) : null;
      return { batchId: publishedId, tickets: batch.tickets.filter(t => t.kind !== 'dreamer').length,
        dreamer: batch.tickets.some(t => t.kind === 'dreamer'), missingMatches: batch.missingMatches, ...(notice ? { notice } : {}) };
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
      // Football Charts: resultado guardado por el job fc (por id o por equipos ±1 día).
      const fcIds = all.filter(id => id.startsWith('fc-'));
      for (let i = 0; i < fcIds.length; i += 50) {
        const matches = await Promise.resolve().then(() => repo.fcResults(fcIds.slice(i, i + 50))).catch(() => []);
        results.push(...matches.map(m => ({ ...resultOf(m, marketOf.get(m.matchId)), matchId: m.matchId })));
      }
      // BSD: resultado guardado por el job bsd (cada hora).
      const bsdIds = all.filter(id => id.startsWith('bsd-'));
      for (let i = 0; i < bsdIds.length; i += 100) {
        const matches = await Promise.resolve().then(() => repo.bsdResults(bsdIds.slice(i, i + 100))).catch(() => []);
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
      // Los avisos de ticket ganado se crean al liquidar: se envían aquí mismo. El cron
      // momios-notify falla desde pg_net ("Error in the HTTP2 framing layer") y queda de respaldo.
      let notified = null;
      if (results.length && push?.configured) {
        notified = await deliverNotifications(repo, push, deadline).catch(error => ({ error: error.message }));
      }
      return { checked: results.length, remaining: Math.max(0, all.length - results.length), ...(notified ? { notified } : {}) };
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
    if (kind === 'fc') {
      // Football Charts: reparte las ligas entre ejecuciones (≤ fc.perRun por vez, las
      // sincronizadas hace más tiempo primero; ninguna antes de 10 h). 2 consultas por liga.
      if (!fc?.key || !fc.leagues?.length) return { skipped: true, reason: 'Sin clave o ligas de Football Charts' };
      const times = await repo.fcSyncTimes();
      const due = fc.leagues.filter(l => !(times.get(l) > now - 10 * 3_600_000))
        .sort((a, b) => (times.get(a) ?? 0) - (times.get(b) ?? 0)).slice(0, fc.perRun ?? 10);
      if (!due.length) return { skipped: true, reason: 'Todas las ligas están al día' };
      const catalog = (await fc.get('/leagues/')).leagues;
      if (!Array.isArray(catalog) || !catalog.length) throw new Error('Football Charts no devolvió el catálogo de ligas');
      const { results, fixtures, done, failed } = await syncFc(due, { get: fc.get, catalog });
      await repo.storeFcMatches([...results, ...fixtures], now - 400 * DAY);
      await repo.markFcSync(done);
      return { synced: done, failed, results: results.length, fixtures: fixtures.length,
        remaining: fc.leagues.filter(l => !done.includes(l) && !(times.get(l) > now - 10 * 3_600_000)).length };
    }
    if (kind === 'bsd') {
      // Ventana corta (resultados de 3 días atrás y próximos 8): ~6-10 consultas de 7500/día.
      if (!bsd?.get) return { skipped: true, reason: 'Falta BSD_TOKEN' };
      const utc = t => new Date(t).toISOString().slice(0, 10);
      const matches = await bsdEvents(utc(now - 3 * DAY), utc(now + 8 * DAY), { get: bsd.get });
      await repo.storeBsdMatches(matches, now - 400 * DAY);
      return { stored: matches.length, finished: matches.filter(m => m.status === 'FINISHED').length,
        upcoming: matches.filter(m => m.status === 'TIMED').length };
    }
    if (kind === 'notify') return deliverNotifications(repo, push, deadline);
    throw new Error('Tarea desconocida');
  } finally { await repo.releaseLock(owner); }
}
