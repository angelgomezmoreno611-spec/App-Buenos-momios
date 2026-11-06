import { footballError } from './http.js';
import * as normalize from './normalize.js';

const competitions = rows => rows.map(([id, name]) => ({ id, name }));
export const SOURCE_DEFINITIONS = [
  { id: 'openligadb', name: 'OpenLigaDB', url: 'https://openligadb.de/', season: true,
    competitions: competitions([['bl1', 'Bundesliga'], ['bl2', '2. Bundesliga'], ['bl3', '3. Liga']]),
    note: 'Datos comunitarios de OpenLigaDB, licencia ODbL. Puede haber retrasos y partidos sin marcador confirmado.' },
  { id: 'openfootball', name: 'OpenFootball', url: 'https://github.com/openfootball/football.json', season: true,
    competitions: competitions([['en.1', 'Premier League'], ['es.1', 'La Liga'], ['de.1', 'Bundesliga'], ['it.1', 'Serie A'], ['fr.1', 'Ligue 1']]),
    note: 'Archivo comunitario CC0. Sin seguimiento en vivo; las horas del archivo no tienen zona horaria verificable.' },
  { id: 'football-data', name: 'football-data.org', url: 'https://www.football-data.org/', key: 'FOOTBALL_DATA_TOKEN', season: true,
    competitions: competitions([['PL', 'Premier League'], ['PD', 'La Liga'], ['BL1', 'Bundesliga'], ['SA', 'Serie A'], ['FL1', 'Ligue 1'], ['DED', 'Eredivisie'], ['PPL', 'Primeira Liga']]),
    note: 'Plan gratuito: resultados con retraso y 10 consultas/minuto; los datos avanzados pueden requerir otro plan.' },
  { id: 'api-football', name: 'API-Football', url: 'https://www.api-football.com/', key: 'API_FOOTBALL_KEY', season: true,
    competitions: competitions([['39', 'Premier League'], ['140', 'La Liga'], ['78', 'Bundesliga'], ['135', 'Serie A'], ['61', 'Ligue 1'], ['262', 'Liga MX']]),
    note: 'Plan gratuito: 100 consultas/día, con temporadas limitadas. La disponibilidad de estadísticas y alineaciones varía.' },
  { id: 'sportmonks', name: 'Sportmonks', url: 'https://www.sportmonks.com/football-api/free-plan/', key: 'SPORTMONKS_TOKEN', date: true,
    competitions: competitions([['271', 'Superliga de Dinamarca'], ['501', 'Premiership de Escocia']]),
    note: 'Plan gratuito limitado a Dinamarca y Escocia. Se consulta una fecha, sin descargar toda la temporada.' },
  { id: 'thesportsdb', name: 'TheSportsDB', url: 'https://www.thesportsdb.com/api.php', season: true,
    competitions: competitions([['4328', 'Premier League']]),
    note: 'Acceso gratuito de muestra: hasta 15 partidos por temporada. Puede omitir encuentros y estadísticas; no es cobertura completa.' },
  { id: 'allsports', name: 'AllSportsAPI', url: 'https://allsportsapi.com/soccer-football-api', key: 'ALLSPORTS_API_KEY', date: true,
    competitions: competitions([['all', 'Ligas incluidas en tu cuenta']]),
    note: 'Plan gratuito: dos ligas elegidas por el proveedor y 260 consultas/hora. La app consulta un solo día.' },
  { id: 'the-odds-api', name: 'The Odds API', url: 'https://the-odds-api.com/', key: 'ODDS_API_KEY',
    competitions: competitions([['soccer_epl', 'Premier League'], ['soccer_spain_la_liga', 'La Liga'], ['soccer_germany_bundesliga', 'Bundesliga'], ['soccer_italy_serie_a', 'Serie A']]),
    note: 'Plan gratuito: 500 créditos/mes. Solo se consultan cuotas de totales en una región. El modelo de tickets no utiliza estas cuotas.' }
];

const url = (base, params = {}) => {
  const target = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) target.searchParams.set(key, String(value));
  return target.href;
};
const rows = (value, name) => {
  if (!Array.isArray(value)) throw footballError(`${name} no devolvió una lista válida. Revisa la cobertura de tu plan.`);
  return value.filter(item => item && typeof item === 'object' && !Array.isArray(item));
};
const first = (items, id, key) => rows(items, 'La fuente').find(item => String(key(item)) === id);
const apiRows = data => {
  if (data.errors && Object.keys(data.errors).length) throw footballError('API-Football no permite esta consulta. Revisa el plan y la temporada.');
  return rows(data.response, 'API-Football');
};
const allRows = data => {
  if (Number(data.success) !== 1) throw footballError('AllSportsAPI no permite esta consulta. Revisa el acceso de tu cuenta.');
  return data.result == null ? [] : rows(data.result, 'AllSportsAPI');
};

