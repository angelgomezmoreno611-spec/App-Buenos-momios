// Ligas de football-data.co.uk: archivos CSV gratuitos, sin API ni clave.
// Dos formatos:
// - "main" (Europa): un archivo por división y temporada (mmz4281/2627/B1.csv)
//   y un archivo común de próximos partidos (fixtures.csv).
// - "extra": un archivo por país con todas las temporadas (new/NOR.csv) y un
//   archivo común de próximos partidos (new_league_fixtures.csv).
//
// Supuestos documentados:
// - Las horas del sitio están en hora del Reino Unido (Europe/London); se
//   convierten a UTC.
// - El id del partido es liga + fecha + equipos: es el mismo en el archivo de
//   próximos partidos y en el de resultados. Si un partido se reprograma a otro
//   día, su id cambia y el ticket queda pendiente.
// - Los resultados se publican con días de retraso (no en vivo).
const main = (div, name) => ({ type: 'main', div, name });
const extra = (file, country, league, name) => ({ type: 'extra', file, country, league, name });
export const CSV_LEAGUES = {
  B1: main('B1', 'Pro League (Bélgica)'),
  D2: main('D2', '2. Bundesliga'),
  F2: main('F2', 'Ligue 2'),
  G1: main('G1', 'Super League (Grecia)'),
  I2: main('I2', 'Serie B'),
  SC0: main('SC0', 'Premiership (Escocia)'),
  SC1: main('SC1', 'Championship (Escocia)'),
  SC2: main('SC2', 'League One (Escocia)'),
  SC3: main('SC3', 'League Two (Escocia)'),
  SP2: main('SP2', 'LaLiga 2'),
  T1: main('T1', 'Süper Lig'),
  AUT: extra('AUT', 'Austria', 'Bundesliga', 'Bundesliga (Austria)'),
  DNK: extra('DNK', 'Denmark', 'Superliga', 'Superliga (Dinamarca)'),
  FIN: extra('FIN', 'Finland', 'Veikkausliiga', 'Veikkausliiga'),
  IRL: extra('IRL', 'Ireland', 'Premier Division', 'Premier Division (Irlanda)'),
  NOR: extra('NOR', 'Norway', 'Eliteserien', 'Eliteserien'),
  POL: extra('POL', 'Poland', 'Ekstraklasa', 'Ekstraklasa'),
  ROU: extra('ROU', 'Romania', 'Superliga', 'Superliga (Rumania)'),
  SWE: extra('SWE', 'Sweden', 'Allsvenskan', 'Allsvenskan'),
  SWZ: extra('SWZ', 'Switzerland', 'Super League', 'Super League (Suiza)'),
  JPN: extra('JPN', 'Japan', 'J1 League', 'J1 League'),
  CHN: extra('CHN', 'China', 'Super League', 'Super League (China)'),
  MEX: extra('MEX', 'Mexico', 'Liga MX', 'Liga MX'),
  ARG: extra('ARG', 'Argentina', 'Liga Profesional', 'Liga Profesional Argentina'),
  USA: extra('USA', 'USA', 'MLS', 'MLS')
};
export const CSV_BASE = 'https://football-data.co.uk';
const HOUR = 3_600_000;

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split(',').map(h => h.trim()) ?? [];
  return lines.map(line => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const slug = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Milisegundos que Londres va por delante de UTC en ese instante.
function londonOffset(utcMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return local - Math.floor(utcMs / 60_000) * 60_000;
}
export function londonToUtc(date, time) {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date), t = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!d || !t) return null;
  const naive = Date.UTC(+d[3], +d[2] - 1, +d[1], +t[1], +t[2]);
  if (!Number.isFinite(naive)) return null;
  // Dos pasadas para acertar también cerca del cambio de horario.
  return naive - londonOffset(naive - londonOffset(naive));
}

// Normaliza una fila de cualquiera de los dos formatos.
function toMatch(row, code, finished) {
  const spec = CSV_LEAGUES[code], kickoff = londonToUtc(row.Date, row.Time);
  const home = row.Home ?? row.HomeTeam, away = row.Away ?? row.AwayTeam;
  const hg = row.HG ?? row.FTHG, ag = row.AG ?? row.FTAG;
  if (kickoff === null || !home || !away || slug(home) === slug(away)) return null;
  if (finished && (!/^\d+$/.test(hg ?? '') || !/^\d+$/.test(ag ?? ''))) return null;
  const day = new Date(kickoff).toISOString().slice(0, 10);
  return {
    id: `fdu-${code}-${day}-${slug(home)}-${slug(away)}`,
    league: { id: code, name: spec.name },
    home: { id: `fdu-${code}-${slug(home)}`, name: home },
    away: { id: `fdu-${code}-${slug(away)}`, name: away },
    kickoff: new Date(kickoff).toISOString(), status: finished ? 'FINISHED' : 'TIMED',
    homeGoals: finished ? Number(hg) : null, awayGoals: finished ? Number(ag) : null,
    // El marcador se considera conocido 3 h después del inicio (como en OpenFootball).
    availableAt: finished ? new Date(kickoff + 3 * HOUR).toISOString() : null, sourceUpdatedAt: null
  };
}

