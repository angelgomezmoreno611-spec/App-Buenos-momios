import { randomUUID } from 'node:crypto';
import { predict, crossPredict, MODEL_VERSION, MODEL_EVIDENCE } from './model.js';
import { formPredict, FORM_MIN, FORM_EVIDENCE } from './apifootball.js';
import { strengthPredict } from './strength.js';

// Partidos de API-Football (traen `formFeatures`) usan el modelo de forma reciente
// y un umbral más exigente; el resto, el modelo principal con historial.
const isForm = f => 'formFeatures' in f;
// Copas marcadas con `crossLeague` (Europa League de BSD): liga local de cada equipo.
const predictFixture = (f, history, opts) => isForm(f) ? formPredict(f, f.formFeatures, { ...opts, leagueGoals: f.formLeagueGoals })
  : f.crossLeague ? crossPredict(f, history, opts) : 'strengthInput' in f ? strengthPredict(f, f.strengthInput, opts) : predict(f, history, opts);
const minFor = (f, market, base) => isForm(f) ? Math.max(base, FORM_MIN[market]) : base;

export function dayKey(now = Date.now(), timeZone = 'America/Mazatlan') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(x => x.type === k).value).join('-');
}

// Inicio (UTC, ms) del día local `day` (AAAA-MM-DD) en la zona horaria dada.
function zoneOffset(t, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(t).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}
export function dayStart(day, timeZone = 'America/Mazatlan') {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone); // segunda pasada por cambios de horario
}
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const nextDay = day => addDays(day, 1);

// La tanda del día siguiente se genera a las 23:45 (Mazatlán): desde 20 min antes
// de medianoche, generate y /api/tickets ya usan la fecha de mañana.
export const GENERATE_AHEAD_MS = 20 * 60_000;
export const batchDay = (now = Date.now(), timeZone) => dayKey(now + GENERATE_AHEAD_MS, timeZone);

// Mercados soportados: línea de goles y mínimo de goles para acertar.
export const MARKETS = Object.freeze({ OVER_1_5: { line: 1.5, goals: 2 }, OVER_2_5: { line: 2.5, goals: 3 }, OVER_3_5: { line: 3.5, goals: 4 } });
// Ligas medidas con mal acierto en ese mercado (backtest): no entran en tickets.
// Ligas de API-Football (af-<id>) re-validadas el 2026-11-16 con el modelo de forma:
// en over 2.5 ≥0.62 todas aciertan <62% (2. Bundesliga 60.9%, Austria 58.6%, el resto
// 25-50%); en over 1.5 ≥0.79 solo pasan 2. Bundesliga (ahora por CSV) y Austria.
const AF_BAD_OVER_2_5 = ['af-79', 'af-62', 'af-136', 'af-180', 'af-141', 'af-218', 'af-283', 'af-98', 'af-128'];
const AF_BAD_OVER_1_5 = ['af-62', 'af-136', 'af-180', 'af-141', 'af-283', 'af-98', 'af-128'];
export const MARKET_BLOCKED = Object.freeze({ OVER_1_5: ['PD', 'SA', ...AF_BAD_OVER_1_5], OVER_2_5: AF_BAD_OVER_2_5, OVER_3_5: [] });
// "La soñadora": un ticket largo de 8 over 2.5 con los partidos que no usan los
// tickets normales. Mínimo 0.60 por selección, también en partidos de
// API-Football (backtest principal: ≥0.60 acertó 62.8% en 1956 sel.; backtest:form
// encogido: 60.6% validación / 63.9% prueba). Ticket ≈ 0.6^8 ≈ 1.7% (1 de cada 60).
export const DREAMER = Object.freeze({ name: 'La soñadora', market: 'OVER_2_5', picks: 8, min: 0.6 });

