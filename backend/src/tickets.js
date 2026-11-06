import { randomUUID } from 'node:crypto';
import { predict, MODEL_VERSION } from './model.js';

export function dayKey(now = Date.now(), timeZone = 'America/Mazatlan') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(x => x.type === k).value).join('-');
}

export function generateBatch(snapshot, { now = Date.now(), timeZone, minProbability = 0.65, mode = 'live', excludedIds = [] } = {}) {
  if (!Number.isFinite(minProbability) || minProbability < 0.5 || minProbability > 0.95) throw new Error('Umbral inválido');
  const age = now - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 6 * 3_600_000) throw new Error('Datos desactualizados');
  const seen = new Set(excludedIds), candidates = [], rejections = [];
  for (const f of snapshot.fixtures) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (Date.parse(f.kickoff) < now + 3_600_000 || Date.parse(f.kickoff) > now + 72 * 3_600_000) continue;
    const prediction = predict(f, snapshot.history, { asOf: now });
    if (!prediction.eligible || prediction.probability < minProbability) {
      rejections.push({ matchId: f.id, reason: prediction.reason ?? 'Probabilidad inferior al umbral' });
      continue;
    }
    candidates.push({ match: f, prediction, market: 'OVER_2_5', result: 'pending', score: null });
  }
  candidates.sort((a, b) => b.prediction.probability - a.prediction.probability || a.match.id.localeCompare(b.match.id));
  const count = Math.min(4, Math.floor(candidates.length / 4));
  const tickets = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(), number: i + 1, status: 'pending', selections: [], probability: 1
  }));
  // Distribuye el riesgo entre los tickets sin reutilizar partidos.
  for (const pick of candidates.slice(0, count * 4)) {
    const ticket = tickets.filter(t => t.selections.length < 4)
      .sort((a, b) => b.probability - a.probability || a.number - b.number)[0];
    ticket.selections.push(pick);
    ticket.probability *= pick.prediction.probability;
  }
  return {
    id: randomUUID(), day: dayKey(now, timeZone), mode,
    createdAt: new Date(now).toISOString(), sourceUpdatedAt: snapshot.fetchedAt,
    source: snapshot.source, modelVersion: MODEL_VERSION, minProbability,
    tickets, eligibleMatches: candidates.length, missingMatches: Math.max(0, 16 - candidates.length),
    rejections, warnings: [
      ...(snapshot.warnings ?? []),
      ...(mode === 'demo' ? ['DEMOSTRACIÓN: equipos, resultados y probabilidades sintéticos.'] : []),
      'Modelo inicial sin calibrar: probabilidades estimadas, sin garantía de ganancias.',
      'Probabilidad del ticket calculada suponiendo independencia; pueden existir correlaciones.',
      'Sin cuotas actuales: no se calcula valor esperado ni rentabilidad.'
    ]
  };
}

export function resultOf(match) {
  if (!match) return { result: 'pending', score: null };
  if (match.status === 'FINISHED') {
    if (!Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals) || match.homeGoals < 0 || match.awayGoals < 0) {
      return { result: 'review', score: null };
    }
    return { result: match.homeGoals + match.awayGoals >= 3 ? 'won' : 'lost', score: `${match.homeGoals}–${match.awayGoals}` };
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
