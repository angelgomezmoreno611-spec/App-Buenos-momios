// Bzzoiro Sports Data (BSD): API gratis permanente (7500 consultas/día, 200 partidos
// por página, clave en BSD_TOKEN). Su licencia permite backtesting y mostrar datos en
// apps propias; prohíbe revender los datos crudos y usar varias cuentas.
// El job `bsd` guarda en `bsd_matches` (migración 018) todos los partidos de una
// ventana corta (resultados recientes y próximos 8 días); generate y settle solo leen
// la tabla. Se guardan todas las competiciones: las copas se calculan con la liga
// local de cada equipo (crossPredict), así que hace falta su historial.
export const BSD_BASE = 'https://sports.bzzoiro.com/api/v2';
export const BSD_ATTRIBUTION = 'Datos de partidos: Bzzoiro Sports Data (sports.bzzoiro.com).';

// Copas e internacionales: no son ligas, su historial no sirve para el modelo principal.
export const BSD_CUPS = new Set([7, 8, 27, 29, 30, 31, 32, 33, 35, 39, 40, 41, 42, 43, 44, 46, 48, 51, 56, 58, 59, 60, 61, 62, 63,
  64, 65, 66, 67, 68, 69, 71, 79, 81, 83, 90, 92, 93, 110]);
// Liga MX llega como dos competiciones (Apertura 19, Clausura 20): es una sola liga.
const LEAGUE_ALIAS = { 20: 19 };
export const bsdLeague = id => `bsd-${LEAGUE_ALIAS[id] ?? id}`;

export const BSD_LEAGUES = Object.freeze({
  'bsd-52': 'Super League (China)', 'bsd-15': 'Super League (Suiza)', 'bsd-91': 'National League (Inglaterra)',
  'bsd-70': 'NPL Queensland (Australia)', 'bsd-18': 'MLS', 'bsd-54': 'Eliteserien (Noruega)', 'bsd-36': 'Liga F (España, femenil)',
  'bsd-19': 'Liga MX', 'bsd-24': 'Super League (Grecia)', 'bsd-14': 'Pro League (Bélgica)', 'bsd-25': 'Ekstraklasa (Polonia)',
  'bsd-17': 'Saudi Pro League', 'bsd-8': 'Europa League', 'bsd-7': 'Champions League'
});

// Backtest 2026-11-22 (BSD 2023-07 a 2026-11, umbral fijo; "prueba" = desde 2025-07).
// Over 2.5 ≥0.67: ≥40 selecciones, ≥67% y prueba ≥62%. Over 1.5 ≥0.82: ≥40 y ≥82%.
// Europa League con la liga local de cada equipo: over 1.5 ≥0.82 86.5% (111; prueba
// 90.5%); en over 2.5 no distingue. [selecciones, acierto]
export const BSD_VALIDATION = Object.freeze({
  OVER_2_5: { 'bsd-52': [93, 0.72], 'bsd-15': [87, 0.713], 'bsd-91': [75, 0.707], 'bsd-70': [141, 0.702],
    'bsd-18': [192, 0.698], 'bsd-54': [79, 0.684], 'bsd-36': [60, 0.817],
    // Champions con el modelo de fuerza (src/strength.js): ajuste 69.4% (72), prueba 2025-26 80.7% (88).
    'bsd-7': [72, 0.694] },
  OVER_1_5: { 'bsd-52': [264, 0.833], 'bsd-15': [255, 0.831], 'bsd-91': [359, 0.85], 'bsd-70': [226, 0.827],
    'bsd-18': [557, 0.851], 'bsd-54': [255, 0.855], 'bsd-36': [171, 0.883], 'bsd-19': [153, 0.83],
    'bsd-24': [50, 0.88], 'bsd-14': [114, 0.886], 'bsd-25': [64, 0.906], 'bsd-17': [243, 0.864], 'bsd-8': [111, 0.865],
    // Champions (modelo de fuerza) ≥0.82: ajuste 81.1% (159), prueba 2025-26 88.5% (165).
    'bsd-7': [159, 0.811] }
});
// Copas que se calculan con la liga local de cada equipo.
export const BSD_CROSS = new Set(['bsd-8']);
// Competiciones que se calculan con el modelo de fuerza (src/strength.js).
export const BSD_STRENGTH = new Set(['bsd-7']);
// Ligas que BSD toma de otras fuentes (pasó en todos los mercados que esas cubrían):
// se desactivan allí para no repetir partidos.
export const BSD_REPLACES = Object.freeze({
  csv: { CHN: 'bsd-52', SWZ: 'bsd-15', USA: 'bsd-18', NOR: 'bsd-54', MEX: 'bsd-19', G1: 'bsd-24', B1: 'bsd-14', POL: 'bsd-25' },
  fc: { national: 'bsd-91', saudi1: 'bsd-17' }
});