export function createAdapters(env, http) {
  const key = name => env[name]?.trim();
  const fd = path => http.get('football-data', `https://api.football-data.org/v4/${path}`, { 'X-Auth-Token': key('FOOTBALL_DATA_TOKEN') });
  const af = params => http.get('api-football', url('https://v3.football.api-sports.io/fixtures', params), { 'x-apisports-key': key('API_FOOTBALL_KEY') });
  const sm = (path, params) => http.get('sportmonks', url(`https://api.sportmonks.com/v3/football/${path}`, { api_token: key('SPORTMONKS_TOKEN'), ...params }));
  const ts = (path, params) => http.get('thesportsdb', url(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key('THESPORTSDB_API_KEY') || '123')}/${path}.php`, params));
  const all = params => http.get('allsports', url('https://apiv2.allsportsapi.com/football/', { met: 'Fixtures', APIkey: key('ALLSPORTS_API_KEY'), timezone: 'UTC', ...params }));
  const odds = (path, params = {}) => http.get('the-odds-api', url(`https://api.the-odds-api.com/v4/sports/${path}`, { apiKey: key('ODDS_API_KEY'), ...params }));
  const basicSm = 'participants;league;state;scores;venue';
  return {
    openligadb: {
      list: async ({ competition, season }) => rows(await http.get('openligadb', `https://api.openligadb.de/getmatchdata/${competition}/${season}`), 'OpenLigaDB').map(row => normalize.openLiga(row)),
      detail: async ({ id }) => {
        const data = await http.get('openligadb', `https://api.openligadb.de/getmatchdata/${id}`);
        return normalize.openLiga((Array.isArray(data) ? first(data, id, row => row.matchID) : data) ?? {});
      }
    },
    openfootball: {
      list: async ({ competition, season }) => {
        const folder = `${season}-${String(Number(season) + 1).slice(-2)}`;
        const data = await http.get('openfootball', `https://raw.githubusercontent.com/openfootball/football.json/master/${folder}/${competition}.json`);
        return rows(data.matches, 'OpenFootball').map(row => normalize.openFootball(row, competition, season, data.name));
      }
    },
    'football-data': {
      list: async ({ competition, season }) => {
        const data = await fd(`competitions/${competition}/matches?season=${season}`);
        return rows(data.matches, 'football-data.org').map(row => normalize.footballData({ ...row, competition: row.competition ?? data.competition }));
      },
      detail: async ({ id }) => normalize.footballData(await fd(`matches/${id}`))
    },
    'api-football': {
      list: async ({ competition, season }) => apiRows(await af({ league: competition, season })).map(normalize.apiFootball),
      // La consulta por id puede incluir estadísticas, eventos y alineaciones en una petición.
      detail: async ({ id }) => normalize.apiFootball(first(apiRows(await af({ id })), id, row => row.fixture?.id) ?? {})
    },
    sportmonks: {
      list: async ({ competition, date }) => {
        const data = await sm(`fixtures/date/${date}`, { filters: `fixtureLeagues:${competition}`, include: basicSm, per_page: 50, page: 1 });
        return rows(data.data, 'Sportmonks').map(normalize.sportmonks);
      },
      detail: async ({ id }) => normalize.sportmonks((await sm(`fixtures/${id}`, { include: `${basicSm};lineups;statistics.type;events.type` })).data ?? {})
    },
    thesportsdb: {
      list: async ({ competition, season }) => {
        const data = await ts('eventsseason', { id: competition, s: `${season}-${Number(season) + 1}` });
        return rows(data.events ?? [], 'TheSportsDB').filter(row => !row.strSport || row.strSport === 'Soccer').map(normalize.sportsDb);
      },
      detail: async ({ id }) => normalize.sportsDb(first((await ts('lookupevent', { id })).events ?? [], id, row => row.idEvent) ?? {})
    },
    allsports: {
      list: async ({ date }) => allRows(await all({ from: date, to: date })).map(normalize.allSports),
      detail: async ({ id, date }) => normalize.allSports(first(allRows(await all({ from: date, to: date, matchId: id })), id, row => row.event_key) ?? {})
    },
    'the-odds-api': {
      // El catálogo de eventos no consume créditos. Solo el detalle pide cuotas.
      list: async ({ competition }) => rows(await odds(`${competition}/events`, { dateFormat: 'iso' }), 'The Odds API').map(normalize.oddsApi),
      detail: async ({ competition, id }) => normalize.oddsApi(await odds(`${competition}/events/${id}/odds`, { regions: 'eu', markets: 'totals', oddsFormat: 'decimal', dateFormat: 'iso' }))
    }
  };
}
