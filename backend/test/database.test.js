import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { demoBatch } from '../src/demo.js';

let db;
const userA = '11a25e21-0be8-43b5-8f2f-be26735ff824';
const userB = '22a25e21-0be8-43b5-8f2f-be26735ff824';
async function testDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    insert into auth.users(id) values ('${userA}'), ('${userB}');
  `);
  return database;
}
before(async () => {
  db = await testDatabase();
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
});
after(async () => { await db?.close(); });
const publish = batch => db.query('select public.publish_batch($1::jsonb) id', [JSON.stringify(batch)]);

test('PostgreSQL publica 4x4 atómicamente y no reutiliza partidos entre días', async () => {
  const batch = demoBatch(); batch.mode = 'live';
  const result = await publish(batch);
  assert.equal(result.rows[0].id, batch.id);
  assert.equal((await db.query('select count(*)::int n from public.selections')).rows[0].n, 16);
  assert.equal((await publish({ ...batch, id: randomUUID() })).rows[0].id, batch.id);
  const tomorrow = structuredClone(batch);
  tomorrow.id = randomUUID(); tomorrow.day = '2099-01-02';
  tomorrow.tickets.forEach(t => { t.id = randomUUID(); });
  await assert.rejects(publish(tomorrow), /unique constraint/);
  assert.equal((await db.query('select count(*)::int n from public.batches')).rows[0].n, 1);
});
test('PostgreSQL crea avisos solo con cuatro aciertos y resiste tareas repetidas', async () => {
  const { rows: [stored] } = await db.query('select payload from public.batches limit 1');
  const batch = stored.payload, ticket = batch.tickets[0];
  await db.query('select public.subscribe_device($1,$2,$3,$4)', [userA, batch.id, 'test-device-token-123456789', 'android']);
  const wins = ticket.selections.map(s => ({ matchId: s.match.id, result: 'won', score: '2–1' }));
  await db.query('select public.apply_results($1)', [JSON.stringify(wins.slice(0, 3))]);
  assert.equal((await db.query('select count(*)::int n from public.notification_outbox')).rows[0].n, 0);
  await db.query('select public.apply_results($1)', [JSON.stringify(wins)]);
  await db.query('select public.apply_results($1)', [JSON.stringify(wins)]);
  assert.equal((await db.query('select status from public.tickets where id=$1', [ticket.id])).rows[0].status, 'won');
  assert.equal((await db.query('select count(*)::int n from public.notification_outbox')).rows[0].n, 1);
  const claimed = await db.query('select * from public.claim_notifications()');
  assert.equal(claimed.rows.length, 1);
  assert.equal((await db.query('select * from public.claim_notifications()')).rows.length, 0);
});
test('guardar es idempotente, no activa avisos y rechaza tandas inexistentes', async () => {
  const { rows: [batch] } = await db.query('select id from public.batches limit 1');
  const save = id => db.query('select public.save_batch($1,$2) saved', [userB, id]);
  // La API opera con service_role; no debe necesitar los privilegios de postgres.
  await db.exec('set role service_role');
  try {
    assert.equal((await save(batch.id)).rows[0].saved, true);
    assert.equal((await save(batch.id)).rows[0].saved, true);
    assert.equal((await save(randomUUID())).rows[0].saved, false);
  } finally { await db.exec('reset role'); }
  assert.equal((await db.query('select count(*)::int n from public.saved_batches where user_id=$1', [userB])).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from public.batch_subscriptions where user_id=$1', [userB])).rows[0].n, 0);
  // Suscribirse a los avisos sigue guardando la tanda automáticamente.
  assert.equal((await db.query('select count(*)::int n from public.saved_batches where user_id=$1', [userA])).rows[0].n, 1);
});
test('RLS permite al usuario leer solo sus suscripciones y bloquea escrituras', async () => {
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.batches'), /permission denied/);
  await assert.rejects(db.query('select public.acquire_job_lock()'), /permission denied/);
  await assert.rejects(db.query('select * from public.saved_batches'), /permission denied/);
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userB]);
  assert.equal((await db.query('select * from public.batch_subscriptions')).rows.length, 0);
  const saved = await db.query('select * from public.saved_batches');
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].user_id, userB);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userA]);
  assert.equal((await db.query('select * from public.batch_subscriptions')).rows.length, 1);
  for (const query of [
    'insert into public.batches(id,day,payload) values (gen_random_uuid(),current_date,\'{}\')',
    'update public.tickets set status=\'won\'',
    'delete from public.selections',
    'select * from public.devices',
    'select * from public.notification_outbox',
    'select public.apply_results(\'[]\')',
    'delete from public.saved_batches',
    'insert into public.saved_batches(user_id,batch_id) values (auth.uid(),gen_random_uuid())',
    `select public.save_batch('${userB}',gen_random_uuid())`,
    `select public.subscribe_device('${userB}',gen_random_uuid(),'token-1234567890123456','android')`
  ]) await assert.rejects(db.query(query), /permission denied/);
  await db.exec('reset role');
});
test('lock de tareas persiste y aplica enfriamiento incluso después de liberar', async () => {
  const { rows: [lock] } = await db.query('select public.acquire_job_lock() id');
  assert.ok(lock.id);
  assert.equal((await db.query('select public.acquire_job_lock() id')).rows[0].id, null);
  await db.query('select public.release_job_lock($1)', [lock.id]);
  assert.equal((await db.query('select public.acquire_job_lock() id')).rows[0].id, null);
});
test('migración conserva las tandas y fechas del historial anterior', async () => {
  const legacy = await testDatabase();
  try {
    await legacy.exec(await readFile(new URL('../../supabase/migrations/001_initial.sql', import.meta.url), 'utf8'));
    const batch = demoBatch(); batch.mode = 'live';
    await legacy.query('select public.publish_batch($1::jsonb)', [JSON.stringify(batch)]);
    await legacy.query('select public.subscribe_device($1,$2,$3,$4)', [userA, batch.id, 'legacy-device-token-123456789', 'android']);
    const original = await legacy.query('select user_id,batch_id,created_at from public.batch_subscriptions');
    await legacy.exec(await readFile(new URL('../../supabase/migrations/002_saved_batches.sql', import.meta.url), 'utf8'));
    const saved = await legacy.query('select user_id,batch_id,created_at from public.saved_batches');
    assert.deepEqual(saved.rows, original.rows);
    assert.deepEqual((await legacy.query('select user_id,batch_id,created_at from public.batch_subscriptions')).rows, original.rows);
    assert.equal((await legacy.query('select count(*)::int n from public.devices')).rows[0].n, 1);
  } finally { await legacy.close(); }
});
test('csv_matches exige marcador en partidos terminados y solo admite service_role', async () => {
  await db.exec(`set role service_role;
    insert into public.csv_sync_runs default values;
    insert into public.csv_matches(id, league, league_name, kickoff, home_id, home_name, away_id, away_name, status)
      values ('fdu-NOR-2026-11-09-a-b', 'NOR', 'Eliteserien', now(), 'fdu-NOR-a', 'A', 'fdu-NOR-b', 'B', 'TIMED');
    reset role;`);
  await assert.rejects(db.exec(`insert into public.csv_matches(id, league, league_name, kickoff, home_id, home_name, away_id, away_name, status)
    values ('fdu-NOR-2026-11-10-a-b', 'NOR', 'Eliteserien', now(), 'fdu-NOR-a', 'A', 'fdu-NOR-b', 'B', 'FINISHED')`), /check/);
  await assert.rejects(db.exec(`insert into public.csv_matches(id, league, league_name, kickoff, home_id, home_name, away_id, away_name, status)
    values ('fd-1', 'NOR', 'Eliteserien', now(), 'x', 'A', 'y', 'B', 'TIMED')`), /check/);
  await assert.rejects(db.exec('set role anon; select * from public.csv_matches;'), /permission denied/);
  await db.exec('reset role;');
  assert.equal((await db.query('select count(*)::int n from public.csv_sync_runs')).rows[0].n, 1);
});
test('PostgreSQL acepta tickets de 6 partidos over 1.5 y los liquida con su tamaño', async () => {
  const { generateBatch } = await import('../src/tickets.js');
  const { demoSnapshot } = await import('../src/demo.js');
  const now = Date.parse('2026-11-05T17:00:00Z');
  const batch = generateBatch(demoSnapshot(now), { now, market: 'OVER_1_5', legs: 6, minProbability: 0.5, mode: 'live' });
  batch.day = '2099-03-01';
  for (const t of batch.tickets) for (const s of t.selections) s.match = { ...s.match, id: `six-${s.match.id}` };
  await publish(batch);
  const ticket = batch.tickets[0];
  assert.equal((await db.query('select legs from public.tickets where id = $1', [ticket.id])).rows[0].legs, 6);
  const results = ticket.selections.map(s => ({ matchId: s.match.id, result: 'won', score: '1–1' }));
  await db.query('select public.apply_results($1::jsonb)', [JSON.stringify(results.slice(0, 5))]);
  assert.equal((await db.query('select status from public.tickets where id = $1', [ticket.id])).rows[0].status, 'pending');
  await db.query('select public.apply_results($1::jsonb)', [JSON.stringify(results)]);
  assert.equal((await db.query('select status from public.tickets where id = $1', [ticket.id])).rows[0].status, 'won');
  const bad = structuredClone(batch); bad.id = randomUUID(); bad.day = '2099-03-02';
  bad.tickets = [{ ...bad.tickets[0], id: randomUUID(), selections: bad.tickets[0].selections.slice(0, 5).map(s => ({ ...s, match: { ...s.match, id: `x-${s.match.id}` } })) }];
  await assert.rejects(publish(bad), /cuatro o seis/);
});
test('PostgreSQL acepta un quinto ticket arriesgado con mercados mixtos', async () => {
  const { generateBatch, riskyTicket } = await import('../src/tickets.js');
  const { demoSnapshot } = await import('../src/demo.js');
  const now = Date.parse('2026-11-05T17:00:00Z'), snapshot = demoSnapshot(now);
  const batch = generateBatch(snapshot, { now, market: 'OVER_1_5', legs: 6, minProbability: 0.5, mode: 'live' });
  batch.id = randomUUID(); batch.day = '2099-04-01';
  // Ticket arriesgado forzado con umbrales bajos para la prueba de base de datos.
  const pool = snapshot.fixtures.slice(0, 4).map((f, i) => ({ ...f, id: `rk-${i}-${f.id}` }));
  const risky = { id: randomUUID(), number: batch.tickets.length + 1, kind: 'risky', name: 'El arriesgado del día', status: 'pending', probability: 0.05,
    selections: pool.map((f, i) => ({ match: f, market: i < 2 ? 'OVER_3_5' : 'OVER_2_5', prediction: {}, result: 'pending', score: null })) };
  assert.equal(pool.length, 4); assert.equal(typeof riskyTicket, 'function');
  batch.tickets = [...batch.tickets, risky];
  for (const t of batch.tickets) for (const s of t.selections) s.match = { ...s.match, id: `risky-${s.match.id}` };
  await publish(batch);
  const row = (await db.query('select kind, legs, ordinal from public.tickets where id = $1', [risky.id])).rows[0];
  assert.deepEqual(row, { kind: 'risky', legs: 4, ordinal: batch.tickets.length });
  const markets = (await db.query('select market from public.selections where ticket_id = $1 order by market', [risky.id])).rows.map(r => r.market);
  assert.deepEqual(markets, ['OVER_2_5', 'OVER_2_5', 'OVER_3_5', 'OVER_3_5']);
  const twice = structuredClone(batch); twice.id = randomUUID(); twice.day = '2099-04-02';
  twice.tickets = [risky, { ...risky, id: randomUUID() }].map(t => ({ ...t, selections: t.selections.map(s => ({ ...s, match: { ...s.match, id: `${s.match.id}-${randomUUID()}` } })) }));
  await assert.rejects(publish(twice), /Lote inválido/);
});
test('af_matches valida ids y marcador; af_league_rates resume over 1.5 por liga', async () => {
  await db.exec(`insert into public.af_matches(id, league_id, league_name, kickoff, home_id, home_name, away_id, away_name, status, home_goals, away_goals) values
    ('af-1', 9, 'L', now() - interval '2 days', 'a', 'A', 'b', 'B', 'FINISHED', 1, 1),
    ('af-2', 9, 'L', now() - interval '3 days', 'a', 'A', 'c', 'C', 'FINISHED', 1, 0),
    ('af-3', 9, 'L', now() + interval '1 day', 'a', 'A', 'd', 'D', 'TIMED', null, null)`);
  await assert.rejects(db.exec(`insert into public.af_matches(id, league_id, league_name, kickoff, home_id, home_name, away_id, away_name, status)
    values ('af-4', 9, 'L', now(), 'a', 'A', 'b', 'B', 'FINISHED')`), /check/);
  await assert.rejects(db.exec(`insert into public.af_matches(id, league_id, league_name, kickoff, home_id, home_name, away_id, away_name, status)
    values ('fd-4', 9, 'L', now(), 'a', 'A', 'b', 'B', 'TIMED')`), /check/);
  const rate = (await db.query('select matches, over15 from public.af_league_rates where league_id = 9')).rows[0];
  assert.deepEqual(rate, { matches: 2, over15: 0.5 });
  await assert.rejects(db.exec('set role anon; select * from public.af_matches;'), /permission denied/);
  await db.exec('reset role;');
});
