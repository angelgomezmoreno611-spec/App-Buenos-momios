import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBatch, activeTickets, statusNotice, newBatchNotice, dayStart, addDays } from '../src/tickets.js';
import { runJob } from '../src/jobs.js';
import { demoSnapshot } from '../src/demo.js';

const tz = 'America/Mazatlan', DAY = 86_400_000;
const sel = (id, kickoff, result = 'pending') => ({ match: { id, kickoff }, result });
const ticket = (number, status, kickoffs, extra = {}) => ({ id: `t${number}`, number, status, selections: kickoffs.map((k, i) => sel(`${number}-${i}`, k)), ...extra });

test('days: la tanda abarca de 1 a 7 días locales desde el día de la tanda', () => {
  const now = Date.parse('2026-11-21T06:45:00Z'), snapshot = demoSnapshot(now); // 23:45 del 20 en Mazatlán
  const fx = (i, iso) => ({ ...snapshot.fixtures[i], id: `x-${i}`, kickoff: iso });
  // 21 (día de la tanda), 27 (7.º día) y 28 (fuera) a las 12:00 locales.
  const fixtures = [fx(0, '2026-11-21T19:00:00Z'), fx(1, '2026-11-27T19:00:00Z'), fx(2, '2026-11-28T19:00:00Z'), fx(3, '2026-11-21T06:30:00Z')];
  const window = days => {
    const b = generateBatch({ ...snapshot, fixtures }, { now, timeZone: tz, day: '2026-11-21', minProbability: 0.5, legs: 3, days });
    return b.eligibleMatches + b.rejections.length; // partidos dentro de la ventana
  };
  assert.equal(window(7), 2); // x-0 y x-1; x-2 (día 8) y x-3 (antes de la tanda) quedan fuera
  assert.equal(window(1), 1);
  const b = generateBatch({ ...snapshot, fixtures }, { now, timeZone: tz, day: '2026-11-21', minProbability: 0.5, legs: 3, days: 7 });
  assert.equal(b.days, 7);
  assert.equal(b.until, '2026-11-27');
  assert.equal(new Date(dayStart(addDays('2026-11-21', 7), tz)).toISOString(), '2026-11-28T07:00:00.000Z');
  assert.throws(() => generateBatch(snapshot, { now, days: 8 }), /Días/);
});

test('tickets activos: pendientes o en revisión hasta 4 días después de su último partido', () => {
  const now = Date.parse('2026-11-24T06:45:00Z'), iso = t => new Date(t).toISOString();
  const batch = { tickets: [
    ticket(1, 'pending', [iso(now + DAY)]),
    ticket(2, 'lost', [iso(now + DAY)]),
    ticket(3, 'won', [iso(now - DAY)]),
    ticket(4, 'review', [iso(now - 5 * DAY)], { kind: 'dreamer', name: 'La soñadora' }), // atorado: ya no bloquea
    ticket(5, 'review', [iso(now - DAY)])
  ] };
  assert.deepEqual(activeTickets(batch, now).map(t => t.number), [1, 5]);
  assert.deepEqual(activeTickets(null, now), []);
});

test('aviso diario: qué tickets siguen activos, ganados y perdidos', () => {
  const now = Date.parse('2026-11-24T06:45:00Z'), soon = new Date(now + DAY).toISOString();
  const all = { tickets: [1, 2, 3].map(n => ticket(n, 'pending', [soon])).concat(ticket(4, 'pending', [soon], { kind: 'dreamer', name: 'La soñadora' })) };
  assert.deepEqual(statusNotice(all, now), { title: 'Todos tus tickets siguen activos ✅',
    body: 'Siguen activos: ticket 1, ticket 2, ticket 3 y La soñadora. No se ha perdido ningún partido.' });
  const some = { tickets: [ticket(1, 'pending', [soon]), ticket(2, 'lost', [soon]), ticket(3, 'pending', [soon]), ticket(4, 'won', [soon])] };
  assert.deepEqual(statusNotice(some, now), { title: '2 de 4 tickets siguen activos',
    body: 'Siguen activos: ticket 1 y ticket 3. Ganado: ticket 4. Perdido: 1.' });
});

