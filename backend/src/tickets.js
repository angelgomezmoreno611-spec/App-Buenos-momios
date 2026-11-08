import { randomUUID } from 'node:crypto';
import { predict, MODEL_VERSION, MODEL_EVIDENCE } from './model.js';

export function dayKey(now = Date.now(), timeZone = 'America/Mazatlan') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(x => x.type === k).value).join('-');
}

// Mercados soportados: línea de goles y mínimo de goles para acertar.
export const MARKETS = Object.freeze({ OVER_1_5: { line: 1.5, goals: 2 }, OVER_2_5: { line: 2.5, goals: 3 }, OVER_3_5: { line: 3.5, goals: 4 } });
// Ligas medidas con mal acierto en ese mercado (backtest): no entran en tickets.
export const MARKET_BLOCKED = Object.freeze({ OVER_1_5: ['PD', 'SA'], OVER_2_5: [], OVER_3_5: [] });
// "El arriesgado del día": 2 over 3.5 + 2 over 2.5 con los partidos que no usan
// los tickets normales. Mínimos por selección según backtest 2022-2026 (30 ligas):
// over 3.5 ≥0.40 acertó 42.1% (3246 sel.); over 2.5 ≥0.65 ~61-65%. Ticket ≈ 1 de cada 12.
export const RISKY = Object.freeze({ name: 'El arriesgado del día', OVER_3_5: { picks: 2, min: 0.4 }, OVER_2_5: { picks: 2, min: 0.65 } });

export function riskyTicket(fixtures, history, { now, usedIds, number }) {
  const used = new Set(usedIds), selections = [];
  for (const market of ['OVER_3_5', 'OVER_2_5']) {
    const { picks, min } = RISKY[market], line = MARKETS[market].line;
    const ranked = fixtures.filter(f => !used.has(f.id) && !MARKET_BLOCKED[market].includes(f.league.id))
      .map(f => ({ match: f, prediction: predict(f, history, { asOf: now, line }) }))
      .filter(x => x.prediction.eligible && x.prediction.probability >= min)
      .sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id))
      .slice(0, picks);
    if (ranked.length < picks) return null;
    for (const x of ranked) { used.add(x.match.id); selections.push({ ...x, market, result: 'pending', score: null }); }
  }
  return { id: randomUUID(), number, kind: 'risky', name: RISKY.name, status: 'pending', selections,
    probability: selections.reduce((p, x) => p * x.prediction.probability, 1) };
}

export function generateBatch(snapshot, { now = Date.now(), timeZone, minProbability = 0.65, mode = 'live', excludedIds = [],
  market = 'OVER_2_5', legs = 4, evidence = null, risky = false } = {}) {
  if (!Number.isFinite(minProbability) || minProbability < 0.5 || minProbability > 0.95) throw new Error('Umbral inválido');
  if (!MARKETS[market] || ![4, 6].includes(legs)) throw new Error('Mercado o tamaño de ticket inválido');
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
    const prediction = predict(f, snapshot.history, { asOf: now, line });
    if (!prediction.eligible || prediction.probability < minProbability) {
      rejections.push({ matchId: f.id, reason: prediction.reason ?? 'Probabilidad inferior al umbral' });
      continue;
    }
    candidates.push({ match: f, prediction, market, result: 'pending', score: null });
  }
  candidates.sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id));
  const count = Math.min(4, Math.floor(candidates.length / legs));
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
  // Ticket arriesgado opcional, con partidos que no usaron los tickets normales.
  const extra = risky ? riskyTicket(window, snapshot.history, {
    now, number: tickets.length + 1, usedIds: tickets.flatMap(t => t.selections.map(x => x.match.id)) }) : null;
  return {
    id: randomUUID(), day: dayKey(now, timeZone), mode,
    createdAt: new Date(now).toISOString(), sourceUpdatedAt: snapshot.fetchedAt,
    source: snapshot.source, modelVersion: MODEL_VERSION, minProbability, market, line, legs,
    // La evidencia solo describe al modelo con el mismo mercado y umbral con que se midió.
    ...(evidence && evidence.threshold === minProbability && evidence.market === market ? { evidence }
      : market === 'OVER_2_5' && minProbability === MODEL_EVIDENCE.threshold ? { evidence: MODEL_EVIDENCE } : {}),
    tickets: extra ? [...tickets, extra] : tickets, eligibleMatches: candidates.length, missingMatches: Math.max(0, 4 * legs - candidates.length),
    rejections, warnings: [
      ...(snapshot.warnings ?? []),
      ...(mode === 'demo' ? ['DEMOSTRACIÓN: equipos, resultados y probabilidades sintéticos.'] : []),
      'Probabilidades estimadas solo con marcadores históricos; sin garantía de ganancias.',
      'Probabilidad del ticket calculada suponiendo independencia; pueden existir correlaciones.',
      'Sin cuotas actuales: no se calcula valor esperado ni rentabilidad.',
      ...(extra ? [`${RISKY.name}: 2 over 3.5 y 2 over 2.5, probabilidad conjunta estimada ${Math.round(extra.probability * 100)}%. Alto riesgo.`] : [])
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