// Con `alt15` (respaldo over 1.5), cada over 2.5 que falte se cambia por 2 over 1.5
// con probabilidad ≥ √min (≈0.78; 0.79 en partidos de forma): de 8 a 16 partidos.
export function dreamerTicket(fixtures, history, { now, usedIds, number, alt15 = null, backupOnly = [] }) {
  const used = new Set(usedIds), { market, picks, min, name } = DREAMER, line = MARKETS[market].line;
  const ranked = fixtures.filter(f => !used.has(f.id) && !MARKET_BLOCKED[market].includes(f.league.id) && !backupOnly.includes(f.league.id))
    .map(f => ({ match: f, prediction: predictFixture(f, history, { asOf: now, line }) }))
    .filter(x => x.prediction.eligible && x.prediction.probability >= min) // su propio mínimo, sin FORM_MIN
    .sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id))
    .slice(0, picks);
  const selections = ranked.map(({ match: { formFeatures, formLeagueGoals, analyzed, crossLeague, cup, strengthInput, ...match }, prediction }) =>
    ({ match, prediction, market, result: 'pending', score: null }));
  const missing = picks - ranked.length;
  if (missing > 0) {
    if (!alt15) return null;
    // ranked ya contiene todos los over 2.5 libres que llegan al mínimo: el respaldo no los toca.
    const taken = new Set(ranked.map(x => x.match.id)), min15 = Math.sqrt(min);
    const backup = alt15.filter(x => !used.has(x.match.id) && !taken.has(x.match.id)
        && x.prediction.probability >= (x.form ? Math.max(min15, FORM_MIN.OVER_1_5) : min15))
      .sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id))
      .slice(0, 2 * missing).map(({ form, ...x }) => x);
    if (backup.length < 2 * missing) return null;
    selections.push(...backup);
  }
  return { id: randomUUID(), number, kind: 'dreamer', name, status: 'pending', selections,
    probability: selections.reduce((p, x) => p * x.prediction.probability, 1) };
}

