import test from 'node:test';
import assert from 'node:assert/strict';
import { over25, predict, MODEL_EVIDENCE } from '../src/model.js';
import { generateBatch, dayKey, resultOf, ticketStatus } from '../src/tickets.js';
import { demoSnapshot } from '../src/demo.js';

const now = Date.parse('2026-11-05T17:00:00Z');
test('Poisson calcula P(goles >= 3) y es creciente', () => {
  assert.equal(over25(0), 0);
  assert.ok(Math.abs(over25(3) - 0.5768099188731565) < 1e-10);
  assert.ok(over25(4) > over25(3));
  assert.throws(() => over25(NaN));
});
test('modelo ignora resultados futuros, duplicados y el propio partido', () => {
  const s = demoSnapshot(now), f = s.fixtures[0];
  const expected = predict(f, s.history, { asOf: now });
  const contaminated = [...s.history, ...s.history, ...s.history.map((m, i) => ({
    ...m, id: `future-${i}`, availableAt: new Date(now + 1).toISOString(), homeGoals: 0, awayGoals: 0
  })), { ...s.history[0], id: f.id, homeGoals: 0, awayGoals: 0 }];
  assert.deepEqual(predict(f, contaminated, { asOf: now }), expected);
  assert.equal(expected.eligible, true);
  assert.equal(expected.calibrated, false);
});
test('modelo rechaza muestras pequeñas, datos antiguos y contexto excluido', () => {
  const s = demoSnapshot(now), f = s.fixtures[0];
  assert.equal(predict(f, s.history.slice(0, 4), { asOf: now }).eligible, false);
  assert.equal(predict({ ...f, contextRisk: true }, s.history, { asOf: now }).eligible, false);
  assert.equal(predict({ ...f, kickoff: new Date(now - 1).toISOString() }, s.history, { asOf: now }).eligible, false);
  const old = s.history.map(m => ({ ...m, kickoff: new Date(now - 180 * 86400000).toISOString() }));
  assert.equal(predict(f, old, { asOf: now }).eligible, false);
});
test('cuatro tickets completos, solo over 2.5 y dieciséis partidos únicos', () => {
  const snapshot = demoSnapshot(now);
  snapshot.fixtures.push(...snapshot.fixtures);
  const batch = generateBatch(snapshot, { now });
  assert.equal(batch.tickets.length, 4);
  const picks = batch.tickets.flatMap(t => t.selections);
  assert.equal(new Set(picks.map(p => p.match.id)).size, 16);
  assert.equal(new Set(batch.tickets.map(t => t.id)).size, 4);
  for (const ticket of batch.tickets) {
    assert.equal(ticket.selections.length, 4);
    assert.equal(ticket.probability, ticket.selections.reduce((p, s) => p * s.prediction.probability, 1));
    assert.ok(ticket.selections.every(p => p.market === 'OVER_2_5' && p.prediction.probability >= .65));
  }
});
test('incluye la evidencia medida solo con su mismo umbral', () => {
  const snapshot = demoSnapshot(now);
  assert.deepEqual(generateBatch(snapshot, { now }).evidence, MODEL_EVIDENCE);
  assert.equal(generateBatch(snapshot, { now, minProbability: 0.7 }).evidence, undefined);
  assert.ok(MODEL_EVIDENCE.hitRate > 0 && MODEL_EVIDENCE.hitRate < 1 && MODEL_EVIDENCE.picks > 0);
});
test('no rellena tickets con partidos malos y no reutiliza partidos anteriores', () => {
  const snapshot = demoSnapshot(now);
  const batch = generateBatch(snapshot, { now });
  const excludedIds = batch.tickets.flatMap(t => t.selections.map(p => p.match.id));
  const next = generateBatch(snapshot, { now, excludedIds });
  assert.equal(next.tickets.length, 0);
  assert.equal(next.missingMatches, 14);
  assert.equal(generateBatch({ ...snapshot, fixtures: snapshot.fixtures.slice(0, 3) }, { now }).tickets.length, 0);
  assert.throws(() => generateBatch({ ...snapshot, fetchedAt: new Date(now - 7 * 3600000).toISOString() }, { now }), /desactualizados/);
});
test('día de Mazatlán sigue la zona local y no el UTC', () => {
  assert.equal(dayKey(Date.parse('2026-11-06T02:00:00Z')), '2026-11-05');
});
test('liquidación exige resultados finales, no goles en vivo', () => {
  const score = { homeGoals: 2, awayGoals: 1 };
  assert.equal(resultOf({ ...score, status: 'IN_PLAY' }).result, 'pending');
  assert.equal(resultOf({ ...score, status: 'FINISHED' }).result, 'won');
  assert.equal(resultOf({ homeGoals: 1, awayGoals: 1, status: 'FINISHED' }).result, 'lost');
  assert.equal(resultOf({ homeGoals: null, awayGoals: 2, status: 'FINISHED' }).result, 'review');
  assert.equal(resultOf({ status: 'POSTPONED' }).result, 'review');
  assert.equal(ticketStatus(['won', 'won', 'won', 'pending']), 'pending');
  assert.equal(ticketStatus(['won', 'won', 'won', 'review']), 'review');
  assert.equal(ticketStatus(['won', 'won', 'won', 'lost']), 'lost');
  assert.equal(ticketStatus(['won', 'won', 'won', 'won']), 'won');
});

