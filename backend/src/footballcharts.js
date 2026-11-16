// Football Charts (football-charts.com): resultados y próximos partidos de 98 ligas.
// Clave gratis: 200 consultas/día, 60/min, temporada actual y anterior. Uso
// personal con atribución ("Data by football-charts.com"); una app usada por otras
// personas necesita su plan comercial. Sus probabilidades propias no se usan: la
// forma se calcula con nuestros datos (featuresFromHistory) y el modelo validado.
export const FC_BASE = 'https://footballcharts-backend.onrender.com/api/v1';
export const FC_ATTRIBUTION = 'Datos de football-charts.com (Data by football-charts.com).';

// Ligas activas (slug → nombre y id de API-Football, para no duplicar partidos).
// Backtest 2026-11-16 (`npm run backtest:form -- --summary`, temporadas actual y
// anterior): over 2.5 con ≥0.62 y over 1.5 con ≥0.79, mínimo 40 selecciones y
// acierto ≥62% / ≥80%. Elegidas las mejores 22 de 58: el acierto real
// probablemente será algo menor (sesgo de selección).
export const FC_LEAGUES = Object.freeze({
  'germany-north': { name: 'Regionalliga Nord (Alemania)', afId: 84 },
  holland3: { name: 'Tweede Divisie (Países Bajos)', afId: 492 },
  czech3a: { name: '3. CFL A (Chequia)', afId: 348 },
  estonia: { name: 'Meistriliiga (Estonia)', afId: 329 },
  swiss2: { name: 'Challenge League (Suiza)', afId: 208 },
  turkey2: { name: '1. Lig (Turquía)', afId: 204 },
  national: { name: 'National League (Inglaterra)', afId: 43 },
  slovakia1: { name: 'Nike liga (Eslovaquia)', afId: 332 },
  poland2: { name: 'I Liga (Polonia)', afId: 107 },
  holland2: { name: 'Eerste Divisie (Países Bajos)', afId: 89 },
  finland2: { name: 'Ykkösliiga (Finlandia)', afId: 1087 },
  czech3b: { name: '3. CFL B (Chequia)', afId: 685 },
  austria2: { name: '2. Liga (Austria)', afId: 219 },
  slovakia2: { name: '2. liga (Eslovaquia)', afId: 506 },
  south: { name: 'National League South (Inglaterra)', afId: 51 },
  hungary1: { name: 'NB I (Hungría)', afId: 271 },
  ireland2: { name: 'First Division (Irlanda)', afId: 358 },
  north: { name: 'National League North (Inglaterra)', afId: 50 },
  saudi1: { name: 'Pro League (Arabia Saudita)', afId: 307 },
  saudi2: { name: 'Division 1 (Arabia Saudita)', afId: 308 },
  slovenia1: { name: '1. SNL (Eslovenia)', afId: 373 },
  thai1: { name: 'Thai League 1 (Tailandia)', afId: 296 }
});
export const FC_VALIDATION = Object.freeze({
  OVER_2_5: { 'germany-north': [302, 0.719], holland3: [215, 0.716], czech3a: [124, 0.71], estonia: [131, 0.71],
    swiss2: [66, 0.682], turkey2: [84, 0.679], national: [143, 0.671], slovakia1: [64, 0.656], poland2: [94, 0.649],
    holland2: [255, 0.647], finland2: [76, 0.645], czech3b: [160, 0.644], austria2: [40, 0.65], slovakia2: [52, 0.635], south: [52, 0.635] },
  OVER_1_5: { 'germany-north': [327, 0.893], czech3a: [177, 0.893], holland3: [284, 0.87], finland2: [100, 0.86], poland2: [171, 0.86],
    holland2: [364, 0.852], national: [331, 0.846], saudi2: [126, 0.849], swiss2: [111, 0.838], czech3b: [213, 0.836],
    slovakia1: [108, 0.833], estonia: [235, 0.83], thai1: [64, 0.828], turkey2: [182, 0.824], saudi1: [188, 0.824],
    hungary1: [144, 0.812], north: [397, 0.804], slovenia1: [115, 0.8], ireland2: [42, 0.905] }
});
export const FC_AF_IDS = Object.freeze(Object.values(FC_LEAGUES).map(l => l.afId));
// Ids de liga en los partidos: fc-<slug>. Por mercado, las que NO pasaron.
export const fcBlocked = (market, slugs = Object.keys(FC_LEAGUES)) =>
  slugs.filter(s => !FC_VALIDATION[market]?.[s]).map(s => `fc-${s}`);

const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const team = (league, name) => ({ id: `fc-${league}-${slug(name)}`, name });

// Resultado terminado (endpoint /results/). Solo fase de liga.
export function normalizeFcResult(m, league) {
  const score = /^(\d+):(\d+)$/.exec(m?.score ?? '');
  if (!score || !m.kickoff_utc || (m.stage && m.stage !== 'league') || !FC_LEAGUES[league]) return null;
  const home = team(league, m.homeTeam), away = team(league, m.awayTeam);
  if (home.id === away.id) return null;
  return { id: `fc-${league}-${m.kickoff_utc.slice(0, 10)}-${slug(m.homeTeam)}-${slug(m.awayTeam)}`,
    league: { id: `fc-${league}`, name: FC_LEAGUES[league].name }, home, away,
    kickoff: new Date(m.kickoff_utc).toISOString(), status: 'FINISHED', homeGoals: Number(score[1]), awayGoals: Number(score[2]) };
}
// Próximo partido (endpoint /fixtures/). Fecha y hora en UTC según su documentación.
export function normalizeFcFixture(m, league) {
  if (!m?.match_date || !/^\d{2}:\d{2}/.test(m.time ?? '') || m.status !== 'scheduled' || !FC_LEAGUES[league]) return null;
  const kickoff = Date.parse(`${m.match_date}T${m.time.slice(0, 5)}:00Z`);
  const home = team(league, m.home_team), away = team(league, m.away_team);
  if (!Number.isFinite(kickoff) || home.id === away.id) return null;
  return { id: `fc-${league}-${m.match_date}-${slug(m.home_team)}-${slug(m.away_team)}`,
    league: { id: `fc-${league}`, name: FC_LEAGUES[league].name }, home, away,
    kickoff: new Date(kickoff).toISOString(), status: 'TIMED', homeGoals: null, awayGoals: null };
}

// Descarga de un lote de ligas: temporada actual (resultados) y próximos partidos.
// `get(path)` hace la consulta autenticada y respeta el ritmo. Devuelve también
// qué ligas se completaron para que el job reparta las ligas entre ejecuciones.
export async function syncFc(leagues, { get, catalog }) {
  const results = [], fixtures = [], done = [], failed = [];
  for (const league of leagues) {
    try {
      const season = catalog.find(l => l.league === league)?.seasons?.[0];
      if (!season) throw new Error('sin temporada en el catálogo');
      const res = await get(`/leagues/${league}/results/?season=${encodeURIComponent(season)}`);
      const fx = await get(`/leagues/${league}/fixtures/`);
      results.push(...(res.matches ?? []).map(m => normalizeFcResult(m, league)).filter(Boolean));
      fixtures.push(...(fx.matches ?? []).map(m => normalizeFcFixture(m, league)).filter(Boolean));
      done.push(league);
    } catch (error) { failed.push({ league, error: error.message }); }
  }
  return { results, fixtures, done, failed };
}
