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

test('syncCsv descarga en serie, omite playoffs de MLS y temporadas sin archivo', async () => {
  const { syncCsv, seasonCode } = await import('../src/csvleagues.js');
  const now = Date.parse('2026-11-08T12:00:00Z'), urls = [];
  const files = {
    'https://football-data.co.uk/fixtures.csv': 'Div,Date,Time,HomeTeam,AwayTeam\nT1,09/11/2026,17:00,Galatasaray,Fenerbahce\nE0,09/11/2026,17:00,Arsenal,Chelsea\nT1,01/11/2026,17:00,Pasado,Viejo\n',
    'https://football-data.co.uk/new_league_fixtures.csv': 'Country,League,Date,Time,Home,Away\nUSA,MLS,09/11/2026,20:00,LA Galaxy,Seattle\nNorway,Eliteserien,09/11/2026,17:00,Bodo/Glimt,Molde\n',
    'https://football-data.co.uk/mmz4281/2627/T1.csv': 'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\nT1,01/11/2026,17:00,Galatasaray,Besiktas,3,1\nT1,01/01/2025,17:00,Antiguo,Partido,1,1\n',
    'https://football-data.co.uk/new/NOR.csv': 'Country,League,Season,Date,Time,Home,Away,HG,AG\nNorway,Eliteserien,2026,01/11/2026,17:00,Molde,Brann,2,0\n',
    'https://football-data.co.uk/new/USA.csv': 'Country,League,Season,Date,Time,Home,Away,HG,AG\n'
  };
  const get = async url => { urls.push(url); if (!(url in files)) throw new Error('CSV: HTTP 404'); return files[url]; };
  const out = await syncCsv(['T1', 'NOR', 'USA'], { now, get });
  assert.equal(seasonCode(now), '2627'); assert.equal(seasonCode(now, 1), '2526');
  assert.deepEqual(out.fixtures.map(m => m.id).sort(), ['fdu-NOR-2026-11-09-bodo-glimt-molde', 'fdu-T1-2026-11-09-galatasaray-fenerbahce']);
  assert.deepEqual(out.results.map(m => m.id).sort(), ['fdu-NOR-2026-11-01-molde-brann', 'fdu-T1-2026-11-01-galatasaray-besiktas']);
  assert.equal(urls.length, 6); // 2 comunes + T1 (2 temporadas, una sin archivo) + NOR + USA
  await assert.rejects(syncCsv(['XX'], { now, get }), /no compatible/);
});