const belongs = (row, code) => {
  const spec = CSV_LEAGUES[code];
  return spec.type === 'main' ? row.Div === spec.div : row.Country === spec.country && row.League === spec.league;
};
// Resultados de un archivo (de división o de país): solo la liga pedida.
export function parseResults(text, code) {
  return parseCsv(text).filter(r => belongs(r, code)).map(r => toMatch(r, code, true)).filter(Boolean);
}
// Próximos partidos de un archivo común de las ligas pedidas.
export function parseFixtures(text, codes) {
  const out = [];
  for (const row of parseCsv(text)) {
    const code = codes.find(c => belongs(row, c));
    const match = code && toMatch(row, code, false);
    if (match) out.push(match);
  }
  return out;
}

// Temporada europea en formato del sitio: julio de 2026 → "2627".
export function seasonCode(now, back = 0) {
  const d = new Date(now), start = (d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1) - back;
  return `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`;
}
// Archivos de resultados que cubren los últimos 400 días de una liga.
export function resultFiles(code, now) {
  const spec = CSV_LEAGUES[code];
  if (spec.type === 'extra') return [`${CSV_BASE}/new/${spec.file}.csv`];
  return [0, 1].map(back => `${CSV_BASE}/mmz4281/${seasonCode(now, back)}/${spec.div}.csv`);
}

// Ligas activadas por defecto: las que superaron el backtest temporal
// (2022-07 a 2026-11, umbral 0.65, mismo modelo) con al menos 40 selecciones y
// un acierto no menor que el de las ligas europeas validadas (~65%).
// Al elegir las mejores de 22 ligas hay sesgo de selección: el acierto real
// probablemente será algo menor que el medido.
export const CSV_VALIDATION = {
  NOR: { picks: 157, hitRate: 0.758 }, SWE: { picks: 50, hitRate: 0.74 },
  CHN: { picks: 149, hitRate: 0.725 }, SWZ: { picks: 149, hitRate: 0.698 },
  T1: { picks: 71, hitRate: 0.662 }, DNK: { picks: 56, hitRate: 0.643 },
  USA: { picks: 592, hitRate: 0.672 }
};
export const DEFAULT_CSV_LEAGUES = Object.keys(CSV_VALIDATION);
// MLS: noviembre y diciembre son playoffs (puede haber prórroga y penales).
const SKIP_MONTHS = { USA: [10, 11] };

const MAX_BYTES = 2_000_000;
export async function fetchText(url, fetcher = fetch) {
  if (!url.startsWith(`${CSV_BASE}/`)) throw new Error('Dirección CSV inválida');
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`CSV: HTTP ${response.status}`); }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('CSV demasiado grande');
  return text;
}

// Una sincronización: próximos partidos + resultados de los últimos 400 días.
// Descargas en serie: 1-2 archivos comunes y 1-2 por liga.
export async function syncCsv(codes, { now = Date.now(), get = fetchText } = {}) {
  if (!codes.length) return { fixtures: [], results: [], files: 0 };
  if (codes.some(c => !CSV_LEAGUES[c])) throw new Error('Liga CSV no compatible');
  const since = now - 400 * 24 * HOUR, types = new Set(codes.map(c => CSV_LEAGUES[c].type));
  const commons = [...(types.has('main') ? [`${CSV_BASE}/fixtures.csv`] : []), ...(types.has('extra') ? [`${CSV_BASE}/new_league_fixtures.csv`] : [])];
  const fixtures = [], results = [];
  let files = 0;
  for (const url of commons) {
    files++;
    fixtures.push(...parseFixtures(await get(url), codes).filter(m => Date.parse(m.kickoff) > now &&
      !SKIP_MONTHS[m.league.id]?.includes(new Date(m.kickoff).getUTCMonth())));
  }
  for (const code of codes) {
    for (const url of resultFiles(code, now)) {
      files++;
      let text;
      try { text = await get(url); }
      catch (error) { if (/HTTP 404/.test(error.message)) continue; throw error; } // temporada aún sin archivo
      results.push(...parseResults(text, code).filter(m => Date.parse(m.kickoff) >= since && Date.parse(m.availableAt) <= now));
    }
  }
  return { fixtures, results, files };
}