export function generateBatch(snapshot, { now = Date.now(), timeZone, minProbability = 0.65, mode = 'live', excludedIds = [],
  market = 'OVER_2_5', legs = 3, evidence = null, maxTickets = 4, dreamer = false, day = null, sameDay = false, days = sameDay ? 1 : null,
  ticketThresholds = null, backupOnly = [], blocked15 = [] } = {}) {
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 7)) throw new Error('Días de la tanda inválidos');
  if (!Number.isFinite(minProbability) || minProbability < 0.5 || minProbability > 0.95) throw new Error('Umbral inválido');
  if (!MARKETS[market] || ![3, 4, 6].includes(legs)) throw new Error('Mercado o tamaño de ticket inválido');
  if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 4) throw new Error('Número de tickets inválido');
  // Umbral por ticket (escalonado: el 01 es el más exigente). Sin lista, todos usan minProbability.
  const tiers = ticketThresholds ?? Array(maxTickets).fill(minProbability);
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 4 || tiers.some(t => !Number.isFinite(t) || t < 0.5 || t > 0.95)) {
    throw new Error('Umbrales por ticket inválidos');
  }
  const floor = Math.min(...tiers);
  const { line } = MARKETS[market];
  const age = now - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 6 * 3_600_000) throw new Error('Datos desactualizados');
  const seen = new Set(excludedIds), candidates = [], rejections = [], window = [], alt15 = [];
  // Ventana: `days` días locales desde el día de la tanda (1 = solo ese día) o, sin `days`, 72 h.
  const batchDate = day ?? dayKey(now, timeZone);
  const from = Math.max(now + 3_600_000, days ? dayStart(batchDate, timeZone) : -Infinity);
  const until = days ? dayStart(addDays(batchDate, days), timeZone) : now + 72 * 3_600_000;
  for (const f of snapshot.fixtures) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const kickoff = Date.parse(f.kickoff);
    if (!(kickoff >= from && kickoff < until)) continue;
    window.push(f);
    // Respaldo over 1.5 (tickets escalonados): cada over 2.5 que falte se cambia por 2 over 1.5.
    if (ticketThresholds && market === 'OVER_2_5' && !MARKET_BLOCKED.OVER_1_5.includes(f.league.id) && !blocked15.includes(f.league.id)) {
      const p15 = predictFixture(f, snapshot.history, { asOf: now, line: MARKETS.OVER_1_5.line });
      if (p15.eligible) {
        const { formFeatures, formLeagueGoals, analyzed, crossLeague, cup, strengthInput, ...match } = f;
        alt15.push({ match, prediction: p15, market: 'OVER_1_5', result: 'pending', score: null, form: isForm(f) });
      }
    }
    if (MARKET_BLOCKED[market].includes(f.league.id) || backupOnly.includes(f.league.id)) {
      rejections.push({ matchId: f.id, reason: backupOnly.includes(f.league.id) ? 'Liga validada solo en over 1.5 (respaldo)' : 'Liga con bajo acierto medido en este mercado' });
      continue;
    }
    const prediction = predictFixture(f, snapshot.history, { asOf: now, line });
    if (!prediction.eligible || prediction.probability < minFor(f, market, floor)) {
      rejections.push({ matchId: f.id, reason: prediction.reason ?? 'Probabilidad inferior al umbral' });
      continue;
    }
    const { formFeatures, formLeagueGoals, analyzed, crossLeague, cup, strengthInput, ...match } = f; // no se publican datos internos
    candidates.push({ match, prediction, market, result: 'pending', score: null });
  }
  candidates.sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id));
  let tickets, unformed = 0;
  if (ticketThresholds) {
    // Escalonado: cada ticket toma los mejores over 2.5 libres que llegan a su umbral
    // (hasta `legs`). Por cada uno que falte entran 2 over 1.5 con probabilidad
    // ≥ √umbral (0.81 × 0.81 ≈ 0.65: el ticket conserva su probabilidad), solo de
    // partidos que no son candidatos a over 2.5. Sin completar, no se forma.
    tickets = [];
    const used = new Set();
    for (const threshold of tiers) {
      const free25 = candidates.filter(x => !used.has(x.match.id));
      const main = free25.filter(x => x.prediction.probability >= minFor(x.match, market, threshold)).slice(0, legs);
      const missing = market === 'OVER_2_5' ? legs - main.length : 0;
      if (market !== 'OVER_2_5' && main.length < legs) { unformed++; continue; }
      let backup = [];
      if (missing > 0) {
        const min15 = Math.sqrt(threshold), taken = new Set(main.map(x => x.match.id)), as25 = new Set(free25.map(x => x.match.id));
        // Solo partidos que no son candidatos a over 2.5: así no se les quitan a los tickets siguientes.
        backup = alt15.filter(x => !used.has(x.match.id) && !taken.has(x.match.id) && !as25.has(x.match.id)
            && x.prediction.probability >= (x.form ? Math.max(min15, FORM_MIN.OVER_1_5) : min15))
          .sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id))
          .slice(0, 2 * missing).map(({ form, ...x }) => x);
        if (backup.length < 2 * missing) { unformed++; continue; }
      }
      const selections = [...main, ...backup];
      selections.forEach(x => used.add(x.match.id));
      tickets.push({ id: randomUUID(), number: tickets.length + 1, status: 'pending', threshold, selections,
        probability: selections.reduce((p, x) => p * x.prediction.probability, 1) });
    }
  } else {
    const count = Math.min(maxTickets, Math.floor(candidates.length / legs));
    tickets = Array.from({ length: count }, (_, i) => ({
      id: randomUUID(), number: i + 1, status: 'pending', selections: [], probability: 1
    }));
    // Distribuye el riesgo entre los tickets sin reutilizar partidos.
    for (const pick of candidates.slice(0, count * legs)) {
      const ticket = tickets.filter(t => t.selections.length < legs)
        .sort((a, b) => b.probability - a.probability || a.number - b.number)[0];
      ticket.selections.push(pick);
      ticket.probability *= pick.prediction.probability;
    }
  }
  // Partidos rechazados en over 2.5 que entraron como over 1.5 ya no son rechazos.
  const usedIds = new Set(tickets.flatMap(t => t.selections.map(x => x.match.id)));
  const finalRejections = rejections.filter(r => !usedIds.has(r.matchId));
  // La soñadora (opcional), con partidos que no usaron los tickets normales.
  const extra = dreamer ? dreamerTicket(window, snapshot.history, {
    now, number: tickets.length + 1, usedIds: [...usedIds], alt15: ticketThresholds && market === 'OVER_2_5' ? alt15 : null, backupOnly }) : null;
  return {
    id: randomUUID(), day: batchDate, mode, sameDay: days === 1, ...(days ? { days, until: addDays(batchDate, days - 1) } : {}),
    createdAt: new Date(now).toISOString(), sourceUpdatedAt: snapshot.fetchedAt,
    source: snapshot.source, modelVersion: MODEL_VERSION, minProbability, market, line, legs, maxTickets: tiers.length,
    ...(ticketThresholds ? { ticketThresholds: tiers } : {}),
    // La evidencia solo describe al modelo con el mismo mercado y umbral con que se midió.
    ...(evidence && evidence.threshold === minProbability && evidence.market === market ? { evidence }
      : market === 'OVER_2_5' && minProbability === MODEL_EVIDENCE.threshold ? { evidence: MODEL_EVIDENCE } : {}),
    tickets: extra ? [...tickets, extra] : tickets, eligibleMatches: candidates.length, missingMatches: ticketThresholds ? unformed * legs : Math.max(0, tiers.length * legs - candidates.length),
    rejections: extra ? finalRejections.filter(r => !extra.selections.some(x => x.match.id === r.matchId)) : finalRejections, warnings: [
      ...(snapshot.warnings ?? []),
      ...(mode === 'demo' ? ['DEMOSTRACIÓN: equipos, resultados y probabilidades sintéticos.'] : []),
      'Probabilidades estimadas solo con marcadores históricos; sin garantía de ganancias.',
      'Probabilidad del ticket calculada suponiendo independencia; pueden existir correlaciones.',
      'Sin cuotas actuales: no se calcula valor esperado ni rentabilidad.',
      ...([...tickets, ...(extra ? [extra] : [])].some(t => t.selections.some(x => x.prediction.modelVersion?.startsWith('form-af-v1'))) ? [FORM_EVIDENCE] : []),
      ...(tickets.some(t => t.selections.some(x => x.market === 'OVER_1_5') && market === 'OVER_2_5')
        ? [`Respaldo over 1.5: si faltan over 2.5 en un ticket, cada uno se cambia por 2 over 1.5 con probabilidad de al menos la raíz del umbral (≈${Math.sqrt(floor).toFixed(2)} para ${floor}), para conservar la probabilidad del ticket.`] : []),
      ...(extra ? [`${DREAMER.name}: ${[['OVER_2_5', '2.5'], ['OVER_1_5', '1.5']].map(([m, l]) => [extra.selections.filter(x => x.market === m).length, l])
        .filter(([c]) => c).map(([c, l]) => `${c} over ${l}`).join(' + ')}, probabilidad conjunta estimada ${Math.round(extra.probability * 100)}%. Alto riesgo.`] : [])
    ]
  };
}