test('over 1.5: Poisson, resultado y tickets de 6 partidos', async () => {
  const { overLine } = await import('../src/model.js');
  assert.ok(Math.abs(overLine(2, 1.5) - (1 - Math.exp(-2) * 3)) < 1e-12);
  assert.equal(overLine(3, 2.5), over25(3));
  assert.throws(() => overLine(2, 3.5), /no soportada/);
  assert.deepEqual(resultOf({ status: 'FINISHED', homeGoals: 1, awayGoals: 1 }, 'OVER_1_5'), { result: 'won', score: '1–1' });
  assert.deepEqual(resultOf({ status: 'FINISHED', homeGoals: 1, awayGoals: 1 }, 'OVER_2_5'), { result: 'lost', score: '1–1' });
  assert.equal(resultOf({ status: 'FINISHED', homeGoals: 1, awayGoals: 0 }, 'OVER_1_5').result, 'lost');
  const now = Date.parse('2026-11-05T17:00:00Z'), snapshot = demoSnapshot(now);
  const f = snapshot.fixtures[0];
  const p15 = predict(f, snapshot.history, { asOf: now, line: 1.5 }), p25 = predict(f, snapshot.history, { asOf: now });
  assert.ok(p15.probability > p25.probability);
  assert.equal(p15.line, 1.5);
  const batch = generateBatch(snapshot, { now, market: 'OVER_1_5', legs: 6, minProbability: 0.5 });
  assert.ok(batch.tickets.length >= 1);
  assert.ok(batch.tickets.every(t => t.selections.length === 6 && t.selections.every(s => s.market === 'OVER_1_5')));
  assert.deepEqual([batch.market, batch.line, batch.legs], ['OVER_1_5', 1.5, 6]);
  assert.equal(batch.missingMatches, Math.max(0, 24 - batch.eligibleMatches));
  assert.throws(() => generateBatch(snapshot, { now, legs: 5 }), /inválido/);
  // Ligas con bajo acierto medido en over 1.5 no entran.
  const blocked = { ...snapshot, fixtures: snapshot.fixtures.map(x => ({ ...x, league: { ...x.league, id: 'SA' } })),
    history: snapshot.history.map(x => ({ ...x, league: { ...x.league, id: 'SA' } })) };
  const none = generateBatch(blocked, { now, market: 'OVER_1_5', legs: 6, minProbability: 0.5 });
  assert.equal(none.tickets.length, 0);
  assert.ok(none.rejections.every(r => /bajo acierto/.test(r.reason)));
});
