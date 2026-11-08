import { randomUUID } from 'node:crypto';
import { predict, MODEL_VERSION, MODEL_EVIDENCE } from './model.js';

export function dayKey(now = Date.now(), timeZone = 'America/Mazatlan') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(x => x.type === k).value).join('-');
}

// Mercados soportados: línea de goles y mínimo de goles para acertar.
export const MARKETS = Object.freeze({ OVER_1_5: { line: 1.5, goals: 2 }, OVER_2_5: { line: 2.5, goals: 3 } });
// Ligas medidas con mal acierto en ese mercado (backtest): no entran en tickets.
export const MARKET_BLOCKED = Object.freeze({ OVER_1_5: ['PD', 'SA'], OVER_2_5: [] });

export function generateBatch(snapshot, { now = Date.now(), timeZone, minProbability = 0.65, mode = 'live', excludedIds = [],
  market = 'OVER_2_5', legs = 4, evidence = null } = {}) {
  if (!Number.isFinite(minProbability) || minProbability < 0.5 || minProbability > 0.95) throw new Error('Umbral inválido');
  if (!MARKETS[market] || ![4, 6].includes(legs)) throw new Error('Mercado o tamaño de ticket inválido');
  const { line } = MARKETS[market];
  const age = now - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 6 * 3_600_000) throw new Error('Datos desactualizados');
  const seen = new Set(excludedIds), candidates = [], rejections = [];
  for (const f of snapshot.fixtures) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (Date.parse(f.kickoff) < now + 3_600_000 || Date.parse(f.kickoff) > now + 72 * 3_600_000) continue;
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
  return {
    id: randomUUID(), day: dayKey(now, timeZone), mode,
    createdAt: new Date(now).toISOString(), sourceUpdatedAt: snapshot.fetchedAt,
    source: snapshot.source, modelVersion: MODEL_VERSION, minProbability, market, line, legs,
    // La evidencia solo describe al modelo con el mismo mercado y umbral con que se midió.
    ...(evidence && evidence.threshold === minProbability && evidence.market === market ? { evidence }
      : market === 'OVER_2_5' && minProbability === MODEL_EVIDENCE.threshold ? { evidence: MODEL_EVIDENCE } : {}),
    tickets, eligibleMatches: candidates.length, missingMatches: Math.max(0, 4 * legs - candidates.length),
    rejections, warnings: [
      ...(snapshot.warnings ?? []),
      ...(mode === 'demo' ? ['DEMOSTRACIÓN: equipos, resultados y probabilidades sintéticos.'] : []),
      'Probabilidades estimadas solo con marcadores históricos; sin garantía de ganancias.',
      'Probabilidad del ticket calculada suponiendo independencia; pueden existir correlaciones.',
      'Sin cuotas actuales: no se calcula valor esperado ni rentabilidad.'
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

export function ticketStatus(results) {
  if (results.length !== 4) return 'review';
  if (results.includes('lost')) return 'lost';
  if (results.every(r => r === 'won')) return 'won';
  if (results.includes('review')) return 'review';
  return 'pending';
}