test('aviso de tanda nueva: días de los partidos y resumen de la anterior', () => {
  const batch = { day: '2026-11-21', tickets: [
    ticket(1, 'pending', ['2026-11-21T19:00:00Z', '2026-11-24T03:00:00Z']), ticket(2, 'pending', ['2026-11-26T19:00:00Z'])] };
  const previous = { tickets: [ticket(1, 'lost', []), ticket(2, 'won', [])] };
  // 03:00 UTC del 24 = 20:00 del 23 en Mazatlán.
  assert.deepEqual(newBatchNotice(batch, previous, tz), { title: 'Tus nuevos tickets ya están listos 🎟️',
    body: 'Tu tanda anterior terminó con 1 ticket ganado. 2 tickets nuevos. Partidos del 21/11 al 26/11.' });
  assert.equal(newBatchNotice(batch, { tickets: [ticket(1, 'lost', [])] }, tz).body.startsWith('Tus tickets anteriores ya se resolvieron.'), true);
  assert.equal(newBatchNotice({ day: '2026-11-21', tickets: [] }, null, tz).title, 'Sin tickets nuevos por ahora');
});

function fakeRepo(latest) {
  const calls = { notices: [], published: null, delivered: 0 };
  const repo = { calls, acquireLock: async () => 'l', releaseLock: async () => {}, getBatch: async () => null, usedMatches: async () => [],
    history: async () => [], latestBatch: async () => latest,
    publish: async b => { calls.published = b; return b.id; },
    enqueueNotice: async (key, batchId, notice) => { calls.notices.push({ key, batchId, ...notice }); return 1; },
    claimNotifications: async () => { calls.delivered++; return []; } };
  return repo;
}

test('generate: con 2 tandas en 7 días solo avisa el estado de las que siguen en juego', async () => {
  const now = Date.parse('2026-11-24T06:45:00Z'), soon = new Date(now + DAY).toISOString(), past = new Date(now - DAY).toISOString();
  const a = { id: 'b-21', day: '2026-11-21', tickets: [ticket(1, 'pending', [soon]), ticket(2, 'lost', [past])] };
  const b = { id: 'b-22', day: '2026-11-22', tickets: [ticket(1, 'pending', [soon]), ticket(2, 'pending', [soon])] };
  const repo = { ...fakeRepo(null), batchesSince: async since => { assert.equal(since, '2026-11-12'); return [b, a]; } };
  const provider = { competitions: () => [], snapshot: async () => { throw new Error('no debe consultar partidos'); } };
  const out = await runJob('generate', { repo, provider, push: { configured: true }, now, timeZone: tz, legs: 3, days: 7, ticketThresholds: [0.67] });
  assert.equal(out.kept, true);
  assert.deepEqual(out.active, [{ day: '2026-11-22', tickets: [1, 2] }, { day: '2026-11-21', tickets: [1] }]);
  assert.equal(out.nextBatch, '2026-11-28'); // la del 21 sale de la semana el 28
  assert.equal(repo.calls.published, null);
  assert.deepEqual(repo.calls.notices.map(n => [n.key, n.batchId, n.title]), [['status:2026-11-24', 'b-22', '3 tickets siguen activos en 2 tandas']]);
  assert.equal(repo.calls.notices[0].body, 'Tanda del 22/11: Siguen activos: ticket 1 y ticket 2. No se ha perdido ningún partido.\nTanda del 21/11: Sigue activo: ticket 1. Perdido: 1.');
  assert.equal(repo.calls.delivered, 1); // se envía en la misma ejecución (23:45)
});

test('generate: sin cupo y sin tandas en juego avisa cuándo sale la próxima', async () => {
  const now = Date.parse('2026-11-24T06:45:00Z'), past = new Date(now - DAY).toISOString();
  const done = (id, day) => ({ id, day, tickets: [ticket(1, 'lost', [past])] });
  const repo = { ...fakeRepo(null), batchesSince: async () => [done('b-23', '2026-11-23'), done('b-20', '2026-11-20')] };
  const out = await runJob('generate', { repo, provider: {}, now, timeZone: tz, legs: 3, days: 7, ticketThresholds: [0.67] });
  assert.equal(out.nextBatch, '2026-11-27');
  assert.deepEqual(repo.calls.notices[0], { key: 'status:2026-11-24', batchId: 'b-23', title: 'Tus tickets ya se resolvieron',
    body: 'La próxima tanda sale el 27/11 (máximo 2 tandas por semana).' });
  // Con TICKET_WEEKLY_MAX = 3 sí habría tanda nueva (aquí falla al pedir partidos: prueba que lo intenta).
  await assert.rejects(runJob('generate', { repo, provider: { snapshot: async () => { throw new Error('genera'); } }, now, timeZone: tz, weeklyMax: 3 }), /genera/);
});

