const BASE = 'https://api.football-data.org/v4';
const LEAGUES = new Set(['PL', 'PD', 'BL1', 'SA', 'FL1', 'DED', 'PPL', 'ELC', 'BSA']);

export function normalizeMatch(row, fetchedAt = new Date().toISOString()) {
  if (!row.id || !row.homeTeam?.id || !row.awayTeam?.id || !row.competition?.code || !Number.isFinite(Date.parse(row.utcDate))) {
    throw new Error('Respuesta incompleta del proveedor');
  }
  // Solo ligas de 90 minutos. No contamos prórroga ni penales.
  const regular = row.score?.duration === 'REGULAR';
  const finished = row.status === 'FINISHED';
  const status = finished && !regular ? 'UNKNOWN' : row.status;
  const full = row.score?.fullTime ?? {};
  return {
    id: `fd-${row.id}`, providerId: row.id,
    league: { id: row.competition.code, name: row.competition.name },
    home: { id: `fd-team-${row.homeTeam.id}`, name: row.homeTeam.shortName || row.homeTeam.name },
    away: { id: `fd-team-${row.awayTeam.id}`, name: row.awayTeam.shortName || row.awayTeam.name },
    kickoff: row.utcDate, status,
    homeGoals: regular && Number.isInteger(full.home) ? full.home : null,
    awayGoals: regular && Number.isInteger(full.away) ? full.away : null,
    // Conservador: si solo conocemos la fecha de obtención, no suponemos
    // que ese resultado estaba disponible antes (especialmente en backtests).
    availableAt: finished ? fetchedAt : null, sourceUpdatedAt: row.lastUpdated ?? null
  };
}

export class FootballData {
  constructor({ token, competitions = 'PL,PD,BL1,SA,FL1,DED,PPL,ELC', fetcher = fetch }) {
    if (!token) throw new Error('Falta FOOTBALL_DATA_TOKEN');
    this.token = token; this.fetcher = fetcher;
    this.competitions = [...new Set(competitions.split(',').map(x => x.trim()).filter(Boolean))];
    if (!this.competitions.length || this.competitions.length > 8 || this.competitions.some(x => !LEAGUES.has(x))) {
      throw new Error('Configura entre 1 y 8 ligas gratuitas compatibles');
    }
  }
  async get(path) {
    const response = await this.fetcher(`${BASE}${path}`, {
      headers: { 'X-Auth-Token': this.token }, signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) {
      const error = new Error(`Proveedor de fútbol: HTTP ${response.status}`);
      error.status = 503; throw error;
    }
    return response.json();
  }
  async snapshot(now = Date.now()) {
    const fetchedAt = new Date(now).toISOString(), all = [];
    // Máximo ocho solicitudes por generación; un lock compartido impide solapes.
    for (const code of this.competitions) {
      const data = await this.get(`/competitions/${code}/matches`);
      if (!Array.isArray(data.matches) || data.matches.length === 0) throw new Error(`Liga ${code} sin datos`);
      all.push(...data.matches.map(row => normalizeMatch(row, fetchedAt)));
    }
    return {
      source: 'football-data.org (plan gratuito, resultados con retraso)', fetchedAt,
      history: all.filter(m => m.status === 'FINISHED'),
      fixtures: all.filter(m => ['SCHEDULED', 'TIMED'].includes(m.status)),
      warnings: ['Cobertura de la temporada disponible; sin cuotas, xG, alineaciones ni lesiones.']
    };
  }
  async results(ids) {
    if (!ids.length) return [];
    if (ids.length > 50 || ids.some(x => !/^fd-\d+$/.test(x))) throw new Error('Lote de resultados inválido');
    const data = await this.get(`/matches?ids=${ids.map(x => x.slice(3)).join(',')}`);
    if (!Array.isArray(data.matches)) throw new Error('Resultados inválidos');
    return data.matches.map(row => normalizeMatch(row));
  }
}
