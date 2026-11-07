import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenFootball, teamId } from '../scripts/import-openfootball.js';

test('unifica nombres de un mismo equipo entre temporadas', () => {
  assert.equal(teamId('en.1', 'Manchester City'), teamId('en.1', 'Manchester City FC'));
  assert.equal(teamId('es.1', 'Club Atlético de Madrid'), teamId('es.1', 'Atlético Madrid'));
  assert.equal(teamId('it.1', 'Inter'), teamId('it.1', 'FC Internazionale Milano'));
  assert.equal(teamId('fr.1', 'RC Lens'), teamId('fr.1', 'Racing Club de Lens'));
  assert.notEqual(teamId('en.1', 'Manchester City'), teamId('en.1', 'Manchester United'));
  assert.notEqual(teamId('en.1', 'Arsenal'), teamId('es.1', 'Arsenal'));
});

test('normaliza partidos con marcador final y descarta los incompletos', () => {
  const rows = normalizeOpenFootball({ name: 'Liga', matches: [
    { date: '2024-08-16', time: '20:00', team1: 'Manchester United FC', team2: 'Fulham FC', score: { ft: [1, 0] } },
    { date: '2024-08-17', team1: 'Arsenal FC', team2: 'Wolverhampton Wanderers FC', score: { ft: [2, 0] } },
    { date: '2024-08-18', time: '15:00', team1: 'Chelsea FC', team2: 'Manchester City FC', score: {} },
    { date: 'mañana', time: '15:00', team1: 'A', team2: 'B', score: { ft: [1, 1] } }
  ] }, 'en.1', '2024-25');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: 'openfootball:2024-25:en.1:2024-08-16:Manchester United FC|Fulham FC',
    kickoff: '2024-08-16T20:00:00.000Z', availableAt: '2024-08-16T23:00:00.000Z', status: 'FINISHED',
    league: { id: 'en.1', name: 'Liga' },
    home: { id: 'en.1:manchester united', name: 'Manchester United FC' },
    away: { id: 'en.1:fulham', name: 'Fulham FC' }, homeGoals: 1, awayGoals: 0
  });
  // Sin hora: mediodía UTC como supuesto explícito.
  assert.equal(rows[1].kickoff, '2024-08-17T12:00:00.000Z');
});
