import { randomUUID } from 'node:crypto';
import { predict, MODEL_VERSION, MODEL_EVIDENCE } from './model.js';
import { formPredict, FORM_MIN, FORM_EVIDENCE } from './apifootball.js';

// Partidos de API-Football (traen `formFeatures`) usan el modelo de forma reciente
// y un umbral más exigente; el resto, el modelo principal con historial.
const isForm = f => 'formFeatures' in f;
const predictFixture = (f, history, opts) => isForm(f) ? formPredict(f, f.formFeatures, { ...opts, leagueGoals: f.formLeagueGoals }) : predict(f, history, opts);
const minFor = (f, market, base) => isForm(f) ? Math.max(base, FORM_MIN[market]) : base;

export function dayKey(now = Date.now(), timeZone = 'America/Mazatlan') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(x => x.type === k).value).join('-');
}

// La tanda del día siguiente se genera a las 23:45 (Mazatlán): desde 20 min antes
// de medianoche, generate y /api/tickets ya usan la fecha de mañana.
export const GENERATE_AHEAD_MS = 20 * 60_000;
export const batchDay = (now = Date.now(), timeZone) => dayKey(now + GENERATE_AHEAD_MS, timeZone);

// Mercados soportados: línea de goles y mínimo de goles para acertar.
export const MARKETS = Object.freeze({ OVER_1_5: { line: 1.5, goals: 2 }, OVER_2_5: { line: 2.5, goals: 3 }, OVER_3_5: { line: 3.5, goals: 4 } });
// Ligas medidas con mal acierto en ese mercado (backtest): no entran en tickets.
export const MARKET_BLOCKED = Object.freeze({ OVER_1_5: ['PD', 'SA'], OVER_2_5: [], OVER_3_5: [] });
// "La soñadora": un ticket largo de 6 over 2.5 con los partidos que no usan los
// tickets normales (que siguen en 0.65). Mínimo 0.62 por selección, también en
// partidos de API-Football (backtest:form, método encogido: 0.62 → 62.0% en
// validación y 64.9% en prueba). Ticket completo ≈ 0.63^6 ≈ 6% (1 de cada 16).
export const DREAMER = Object.freeze({ name: 'La soñadora', market: 'OVER_2_5', picks: 6, min: 0.62 });

export function dreamerTicket(fixtures, history, { now, usedIds, number }) {
  const used = new Set(usedIds), { market, picks, min, name } = DREAMER, line = MARKETS[market].line;
  const ranked = fixtures.filter(f => !used.has(f.id) && !MARKET_BLOCKED[market].includes(f.league.id))
    .map(f => ({ match: f, prediction: predictFixture(f, history, { asOf: now, line }) }))
    .filter(x => x.prediction.eligible && x.prediction.probability >= min) // su propio mínimo, sin FORM_MIN
    .sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id))
    .slice(0, picks);
  if (ranked.length < picks) return null;
  const selections = ranked.map(({ match: { formFeatures, formLeagueGoals, analyzed, ...match }, prediction }) =>
    ({ match, prediction, market, result: 'pending', score: null }));
  return { id: randomUUID(), number, kind: 'dreamer', name, status: 'pending', selections,
    probability: selections.reduce((p, x) => p * x.prediction.probability, 1) };
}

export function generateBatch(snapshot, { now = Date.now(), timeZone, minProbability = 0.65, mode = 'live', excludedIds = [],
  market = 'OVER_2_5', legs = 3, evidence = null, maxTickets = 4, dreamer = false, day = null } = {}) {
  if (!Number.isFinite(minProbability) || minProbability < 0.5 || minProbability > 0.95) throw new Error('Umbral inválido');
  if (!MARKETS[market] || ![3, 4, 6].includes(legs)) throw new Error('Mercado o tamaño de ticket inválido');
  if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 4) throw new Error('Número de tickets inválido');
  const { line } = MARKETS[market];
  const age = now - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 6 * 3_600_000) throw new Error('Datos desactualizados');
  const seen = new Set(excludedIds), candidates = [], rejections = [], window = [];
  for (const f of snapshot.fixtures) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (Date.parse(f.kickoff) < now + 3_600_000 || Date.parse(f.kickoff) > now + 72 * 3_600_000) continue;
    window.push(f);
    if (MARKET_BLOCKED[market].includes(f.league.id)) {
      rejections.push({ matchId: f.id, reason: 'Liga con bajo acierto medido en este mercado' });
      continue;
    }
    const prediction = predictFixture(f, snapshot.history, { asOf: now, line });
    if (!prediction.eligible || prediction.probability < minFor(f, market, minProbability)) {
      rejections.push({ matchId: f.id, reason: prediction.reason ?? 'Probabilidad inferior al umbral' });
      continue;
    }
    const { formFeatures, formLeagueGoals, analyzed, ...match } = f; // no se publican datos internos
    candidates.push({ match, prediction, market, result: 'pending', score: null });
  }
  candidates.sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id));
  const count = Math.min(maxTickets, Math.floor(candidates.length / legs));
  const tickets = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(), number: i + 1, status: 'pending', selections: [], probability: 1
  }));
  // Distribuye el riesgo entre los tickets sin reutilizar partidos.
  for (const pick of candidates.slice(0, count * legs)) {
    const ticket = tickets.filter(t => t.selections.length < legs)
      .sort((a, b) => b.probability - a.probability || a.number - b.number)[0];
    ticket.selections.push(pick);
    ticket.probability *= pick.prediction.probability;
  }
  // La soñadora (opcional), con partidos que no usaron los tickets normales.
  const extra = dreamer ? dreamerTicket(window, snapshot.history, {
    now, number: tickets.length + 1, usedIds: tickets.flatMap(t => t.selections.map(x => x.match.id)) }) : null;
  return {
    id: randomUUID(), day: day ?? dayKey(now, timeZone), mode,
    createdAt: new Date(now).toISOString(), sourceUpdatedAt: snapshot.fetchedAt,
    source: snapshot.source, modelVersion: MODEL_VERSION, minProbability, market, line, legs, maxTickets,
    // La evidencia solo describe al modelo con el mismo mercado y umbral con que se midió.
    ...(evidence && evidence.threshold === minProbability && evidence.market === market ? { evidence }
      : market === 'OVER_2_5' && minProbability === MODEL_EVIDENCE.threshold ? { evidence: MODEL_EVIDENCE } : {}),
    tickets: extra ? [...tickets, extra] : tickets, eligibleMatches: candidates.length, missingMatches: Math.max(0, maxTickets * legs - candidates.length),
    rejections, warnings: [
      ...(snapshot.warnings ?? []),
      ...(mode === 'demo' ? ['DEMOSTRACIÓN: equipos, resultados y probabilidades sintéticos.'] : []),
      'Probabilidades estimadas solo con marcadores históricos; sin garantía de ganancias.',
      'Probabilidad del ticket calculada suponiendo independencia; pueden existir correlaciones.',
      'Sin cuotas actuales: no se calcula valor esperado ni rentabilidad.',
      ...([...tickets, ...(extra ? [extra] : [])].some(t => t.selections.some(x => x.prediction.modelVersion?.startsWith('form-af-v1'))) ? [FORM_EVIDENCE] : []),
      ...(extra ? [`${DREAMER.name}: 6 over 2.5, probabilidad conjunta estimada ${Math.round(extra.probability * 100)}%. Alto riesgo.`] : [])
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
