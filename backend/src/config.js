import { createApp } from './app.js';
import { SupabaseRepository } from './repository.js';
import { FootballData } from './provider.js';
import { FirebasePush } from './push.js';
import { FootballHttp } from './football/http.js';
import { FootballService } from './football/service.js';
import { CSV_LEAGUES, defaultCsvLeagues } from './csvleagues.js';
import { MARKETS } from './tickets.js';
import { OLDB_LEAGUES, defaultOldbLeagues } from './openliga.js';
import { FC_LEAGUES, FC_BASE } from './footballcharts.js';
import { BSD_LEAGUES, BSD_BASE, BSD_REPLACES } from './bsd.js';
import { EVIDENCE } from './model.js';

export function configuredApp(env = process.env) {
  const mode = env.DATA_MODE ?? 'live';
  const footballHttp = new FootballHttp();
  const common = {
    mode, timeZone: env.APP_TIMEZONE ?? 'America/Mazatlan', cronSecret: env.CRON_SECRET,
    allowedOrigin: env.ALLOWED_ORIGIN, minProbability: Number(env.MIN_PROBABILITY ?? 0.65),
    footballService: new FootballService({ env, http: footballHttp, mode })
  };
  if (mode === 'demo') return createApp(common);
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) throw new Error('CRON_SECRET requiere mínimo 32 caracteres');
  // Mercado, tamaño y número de tickets. Por defecto: 3 tickets over 2.5 de 4 partidos (umbral 0.67).
  const market = env.TICKET_MARKET?.trim() || 'OVER_2_5', legs = Number(env.TICKET_LEGS ?? 4);
  const maxTickets = Number(env.TICKET_COUNT ?? 3);
  if (!MARKETS[market] || ![3, 4, 6].includes(legs)) throw new Error('TICKET_MARKET o TICKET_LEGS inválidos');
  if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 4) throw new Error('TICKET_COUNT debe estar entre 1 y 4');
  // Over 2.5: umbral por ticket (TICKET_THRESHOLDS, p. ej. "0.67,0.65,0.63" para escalonar).
  const thresholdList = env.TICKET_THRESHOLDS?.trim() || (market === 'OVER_2_5' && !env.MIN_PROBABILITY ? '0.67,0.67,0.67' : '');
  const ticketThresholds = thresholdList ? thresholdList.split(',').map(Number) : null;
  if (ticketThresholds && (ticketThresholds.length < 1 || ticketThresholds.length > 4 || ticketThresholds.some(t => !(t >= 0.5 && t <= 0.95)))) {
    throw new Error('TICKET_THRESHOLDS debe tener de 1 a 4 umbrales entre 0.5 y 0.95');
  }
  const minProbability = ticketThresholds?.[0] ?? Number(env.MIN_PROBABILITY ?? (market === 'OVER_1_5' ? 0.8 : 0.67));
  // Días que abarca una tanda (1 = solo el día de la tanda; 7 = una semana).
  const days = Number(env.TICKET_DAYS ?? 7);
  // Máximo de tandas nuevas en 7 días (puede haber varias en juego a la vez).
  const weeklyMax = Number(env.TICKET_WEEKLY_MAX ?? 2);
  if (!Number.isInteger(weeklyMax) || weeklyMax < 1 || weeklyMax > 7) throw new Error('TICKET_WEEKLY_MAX debe estar entre 1 y 7');
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('TICKET_DAYS debe estar entre 1 y 7');
  // Bzzoiro Sports Data (BSD_TOKEN): BSD_COMPETITIONS cambia las ligas ("none" desactiva;
  // ids como "18,52" o "bsd-18"). Las ligas que toma se quitan de CSV y Football Charts.
  const bsdLeagues = !env.BSD_TOKEN?.trim() || env.BSD_COMPETITIONS?.trim() === 'none' ? []
    : env.BSD_COMPETITIONS ? env.BSD_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean).map(x => x.startsWith('bsd-') ? x : `bsd-${x}`)
      : Object.keys(BSD_LEAGUES);
  if (bsdLeagues.some(l => !BSD_LEAGUES[l])) throw new Error('BSD_COMPETITIONS contiene una liga no compatible');
  const takenByBsd = (map, code) => bsdLeagues.includes(map[code]);
  // Ligas de football-data.co.uk (CSV): "none" las desactiva.
  // En over 2.5 también se cargan las ligas validadas solo en over 1.5, pero únicamente
  // como respaldo over 1.5 (`backupOnly`): nunca entran como over 2.5.
  const withBackup = (defaults, market) => market === 'OVER_2_5' ? [...new Set([...defaults('OVER_2_5'), ...defaults('OVER_1_5')])] : defaults(market);
  const backupOf = defaults => market === 'OVER_2_5' ? defaults('OVER_1_5').filter(c => !defaults('OVER_2_5').includes(c)) : [];
  const csvLeagues = env.CSV_COMPETITIONS === undefined ? withBackup(defaultCsvLeagues, market).filter(c => !takenByBsd(BSD_REPLACES.csv, c))
    : env.CSV_COMPETITIONS.trim() === 'none' ? [] : [...new Set(env.CSV_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean))];
  if (csvLeagues.some(code => !CSV_LEAGUES[code])) throw new Error('CSV_COMPETITIONS contiene una liga no compatible');
  // OpenLigaDB (3. Liga): "none" la desactiva.
  const oldbLeagues = env.OPENLIGADB_COMPETITIONS === undefined ? withBackup(defaultOldbLeagues, market)
    : env.OPENLIGADB_COMPETITIONS.trim() === 'none' ? [] : env.OPENLIGADB_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean);
  if (oldbLeagues.some(code => !OLDB_LEAGUES[code])) throw new Error('OPENLIGADB_COMPETITIONS contiene una liga no compatible');
  const openLiga = { leagues: oldbLeagues, get: url => footballHttp.get('openligadb', url) };
  const backupOnly = [...backupOf(defaultCsvLeagues), ...backupOf(defaultOldbLeagues)].filter(c => csvLeagues.includes(c) || oldbLeagues.includes(c));
  // Football Charts (clave gratis, uso personal con atribución): FC_COMPETITIONS cambia las
  // ligas ("none" desactiva). Ritmo: ≤55 consultas/min (su límite es 60).
  const fcLeagues = !env.FOOTBALL_CHARTS_KEY?.trim() || env.FC_COMPETITIONS?.trim() === 'none' ? []
    : env.FC_COMPETITIONS ? env.FC_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean)
      : Object.keys(FC_LEAGUES).filter(l => !takenByBsd(BSD_REPLACES.fc, l));
  if (fcLeagues.some(l => !FC_LEAGUES[l])) throw new Error('FC_COMPETITIONS contiene una liga no compatible');
  let fcLast = 0, fcRemaining = Infinity;
  const fc = fcLeagues.length ? { key: env.FOOTBALL_CHARTS_KEY.trim(), leagues: fcLeagues, perRun: 10, get: async path => {
    const wait = fcLast + 1100 - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    fcLast = Date.now();
    // Margen de 5 consultas del límite diario (200 por correo, se reinicia a las 00:00 UTC).
    if (fcRemaining <= 5) throw new Error('Football Charts: cuota diaria casi agotada');
    const response = await fetch(`${FC_BASE}${path}`, { headers: { Authorization: `Bearer ${env.FOOTBALL_CHARTS_KEY.trim()}` }, signal: AbortSignal.timeout(15_000) });
    const left = Number(response.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(left)) fcRemaining = left;
    if (!response.ok) throw new Error(`Football Charts: HTTP ${response.status}`);
    return response.json();
  } } : null;
  let bsdLast = 0;
  const bsd = bsdLeagues.length ? { leagues: bsdLeagues, get: async path => {
    // En serie y con pausa de 300 ms (límite 7500/día, sin límite por minuto publicado).
    const wait = bsdLast + 300 - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    bsdLast = Date.now();
    const response = await fetch(`${BSD_BASE}${path}`, { headers: { Authorization: `Token ${env.BSD_TOKEN.trim()}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`BSD: HTTP ${response.status}`);
    return response.json();
  } } : null;
  // Un proveedor por instancia de la API, creado solo cuando un job lo necesita.
  // Auth, historial y lectura de tickets funcionan sin token de fútbol.
  let football;
  const getProvider = () => {
    if (!env.FOOTBALL_DATA_TOKEN?.trim()) {
      throw Object.assign(new Error('Falta FOOTBALL_DATA_TOKEN para consultar partidos'), { status: 503 });
    }
    return football ??= new FootballData({ token: env.FOOTBALL_DATA_TOKEN.trim(), competitions: env.FOOTBALL_COMPETITIONS,
      fetcher: async (url, options) => Response.json(await footballHttp.get('football-data', url, options.headers)) });
  };
  return createApp({ ...common, csvLeagues, openLiga, market, legs, minProbability, ticketThresholds, backupOnly, fc, bsd,
    maxTickets: ticketThresholds?.length ?? maxTickets,
    // Ticket "La soñadora" (8 over 2.5): TICKET_DREAMER=false lo apaga.
    dreamer: env.TICKET_DREAMER?.trim() !== 'false',
    // Partidos de los próximos `days` días (hora local); la tanda sigue hasta resolverse.
    days, weeklyMax,
    // Descubrimiento de partidos con API-Football (plan gratuito); AF_DISCOVERY=false lo apaga.
    apiFootball: env.API_FOOTBALL_KEY?.trim() && env.AF_DISCOVERY?.trim() !== 'false' ? { key: env.API_FOOTBALL_KEY.trim() } : null, evidence: EVIDENCE[market] ?? null,
    repo: new SupabaseRepository({ url: env.SUPABASE_URL,
      secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.SUPABASE_ANON_KEY }),
    provider: { snapshot: now => getProvider().snapshot(now), results: ids => getProvider().results(ids),
      season: (code, year) => getProvider().season(code, year), competitions: () => getProvider().competitions },
    push: new FirebasePush(env.FIREBASE_SERVICE_ACCOUNT_JSON)
  });
}
