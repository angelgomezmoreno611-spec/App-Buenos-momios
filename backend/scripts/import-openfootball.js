import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// Descarga temporadas cerradas de OpenFootball (CC0) y las normaliza al formato
// de scripts/backtest.js. Consultas en serie para limitar memoria y red.
//
// Supuestos documentados (no son datos del archivo):
// - Las horas de OpenFootball no tienen zona horaria; se interpretan como UTC.
//   Dentro de una liga el orden relativo se conserva.
// - availableAt = kickoff + 3 h: el marcador final se considera conocido tres
//   horas después del inicio. Es conservador para un partido de 90 minutos.
const LEAGUES = ['en.1', 'es.1', 'de.1', 'it.1', 'fr.1'];
const DEFAULT_SEASONS = ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'];
const BASE = 'https://raw.githubusercontent.com/openfootball/football.json/master';
const MAX_BYTES = 2 * 1024 * 1024;
const HOUR = 3_600_000;

// OpenFootball cambia el nombre oficial entre temporadas ("Manchester City" /
// "Manchester City FC", "Atlético Madrid" / "Club Atlético de Madrid"). El id
// debe ser estable para no partir el historial de un equipo en dos.
const NOISE = new Set(['fc', 'cf', 'afc', 'ac', 'as', 'ss', 'ssc', 'sc', 'rc', 'ca', 'ud', 'cd', 'rcd', 'sd', 'vfl', 'vfb',
  'tsg', 'fsv', 'sv', 'bv', 'bsc', 'ogc', 'losc', 'us', 'club', 'de', 'calcio', '1899', '1846', '1909', '1910', '1913', '04', '05', '09', '1.']);
// Renombres detectados al comparar temporadas consecutivas (2019-20 a 2024-25).
const ALIASES = {
  'es.1': { celta: 'celta vigo', 'real sociedad': 'real sociedad futbol', alaves: 'deportivo alaves', 'real betis': 'real betis balompie' },
  'de.1': { 'bor monchengladbach': 'borussia monchengladbach' },
  'it.1': { sampdoria: 'uc sampdoria', 'lazio roma': 'lazio', atalanta: 'atalanta bc', inter: 'internazionale milano' },
  'fr.1': { lens: 'racing lens', 'stade rennais': 'stade rennais 1901', strasbourg: 'strasbourg alsace' }
};
export function teamId(league, name) {
  const key = teamKey(name);
  return `${league}:${ALIASES[league]?.[key] ?? key}`;
}
export function teamKey(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.]/g, ' ')
    .split(/\s+/).filter(word => word && !NOISE.has(word) && word !== '1').join(' ');
}

export function normalizeOpenFootball(data, league, season) {
  const out = [];
  for (const m of data?.matches ?? []) {
    const ft = m.score?.ft;
    if (!Array.isArray(ft) || !Number.isInteger(ft[0]) || !Number.isInteger(ft[1])) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date ?? '') || !m.team1 || !m.team2 || teamId(league, m.team1) === teamId(league, m.team2)) continue;
    const time = /^\d{2}:\d{2}$/.test(m.time ?? '') ? m.time : '12:00';
    const kickoff = Date.parse(`${m.date}T${time}:00Z`);
    if (!Number.isFinite(kickoff)) continue;
    out.push({
      id: `openfootball:${season}:${league}:${m.date}:${m.team1}|${m.team2}`,
      kickoff: new Date(kickoff).toISOString(),
      availableAt: new Date(kickoff + 3 * HOUR).toISOString(),
      status: 'FINISHED',
      league: { id: league, name: data.name ?? league },
      home: { id: teamId(league, m.team1), name: m.team1 },
      away: { id: teamId(league, m.team2), name: m.team2 },
      homeGoals: ft[0], awayGoals: ft[1]
    });
  }
  return out;
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`Respuesta demasiado grande en ${url}`);
  return JSON.parse(text);
}

async function main() {
  const [output = 'data/openfootball.json', ...rest] = process.argv.slice(2);
  const seasons = rest.length ? rest : DEFAULT_SEASONS;
  const rows = [];
  for (const season of seasons) {
    for (const league of LEAGUES) {
      const data = await download(`${BASE}/${season}/${league}.json`);
      const matches = data ? normalizeOpenFootball(data, league, season) : [];
      console.error(`${season} ${league}: ${data ? `${matches.length}/${data.matches?.length ?? 0} con marcador` : 'no disponible'}`);
      rows.push(...matches);
    }
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(rows));
  console.error(`Guardados ${rows.length} partidos en ${output} (licencia CC0, openfootball/football.json).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
