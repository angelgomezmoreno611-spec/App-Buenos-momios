// Descubrimiento de partidos con API-Football (plan gratuito: 100 consultas/día,
// 10/minuto, y solo fechas de ayer a mañana). Para partidos de ligas que no
// cubren las demás fuentes:
// 1) lista de partidos del día (1 consulta por fecha, todas las ligas);
// 2) "predictions" de cada partido elegido (1 consulta): promedios de goles de
//    la temporada en casa/fuera y de los últimos 5 partidos de cada equipo;
// 3) un modelo de forma reciente calcula la probabilidad de over N.
// Backtest del método (25 660 partidos, 30 ligas, 2022-2026, `bt-form.mjs`):
// over 1.5 ≥0.85 → 2135 selecciones, 84.7%; over 2.5 ≥0.65 → 63.2%; over 3.5
// ≥0.45 → 43.0%. En ligas de pocos goles rinde menos, por eso el umbral es más alto.
const BASE = 'https://v3.football.api-sports.io';
const HOUR = 3_600_000;
export const FORM_MODEL_VERSION = 'form-af-v1';
// Umbral mínimo por mercado para partidos analizados con este método.
export const FORM_MIN = Object.freeze({ OVER_1_5: 0.85, OVER_2_5: 0.65, OVER_3_5: 0.45 });
export const FORM_EVIDENCE = 'Forma reciente (API-Football): método medido en 25 660 partidos de 30 ligas; over 1.5 con 85% o más acertó el 84.7%. La liga concreta no está validada.';
// Ligas ya cubiertas por football-data.org, CSV u OpenLigaDB (ids de API-Football).
export const COVERED_LEAGUES = new Set([39, 40, 140, 135, 78, 80, 61, 88, 94, 71, 103, 113, 169, 207, 203, 119, 253, 144, 262, 179, 183, 184, 244, 106, 197, 357]);
const EXCLUDED_NAME = /cup|copa|coupe|coppa|pokal|ta[cç]a|trophy|troph[ée]e|shield|friendl|amistos|u1\d|u2[0-3]|youth|juvenil|primavera|reserve|play-?off|qualif|super ?cup/i;
const EXCLUDED_ROUND = /final|semi|quarter|play|round of|knockout|relegation|promotion/i;
export const AF_DAILY_BUDGET = 85; // deja 15 consultas libres para pruebas manuales

export async function afGet(path, key, fetcher = fetch, maxBytes = 6_000_000) {
  const response = await fetcher(`${BASE}${path}`, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`API-Football: HTTP ${response.status}`); }
  const text = await response.text();
  if (text.length > maxBytes) throw new Error('API-Football: respuesta demasiado grande');
  const data = JSON.parse(text);
  const errors = Array.isArray(data.errors) ? data.errors : Object.values(data.errors ?? {});
  if (errors.length) throw new Error(`API-Football: ${errors.join('; ')}`);
  return data;
}

