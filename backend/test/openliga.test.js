import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOldb, oldbSnapshot, oldbResults, oldbSeason } from '../src/openliga.js';

const row = (id, date, finished, goals) => ({ matchID: id, leagueShortcut: 'bl3', matchDateTimeUTC: date, matchIsFinished: finished,
  team1: { teamId: 1, teamName: 'Mannheim' }, team2: { teamId: 2, teamName: 'Essen' },
  matchResults: goals ? [{ resultTypeID: 1, pointsTeam1: 0, pointsTeam2: 0 }, { resultTypeID: 2, pointsTeam1: goals[0], pointsTeam2: goals[1] }] : [] });

test('OpenLigaDB: normaliza marcador final y descarta terminados sin resultado', () => {
  assert.deepEqual(normalizeOldb(row(9, '2026-08-07T17:00:00Z', true, [2, 1]), 'BL3'), {
    id: 'oldb-9', league: { id: 'BL3', name: '3. Liga' }, home: { id: 'oldb-team-1', name: 'Mannheim' }, away: { id: 'oldb-team-2', name: 'Essen' },
    kickoff: '2026-08-07T17:00:00.000Z', status: 'FINISHED', homeGoals: 2, awayGoals: 1, availableAt: '2026-08-07T20:00:00.000Z', sourceUpdatedAt: null });
  assert.equal(normalizeOldb(row(9, '2026-08-07T17:00:00Z', true, null), 'BL3'), null);
  assert.equal(normalizeOldb(row(9, '2026-11-14T13:00:00Z', false, null), 'BL3').status, 'TIMED');
  assert.equal(oldbSeason(Date.parse('2026-11-08T00:00:00Z')), 2026);
  assert.equal(oldbSeason(Date.parse('2027-03-01T00:00:00Z'), 1), 2025);
});

test('OpenLigaDB: snapshot de dos temporadas y resultados por partido', async () => {
  const now = Date.parse('2026-11-08T12:00:00Z'), urls = [];
  const get = async url => { urls.push(url); return url.endsWith('/2026') ? [row(1, '2026-11-01T13:00:00Z', true, [1, 1]), row(2, '2026-11-14T13:00:00Z', false)]
    : url.endsWith('/2025') ? [row(3, '2025-11-01T13:00:00Z', true, [3, 0]), row(4, '2024-01-01T13:00:00Z', true, [0, 0])] : row(1, '2026-11-01T13:00:00Z', true, [1, 1]); };
  const snap = await oldbSnapshot(['BL3'], { now, get });
  assert.deepEqual(urls, ['https://api.openligadb.de/getmatchdata/bl3/2026', 'https://api.openligadb.de/getmatchdata/bl3/2025']);
  assert.deepEqual(snap.history.map(m => m.id).sort(), ['oldb-1', 'oldb-3']);
  assert.deepEqual(snap.fixtures.map(m => m.id), ['oldb-2']);
  const results = await oldbResults(['oldb-1', 'fd-5', 'oldb-x'], { get });
  assert.deepEqual(results.map(m => [m.id, m.homeGoals, m.awayGoals]), [['oldb-1', 1, 1]]);
  await assert.rejects(oldbSnapshot(['XX'], { now, get }), /no compatible/);
});