export function resultOf(match, market = 'OVER_2_5') {
  if (!match) return { result: 'pending', score: null };
  const goals = MARKETS[market]?.goals;
  if (!goals) return { result: 'review', score: null };
  if (match.status === 'FINISHED') {
    if (!Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals) || match.homeGoals < 0 || match.awayGoals < 0) {
      return { result: 'review', score: null };
    }
    return { result: match.homeGoals + match.awayGoals >= goals ? 'won' : 'lost', score: `${match.homeGoals}–${match.awayGoals}` };
  }
  if (['POSTPONED', 'SUSPENDED', 'CANCELLED', 'AWARDED', 'UNKNOWN'].includes(match.status)) {
    return { result: 'review', score: null };
  }
  return { result: 'pending', score: null };
}

export function ticketStatus(results, legs = 4) {
  if (results.length !== legs) return 'review';
  if (results.includes('lost')) return 'lost';
  if (results.every(r => r === 'won')) return 'won';
  if (results.includes('review')) return 'review';
  return 'pending';
}

// Tickets que siguen en juego: pendientes (o en revisión) cuyo último partido no
// pasó hace más de `staleMs` (4 días: las ligas CSV se liquidan con retraso). Un
// ticket atorado (partido suspendido) deja de bloquear la tanda nueva.
export function activeTickets(batch, now = Date.now(), staleMs = 4 * 86_400_000) {
  return (batch?.tickets ?? []).filter(t => ['pending', 'review'].includes(t.status)
    && Math.max(...t.selections.map(x => Date.parse(x.match.kickoff))) > now - staleMs);
}

