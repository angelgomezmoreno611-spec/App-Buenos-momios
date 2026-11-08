// Ligas de football-data.co.uk ("new leagues"): archivos CSV gratuitos, sin API
// ni clave. Un archivo por país con todas las temporadas (resultados) y un
// archivo común con los partidos de los próximos días.
//
// Supuestos documentados:
// - Las horas del sitio están en hora del Reino Unido (Europe/London); se
//   convierten a UTC.
// - El id del partido es liga + fecha + equipos: es el mismo en el archivo de
//   próximos partidos y en el de resultados. Si un partido se reprograma a otro
//   día, su id cambia y el ticket queda pendiente de revisión manual.
// - Los resultados se publican con días de retraso (no en vivo).
export const CSV_LEAGUES = {
  MEX: { file: 'MEX', country: 'Mexico', league: 'Liga MX', name: 'Liga MX' },
  ARG: { file: 'ARG', country: 'Argentina', league: 'Liga Profesional', name: 'Liga Profesional Argentina' },
  USA: { file: 'USA', country: 'USA', league: 'MLS', name: 'MLS' }
};
const BASE = 'https://football-data.co.uk';
const HOUR = 3_600_000;

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split(',') ?? [];
  return lines.map(line => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]));
  });
}

const slug = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Minutos que Londres va por delante de UTC en ese instante (0 o 60).
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
  const first = naive - londonOffset(naive);
  return naive - londonOffset(first);
}

function toMatch(row, code, finished) {
  const spec = CSV_LEAGUES[code], kickoff = londonToUtc(row.Date, row.Time);
  if (kickoff === null || !row.Home || !row.Away || slug(row.Home) === slug(row.Away)) return null;
  const day = new Date(kickoff).toISOString().slice(0, 10);
  const homeGoals = finished ? Number.parseInt(row.HG, 10) : null, awayGoals = finished ? Number.parseInt(row.AG, 10) : null;
  if (finished && (!/^\d+$/.test(row.HG) || !/^\d+$/.test(row.AG))) return null;
  return {
    id: `fdu-${code}-${day}-${slug(row.Home)}-${slug(row.Away)}`,
    league: { id: code, name: spec.name },
    home: { id: `fdu-${code}-${slug(row.Home)}`, name: row.Home },
    away: { id: `fdu-${code}-${slug(row.Away)}`, name: row.Away },
    kickoff: new Date(kickoff).toISOString(), status: finished ? 'FINISHED' : 'TIMED',
    homeGoals, awayGoals,
    // El marcador se considera conocido 3 h después del inicio (como en OpenFootball).
    availableAt: finished ? new Date(kickoff + 3 * HOUR).toISOString() : null, sourceUpdatedAt: null
  };
}

// Resultados de un archivo de país. Solo filas de la liga configurada.
export function parseResults(text, code) {
  const spec = CSV_LEAGUES[code];
  return parseCsv(text).filter(r => r.League === spec.league).map(r => toMatch(r, code, true)).filter(Boolean);
}
// Próximos partidos (archivo común) de las ligas pedidas.
export function parseFixtures(text, codes) {
  const out = [];
  for (const row of parseCsv(text)) {
    const code = codes.find(c => CSV_LEAGUES[c].country === row.Country && CSV_LEAGUES[c].league === row.League);
    const match = code && toMatch(row, code, false);
    if (match) out.push(match);
  }
  return out;
}

export class CsvLeagues {
  constructor({ competitions, get }) {
    this.competitions = competitions;
    if (this.competitions.some(c => !CSV_LEAGUES[c])) throw new Error('Liga CSV no compatible');
    this.get = get; // get(url) → texto; transporte con límite de tamaño
  }
  owns(id) { return /^fdu-[A-Z]+-/.test(id); }
  async snapshot(now = Date.now()) {
    const since = now - 400 * 24 * HOUR;
    const history = [];
    for (const code of this.competitions) {
      history.push(...parseResults(await this.get(`${BASE}/new/${CSV_LEAGUES[code].file}.csv`), code)
        .filter(m => Date.parse(m.kickoff) >= since && Date.parse(m.availableAt) <= now));
    }
    const fixtures = parseFixtures(await this.get(`${BASE}/new_league_fixtures.csv`), this.competitions)
      .filter(m => Date.parse(m.kickoff) > now);
    return { history, fixtures };
  }
  async results(ids) {
    const codes = [...new Set(ids.map(id => id.split('-')[1]))].filter(c => this.competitions.includes(c));
    const wanted = new Set(ids), out = [];
    for (const code of codes) {
      out.push(...parseResults(await this.get(`${BASE}/new/${CSV_LEAGUES[code].file}.csv`), code).filter(m => wanted.has(m.id)));
    }
    return out;
  }
}
