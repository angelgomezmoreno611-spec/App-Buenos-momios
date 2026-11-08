import test from 'node:test';
import assert from 'node:assert/strict';
import { londonToUtc, parseResults, parseFixtures } from '../src/csvleagues.js';

test('convierte hora de Londres a UTC con y sin horario de verano', () => {
  assert.equal(new Date(londonToUtc('01/11/2026', '03:10')).toISOString(), '2026-11-01T03:10:00.000Z');
  assert.equal(new Date(londonToUtc('15/07/2026', '20:00')).toISOString(), '2026-07-15T19:00:00.000Z');
  assert.equal(londonToUtc('2026-07-15', '20:00'), null);
});

test('resultados y próximos partidos comparten id y descartan filas incompletas', () => {
  const results = '﻿Country,League,Season,Date,Time,Home,Away,HG,AG,Res\n' +
    'Mexico,Liga MX,2026/2027,01/11/2026,03:10,Club America,Toluca,2,2,D\n' +
    'Mexico,Liga MX,2026/2027,02/11/2026,01:10,Cruz Azul,Club Leon,,,\n' +
    'Mexico,Otra,2026/2027,02/11/2026,01:10,A,B,1,0,H\n';
  const rows = parseResults(results, 'MEX');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].id, rows[0].homeGoals, rows[0].awayGoals, rows[0].availableAt],
    ['fdu-MEX-2026-11-01-club-america-toluca', 2, 2, '2026-11-01T06:10:00.000Z']);
  const fixtures = parseFixtures('Country,League,Date,Time,Home,Away\nMexico,Liga MX,01/11/2026,03:10,Club America,Toluca\nUSA,MLS,01/11/2026,20:00,A,B\n', ['MEX']);
  assert.deepEqual(fixtures.map(m => [m.id, m.status]), [['fdu-MEX-2026-11-01-club-america-toluca', 'TIMED']]);
});