const ticketName = t => t.kind === 'dreamer' ? t.name ?? 'La soñadora' : `ticket ${t.number}`;
const joinList = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;

// Aviso diario (23:45) con el estado de la tanda en juego.
export function statusNotice(batch, now = Date.now()) {
  const active = activeTickets(batch, now), won = batch.tickets.filter(t => t.status === 'won');
  const lost = batch.tickets.filter(t => t.status === 'lost').length;
  const names = joinList(active.map(ticketName));
  const title = active.length === batch.tickets.length ? 'Todos tus tickets siguen activos ✅' : `${active.length} de ${batch.tickets.length} tickets siguen activos`;
  const body = [
    active.length === 1 ? `Sigue activo: ${names}.` : `Siguen activos: ${names}.`,
    active.length === batch.tickets.length ? 'No se ha perdido ningún partido.' : '',
    won.length ? `Ganado${won.length > 1 ? 's' : ''}: ${joinList(won.map(ticketName))}.` : '',
    lost ? `Perdido${lost > 1 ? 's' : ''}: ${lost}.` : ''
  ].filter(Boolean).join(' ');
  return { title: title.charAt(0).toUpperCase() + title.slice(1), body };
}

const dm = d => `${d.slice(8)}/${d.slice(5, 7)}`;
// Varias tandas en juego (máximo 2 por semana): un renglón por tanda, más reciente primero.
export function statusNoticeAll(batches, now = Date.now()) {
  const live = batches.filter(b => activeTickets(b, now).length);
  if (live.length === 1) return statusNotice(live[0], now);
  const active = live.reduce((n, b) => n + activeTickets(b, now).length, 0);
  return { title: `${active} tickets siguen activos en ${live.length} tandas`,
    body: live.map(b => `Tanda del ${dm(b.day)}: ${statusNotice(b, now).body}`).join('\n') };
}
// Ya hubo el máximo de tandas en la semana y ninguna sigue en juego.
export function waitNotice(nextDay) {
  return { title: 'Tus tickets ya se resolvieron', body: `La próxima tanda sale el ${dm(nextDay)} (máximo 2 tandas por semana).` };
}

// Aviso de tanda nueva. `previous`: la última tanda; `others`: tandas que siguen en juego.
export function newBatchNotice(batch, previous = null, timeZone = 'America/Mazatlan', others = []) {
  const count = batch.tickets.length;
  const won = previous?.tickets.filter(t => t.status === 'won').length ?? 0;
  const live = others.filter(b => activeTickets(b).length);
  const before = live.length ? `Sigue en juego tu tanda del ${live.map(b => dm(b.day)).join(' y del ')}. `
    : previous ? (won ? `Tu tanda anterior terminó con ${won} ticket${won > 1 ? 's' : ''} ganado${won > 1 ? 's' : ''}. ` : 'Tus tickets anteriores ya se resolvieron. ') : '';
  if (!count) return { title: 'Sin tickets nuevos por ahora', body: `${before}No hubo partidos con la probabilidad suficiente; mañana se vuelve a intentar.` };
  const days = batch.tickets.flatMap(t => t.selections.map(x => dayKey(Date.parse(x.match.kickoff), timeZone))).sort();
  const span = days.length ? (days[0] === days.at(-1) ? ` Partidos del ${dm(days[0])}.` : ` Partidos del ${dm(days[0])} al ${dm(days.at(-1))}.`) : '';
  return { title: 'Tus nuevos tickets ya están listos 🎟️', body: `${before}${count} ticket${count > 1 ? 's' : ''} nuevo${count > 1 ? 's' : ''}.${span}` };
}
