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
test('tickets de 3 partidos por defecto: 4 × 3 sin repetir', () => {
  const batch = generateBatch(demoSnapshot(now), { now });
  assert.equal(batch.legs, 3);
  assert.deepEqual(batch.tickets.map(t => t.selections.length), [3, 3, 3, 3]);
  assert.equal(new Set(batch.tickets.flatMap(t => t.selections.map(s => s.match.id))).size, 12);
});
test('cuatro tickets completos, solo over 2.5 y dieciséis partidos únicos', () => {
  const snapshot = demoSnapshot(now);
  snapshot.fixtures.push(...snapshot.fixtures);
  const batch = generateBatch(snapshot, { now, legs: 4 });
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
  const batch = generateBatch(snapshot, { now, legs: 4 });
  const excludedIds = batch.tickets.flatMap(t => t.selections.map(p => p.match.id));
  const next = generateBatch(snapshot, { now, legs: 4, excludedIds });
  assert.equal(next.tickets.length, 0);
  assert.equal(next.missingMatches, 14);
  assert.equal(generateBatch({ ...snapshot, fixtures: snapshot.fixtures.slice(0, 3) }, { now, legs: 4 }).tickets.length, 0);
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
  assert.throws(() => overLine(2, 4.5), /no soportada/);
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

test('La soñadora: 6 over 2.5 sin repetir partidos de los normales', async () => {
  const { dreamerTicket, DREAMER } = await import('../src/tickets.js');
  const now = Date.parse('2026-11-05T17:00:00Z'), snapshot = demoSnapshot(now);
  // Con los normales llenos (4 × 4 de 20 partidos) quedan 4 libres: no se fuerza.
  const full = generateBatch(snapshot, { now, legs: 4, minProbability: 0.5, dreamer: true });
  assert.equal(full.tickets.some(t => t.kind === 'dreamer'), false);
  // Un solo ticket normal deja partidos libres para La soñadora.
  const batch = generateBatch(snapshot, { now, minProbability: 0.5, maxTickets: 1, dreamer: true });
  const dreamer = batch.tickets.find(t => t.kind === 'dreamer');
  const normal = batch.tickets.filter(t => t.kind !== 'dreamer');
  const normalIds = new Set(normal.flatMap(t => t.selections.map(s => s.match.id)));
  assert.equal(normal.length, 1);
  assert.ok(dreamer);
  assert.equal(dreamer.name, DREAMER.name);
  assert.deepEqual(dreamer.selections.map(s => s.market), Array(6).fill('OVER_2_5'));
  assert.ok(dreamer.selections.every(s => !normalIds.has(s.match.id) && s.prediction.probability >= DREAMER.min));
  assert.equal(new Set(dreamer.selections.map(s => s.match.id)).size, 6);
  assert.equal(dreamer.number, 2);
  assert.ok(Math.abs(dreamer.probability - dreamer.selections.reduce((p, s) => p * s.prediction.probability, 1)) < 1e-12);
  assert.ok(batch.warnings.some(w => w.startsWith(DREAMER.name)));
  assert.equal(batch.maxTickets, 1);
  // Sin candidatos suficientes no se fuerza el ticket; apagada no aparece.
  assert.equal(dreamerTicket(snapshot.fixtures.slice(0, 5), snapshot.history, { now, usedIds: [], number: 1 }), null);
  assert.equal(generateBatch(snapshot, { now, minProbability: 0.5, maxTickets: 1 }).tickets.some(t => t.kind === 'dreamer'), false);
  assert.throws(() => generateBatch(snapshot, { now, maxTickets: 5 }), /Número de tickets/);
  // Normales en 0.65; La soñadora acepta desde DREAMER.min (0.60), también con el modelo de forma.
  assert.ok(DREAMER.min < 0.62);
  const form = (id, goals) => ({ id: `af-${id}`, league: { id: 'af-9', name: 'Liga X' }, home: { id: `h${id}`, name: `H${id}` }, away: { id: `a${id}`, name: `A${id}` },
    kickoff: new Date(now + 5 * 3_600_000).toISOString(), status: 'TIMED',
    formFeatures: { homePlayed: 8, awayPlayed: 8, homeFor: goals / 2, homeAgainst: goals / 2, awayFor: goals / 2, awayAgainst: goals / 2,
      homeLast5For: goals / 2, homeLast5Against: goals / 2, awayLast5For: goals / 2, awayLast5Against: goals / 2 } });
  // Goles esperados entre 3 y 4: busca una forma que dé entre 0.62 y 0.65 en over 2.5.
  const { formPredict } = await import('../src/apifootball.js');
  const goals = Array.from({ length: 40 }, (_, i) => 3 + i * 0.025).find(g => { const p = formPredict(form(0, g), form(0, g).formFeatures, { line: 2.5, asOf: now }).probability; return p >= 0.62 && p < 0.65; });
  assert.ok(goals, 'hay un partido entre 0.62 y 0.65');
  const mid = Array.from({ length: 6 }, (_, i) => form(i + 1, goals));
  const midBatch = generateBatch({ ...snapshot, fixtures: mid }, { now, minProbability: 0.65, maxTickets: 3, dreamer: true });
  assert.equal(midBatch.tickets.filter(t => t.kind !== 'dreamer').length, 0); // ninguno llega a 0.65
  assert.equal(midBatch.tickets.find(t => t.kind === 'dreamer')?.selections.length, 6);
  assert.deepEqual(resultOf({ status: 'FINISHED', homeGoals: 2, awayGoals: 2 }, 'OVER_3_5'), { result: 'won', score: '2–2' });
  assert.equal(resultOf({ status: 'FINISHED', homeGoals: 2, awayGoals: 1 }, 'OVER_3_5').result, 'lost');
});
test('sameDay: solo partidos del día de la tanda en hora de Mazatlán', async () => {
  const { dayStart } = await import('../src/tickets.js');
  const tz = 'America/Mazatlan';
  assert.equal(new Date(dayStart('2026-11-16', tz)).toISOString(), '2026-11-16T07:00:00.000Z');
  assert.equal(new Date(dayStart('2026-07-01', 'Europe/Madrid')).toISOString(), '2026-06-30T22:00:00.000Z');
  // 10:00 de Mazatlán: el día termina a las 07:00 UTC siguientes (en 14 h).
  const now = Date.parse('2026-11-05T17:00:00Z'), snapshot = demoSnapshot(now);
  const end = dayStart('2026-11-06', tz);
  const batch = generateBatch(snapshot, { now, timeZone: tz, minProbability: 0.5, sameDay: true, dreamer: true });
  const kicks = batch.tickets.flatMap(t => t.selections.map(s => Date.parse(s.match.kickoff)));
  assert.ok(kicks.length > 0 && kicks.every(k => k >= now + 3_600_000 && k < end));
  assert.equal(batch.sameDay, true);
  const wide = generateBatch(snapshot, { now, timeZone: tz, minProbability: 0.5, dreamer: true });
  assert.ok(wide.tickets.flatMap(t => t.selections).some(s => Date.parse(s.match.kickoff) >= end));
  // A las 23:45 se genera la tanda de mañana: entran partidos de mañana, no los de esta noche.
  const late = Date.parse('2026-11-16T06:45:00Z');
  const fx = (id, iso) => ({ ...snapshot.fixtures[id], id: `x-${id}`, kickoff: iso });
  const lateSnap = { ...demoSnapshot(late), fixtures: [fx(0, '2026-11-16T06:59:00Z'), fx(1, '2026-11-16T08:00:00Z'), fx(2, '2026-11-17T06:59:00Z'), fx(3, '2026-11-17T07:30:00Z')] };
  const lb = generateBatch(lateSnap, { now: late, timeZone: tz, day: '2026-11-16', minProbability: 0.5, legs: 3, sameDay: true });
  // Solo x-1 (01:00 del 16) y x-2 (23:59 del 16) entran a la ventana: elegibles o rechazados.
  assert.equal(lb.eligibleMatches + lb.rejections.length, 2);
  assert.ok(lb.rejections.every(r => ['x-1', 'x-2'].includes(r.matchId)));
});
test('tickets escalonados: 0.65 / 0.63 / 0.62 y La soñadora desde 0.60', async () => {
  const { DREAMER } = await import('../src/tickets.js');
  const { formPredict } = await import('../src/apifootball.js');
  assert.equal(DREAMER.min, 0.6);
  const now = Date.parse('2026-11-05T17:00:00Z'), base = demoSnapshot(now);
  const kick = new Date(now + 5 * 3_600_000).toISOString();
  const form = (id, g) => ({ id: `af-${id}`, league: { id: 'af-9', name: 'Liga X' }, home: { id: `h${id}`, name: `H${id}` },
    away: { id: `a${id}`, name: `A${id}` }, kickoff: kick, status: 'TIMED',
    formFeatures: { homePlayed: 8, awayPlayed: 8, homeFor: g / 2, homeAgainst: g / 2, awayFor: g / 2, awayAgainst: g / 2,
      homeLast5For: g / 2, homeLast5Against: g / 2, awayLast5For: g / 2, awayLast5Against: g / 2 } });
  const prob = g => formPredict(form(0, g), form(0, g).formFeatures, { line: 2.5, asOf: now }).probability;
  // Goles esperados que caen en cada franja de probabilidad.
  const grid = Array.from({ length: 200 }, (_, i) => 2.8 + i * 0.01);
  const pick = (lo, hi) => grid.find(g => prob(g) >= lo && prob(g) < hi);
  const bands = { a: pick(0.66, 0.7), b: pick(0.635, 0.645), c: pick(0.622, 0.628), d: pick(0.6, 0.61) };
  assert.ok(Object.values(bands).every(Boolean));
  let n = 0;
  const make = (g, k) => Array.from({ length: k }, () => form(n++, g));
  const snapshot = { ...base, fixtures: [...make(bands.a, 3), ...make(bands.b, 3), ...make(bands.c, 3), ...make(bands.d, 6)] };
  const batch = generateBatch(snapshot, { now, minProbability: 0.65, legs: 3, dreamer: true, ticketThresholds: [0.65, 0.63, 0.62] });
  const normal = batch.tickets.filter(t => t.kind !== 'dreamer'), dreamer = batch.tickets.find(t => t.kind === 'dreamer');
  assert.deepEqual(normal.map(t => t.threshold), [0.65, 0.63, 0.62]);
  normal.forEach(t => assert.ok(t.selections.every(s => s.prediction.probability >= t.threshold)));
  assert.ok(normal[0].probability > normal[1].probability && normal[1].probability > normal[2].probability);
  assert.ok(dreamer && dreamer.selections.every(s => s.prediction.probability >= 0.6 && s.prediction.probability < 0.62));
  assert.deepEqual(batch.ticketThresholds, [0.65, 0.63, 0.62]);
  // Sin partidos de 0.65, el primer nivel se salta y los demás se forman (numerados 1, 2).
  const low = generateBatch({ ...base, fixtures: [...make(bands.b, 3), ...make(bands.c, 3)] },
    { now, minProbability: 0.65, legs: 3, ticketThresholds: [0.65, 0.63, 0.62] });
  assert.deepEqual(low.tickets.map(t => [t.number, t.threshold]), [[1, 0.63], [2, 0.62]]);
  assert.throws(() => generateBatch(snapshot, { now, ticketThresholds: [0.4] }), /Umbrales por ticket/);
});