test('generate: con una sola tanda en la semana sale la segunda aunque la primera siga en juego', async () => {
  const now = Date.parse('2026-11-22T06:45:00Z'), snapshot = demoSnapshot(now);
  const a = { id: 'b-21', day: '2026-11-21', tickets: [ticket(1, 'pending', [new Date(now + 5 * DAY).toISOString()])] };
  const repo = { ...fakeRepo(null), batchesSince: async () => [a] };
  const out = await runJob('generate', { repo, provider: { competitions: () => [], snapshot: async () => snapshot }, now, timeZone: tz, legs: 3, days: 7,
    minProbability: 0.5, ticketThresholds: [0.5] });
  assert.equal(repo.calls.published.day, '2026-11-22');
  assert.equal(out.batchId, repo.calls.published.id);
  assert.match(repo.calls.notices[0].body, /^Sigue en juego tu tanda del 21\/11\. /);
});

test('generate crea tanda nueva de 7 días y la avisa cuando ya no queda ningún ticket activo', async () => {
  const now = Date.parse('2026-11-24T06:45:00Z'), snapshot = demoSnapshot(now);
  const latest = { id: 'b-old', day: '2026-11-21', tickets: [ticket(1, 'lost', [new Date(now).toISOString()]), ticket(2, 'won', [new Date(now).toISOString()])] };
  const repo = fakeRepo(latest);
  const provider = { competitions: () => [], snapshot: async () => snapshot };
  const out = await runJob('generate', { repo, provider, push: { configured: false }, now, timeZone: tz, legs: 3, days: 7,
    minProbability: 0.5, ticketThresholds: [0.5, 0.5, 0.5] });
  const batch = repo.calls.published;
  assert.equal(batch.days, 7);
  assert.equal(out.batchId, batch.id);
  assert.deepEqual(repo.calls.notices.map(n => n.key), [`new:${batch.id}`]);
  assert.equal(repo.calls.notices[0].title, 'Tus nuevos tickets ya están listos 🎟️');
  assert.match(repo.calls.notices[0].body, /^Tu tanda anterior terminó con 1 ticket ganado\./);
  assert.equal(repo.calls.delivered, 0); // sin Firebase no se intenta enviar
});

test('generate publica la tanda aunque falle la cola de avisos (sin migración 016)', async () => {
  const now = Date.parse('2026-11-24T06:45:00Z');
  const repo = { ...fakeRepo(null), enqueueNotice: async () => { throw new Error('Base de datos: HTTP 404'); } };
  const provider = { competitions: () => [], snapshot: async () => demoSnapshot(now) };
  const out = await runJob('generate', { repo, provider, now, timeZone: tz, legs: 3, days: 7, minProbability: 0.5, ticketThresholds: [0.5] });
  assert.ok(repo.calls.published);
  assert.deepEqual(out.notice, { error: 'Base de datos: HTTP 404' });
});

test('settle envía en la misma ejecución los avisos de ticket ganado', async () => {
  const sent = [];
  const repo = { acquireLock: async () => 'l', releaseLock: async () => {},
    pendingMatches: async () => [{ match_id: 'af-1', market: 'OVER_2_5' }],
    afResults: async () => [{ id: 'af-1', status: 'FINISHED', homeGoals: 2, awayGoals: 1 }],
    applyResults: async () => {},
    claimNotifications: async () => sent.length ? [] : [{ id: 'n1', lease: 'x', user_id: 'u', token: 'tok', ticket_id: 't3', attempts: 1 }],
    ownsDevice: async () => true, finishNotification: async (id, lease, status) => sent.push([id, status]) };
  const push = { configured: true, send: async () => 'sent' };
  const out = await runJob('settle', { repo, push, provider: { results: async () => [] } });
  assert.equal(out.checked, 1);
  assert.deepEqual(out.notified, { sent: 1, failed: 0 });
  assert.deepEqual(sent, [['n1', 'sent']]);
});