// Partido de la lista del día al formato común. Solo partidos de liga con jornada
// numerada; resultado a 90 minutos (FT, sin prórroga ni penales).
export function normalizeAfFixture(f) {
  const id = f?.fixture?.id, kickoff = Date.parse(f?.fixture?.date);
  if (!id || !Number.isFinite(kickoff) || !f.teams?.home?.id || !f.teams?.away?.id || f.teams.home.id === f.teams.away.id) return null;
  const status = f.fixture.status?.short;
  const ft = f.score?.fulltime ?? {};
  const finished = status === 'FT' && Number.isInteger(ft.home) && Number.isInteger(ft.away);
  return {
    id: `af-${id}`, providerId: id,
    league: { id: `af-${f.league.id}`, name: `${f.league.name} (${f.league.country})`, afId: f.league.id, round: f.league.round ?? '' },
    home: { id: `af-team-${f.teams.home.id}`, name: f.teams.home.name },
    away: { id: `af-team-${f.teams.away.id}`, name: f.teams.away.name },
    kickoff: new Date(kickoff).toISOString(),
    status: finished ? 'FINISHED' : status === 'NS' || status === 'TBD' ? 'TIMED' : ['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(status) ? 'UNKNOWN' : 'LIVE',
    homeGoals: finished ? ft.home : null, awayGoals: finished ? ft.away : null,
    availableAt: finished ? new Date(kickoff + 3 * HOUR).toISOString() : null
  };
}
export const isLeagueGame = m => !COVERED_LEAGUES.has(m.league.afId) && !EXCLUDED_NAME.test(m.league.name) &&
  /- ?\d+$/.test(m.league.round) && !EXCLUDED_ROUND.test(m.league.round);

const num = x => { const n = Number.parseFloat(x); return Number.isFinite(n) ? n : null; };
// Datos de "predictions" que usa el modelo de forma reciente.
export function featuresFromPrediction(data) {
  const r = data?.response?.[0], h = r?.teams?.home, a = r?.teams?.away;
  if (!h?.league || !a?.league) return null;
  const f = {
    homeFor: num(h.league.goals?.for?.average?.home), homeAgainst: num(h.league.goals?.against?.average?.home),
    homePlayed: h.league.fixtures?.played?.home ?? 0,
    awayFor: num(a.league.goals?.for?.average?.away), awayAgainst: num(a.league.goals?.against?.average?.away),
    awayPlayed: a.league.fixtures?.played?.away ?? 0,
    homeLast5For: num(h.last_5?.goals?.for?.average), homeLast5Against: num(h.last_5?.goals?.against?.average),
    awayLast5For: num(a.last_5?.goals?.for?.average), awayLast5Against: num(a.last_5?.goals?.against?.average)
  };
  return Object.values(f).every(v => v !== null) ? f : null;
}

const overPoisson = (lambda, goals) => { let t = Math.exp(-lambda), below = 0; for (let i = 0; i < goals; i++) { below += t; t *= lambda / (i + 1); } return 1 - below; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const GOALS = { 1.5: 2, 2.5: 3, 3.5: 4 };
// Mismo cálculo que el backtest: 70% temporada (casa/fuera) + 30% últimos 5.
export function formPredict(fixture, features, { line = 1.5, asOf = Date.now() } = {}) {
  const reject = reason => ({ eligible: false, matchId: fixture.id, reason });
  if (!features) return reject('Sin datos de forma reciente');
  if (Date.parse(fixture.kickoff) <= asOf) return reject('El partido ya empezó o no tiene horario');
  if (features.homePlayed < 4 || features.awayPlayed < 4) return reject('Muestra insuficiente: mínimo 4 partidos en casa/fuera esta temporada');
  const f = features;
  const expectedHome = clamp(0.7 * (f.homeFor + f.awayAgainst) / 2 + 0.3 * (f.homeLast5For + f.awayLast5Against) / 2, 0.1, 5);
  const expectedAway = clamp(0.7 * (f.awayFor + f.homeAgainst) / 2 + 0.3 * (f.awayLast5For + f.homeLast5Against) / 2, 0.1, 5);
  const probability = clamp(overPoisson(expectedHome + expectedAway, GOALS[line]), 0.03, 0.97);
  return {
    eligible: true, matchId: fixture.id, line, probability, rawProbability: probability,
    expectedGoals: expectedHome + expectedAway, expectedHome, expectedAway,
    modelVersion: FORM_MODEL_VERSION, calibrated: false, asOf: new Date(asOf).toISOString(), features: f,
    reasons: [
      `Local en casa: ${f.homeFor.toFixed(1)} a favor y ${f.homeAgainst.toFixed(1)} en contra por partido (${f.homePlayed} jugados).`,
      `Visitante fuera: ${f.awayFor.toFixed(1)} a favor y ${f.awayAgainst.toFixed(1)} en contra por partido (${f.awayPlayed} jugados).`,
      `Goles esperados por el modelo de forma reciente: ${(expectedHome + expectedAway).toFixed(2)}.`,
      'Liga sin validar: datos de API-Football (temporada actual y últimos 5 partidos).'
    ]
  };
}

// Elige qué partidos analizar: ligas no cubiertas, de liga, en la ventana, y
// repartidos entre ligas (una ronda por liga antes de repetir).
export function pickForAnalysis(fixtures, { now, until, limit, priority = () => 0 }) {
  const byLeague = new Map();
  for (const m of fixtures.filter(m => m.status === 'TIMED' && isLeagueGame(m) &&
    Date.parse(m.kickoff) > now + HOUR && Date.parse(m.kickoff) <= until)
    .sort((a, b) => priority(b) - priority(a) || a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id))) {
    (byLeague.get(m.league.afId) ?? byLeague.set(m.league.afId, []).get(m.league.afId)).push(m);
  }
  const queues = [...byLeague.values()], out = [];
  while (out.length < limit && queues.some(q => q.length)) for (const q of queues) if (q.length && out.length < limit) out.push(q.shift());
  return out;
}