// Ligas activas sin validar en ese mercado (mismo criterio que fcBlocked).
export const bsdBlocked = (market, leagues) => leagues.filter(l => !BSD_VALIDATION[market]?.[l]);

const STATUS = { finished: 'FINISHED', notstarted: 'TIMED', postponed: 'POSTPONED', canceled: 'CANCELLED', cancelled: 'CANCELLED',
  interrupted: 'SUSPENDED', unresolved: 'UNKNOWN' };
export function normalizeBsd(e) {
  if (!Number.isInteger(e?.id) || !Number.isInteger(e.league_id) || !Number.isInteger(e.home_team_id) || !Number.isInteger(e.away_team_id)
      || e.home_team_id === e.away_team_id || !Number.isFinite(Date.parse(e.event_date))) return null;
  const valid = Number.isInteger(e.home_score) && Number.isInteger(e.away_score) && e.home_score >= 0 && e.away_score >= 0;
  // Terminado sin marcador válido (BSD trae a veces -1): queda a revisión, no se inventa.
  const status = e.status === 'finished' && !valid ? 'UNKNOWN' : STATUS[e.status] ?? 'IN_PLAY';
  const scored = status === 'FINISHED';
  return { id: `bsd-${e.id}`, league: { id: bsdLeague(e.league_id), name: BSD_LEAGUES[bsdLeague(e.league_id)] ?? `BSD ${e.league_id}` },
    kickoff: new Date(e.event_date).toISOString(), status,
    home: { id: `bsd-${e.home_team_id}`, name: e.home_team }, away: { id: `bsd-${e.away_team_id}`, name: e.away_team },
    homeGoals: scored ? e.home_score : null, awayGoals: scored ? e.away_score : null, cup: BSD_CUPS.has(e.league_id),
    neutral: Boolean(e.is_neutral_ground) };
}

// Todos los partidos entre dos fechas (AAAA-MM-DD), página a página.
export async function bsdEvents(from, to, { get, maxPages = 40 }) {
  const out = [];
  let path = `/events/?date_from=${from}&date_to=${to}&limit=200`;
  for (let page = 0; path && page < maxPages; page++) {
    const data = await get(path);
    if (!Array.isArray(data?.results)) throw new Error('BSD: respuesta sin partidos');
    out.push(...data.results.map(normalizeBsd).filter(Boolean));
    path = data.next ? data.next.slice(data.next.indexOf('/events/')) : null;
  }
  return out;
}

// Bajas de un equipo (squad de BSD): solo quienes no están disponibles. "available" es
// el valor por defecto ("no reportado como baja"), no una confirmación de que juega.
export function absencesOf(squad) {
  const players = Array.isArray(squad?.players) ? squad.players : [];
  return { squadSize: players.length, players: players.filter(p => ['injured', 'doubtful', 'suspended'].includes(p?.availability))
    .map(p => ({ id: p.id, name: p.name, position: p.position ?? null, availability: p.availability,
      injuryType: p.injury_type || null, expectedReturn: p.injury_expected_return ?? null })) };
}
// Ligas cuyas bajas se guardan: las activas más las copas que se quieren medir.
export const BSD_ABSENCE_EXTRA = Object.freeze(['bsd-7', 'bsd-83']);
