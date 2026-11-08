import { createApp } from './app.js';
import { SupabaseRepository } from './repository.js';
import { FootballData } from './provider.js';
import { FirebasePush } from './push.js';
import { FootballHttp } from './football/http.js';
import { FootballService } from './football/service.js';
import { CSV_LEAGUES, defaultCsvLeagues } from './csvleagues.js';
import { MARKETS } from './tickets.js';
import { OLDB_LEAGUES, defaultOldbLeagues } from './openliga.js';
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
  // Mercado y tamaño de ticket. Por defecto: over 1.5, 6 partidos, umbral 0.80.
  const market = env.TICKET_MARKET?.trim() || 'OVER_1_5', legs = Number(env.TICKET_LEGS ?? 6);
  if (!MARKETS[market] || ![4, 6].includes(legs)) throw new Error('TICKET_MARKET o TICKET_LEGS inválidos');
  const minProbability = Number(env.MIN_PROBABILITY ?? (market === 'OVER_1_5' ? 0.8 : 0.65));
  // Ligas de football-data.co.uk (CSV): "none" las desactiva.
  const csvLeagues = env.CSV_COMPETITIONS === undefined ? defaultCsvLeagues(market)
    : env.CSV_COMPETITIONS.trim() === 'none' ? [] : [...new Set(env.CSV_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean))];
  if (csvLeagues.some(code => !CSV_LEAGUES[code])) throw new Error('CSV_COMPETITIONS contiene una liga no compatible');
  // OpenLigaDB (3. Liga): "none" la desactiva.
  const oldbLeagues = env.OPENLIGADB_COMPETITIONS === undefined ? defaultOldbLeagues(market)
    : env.OPENLIGADB_COMPETITIONS.trim() === 'none' ? [] : env.OPENLIGADB_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean);
  if (oldbLeagues.some(code => !OLDB_LEAGUES[code])) throw new Error('OPENLIGADB_COMPETITIONS contiene una liga no compatible');
  const openLiga = { leagues: oldbLeagues, get: url => footballHttp.get('openligadb', url) };
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
  return createApp({ ...common, csvLeagues, openLiga, market, legs, minProbability,
    // Ticket "El arriesgado del día" (2 over 3.5 + 2 over 2.5): TICKET_RISKY=false lo apaga.
    risky: env.TICKET_RISKY?.trim() !== 'false', evidence: EVIDENCE[market] ?? null,
    repo: new SupabaseRepository({ url: env.SUPABASE_URL,
      secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.SUPABASE_ANON_KEY }),
    provider: { snapshot: now => getProvider().snapshot(now), results: ids => getProvider().results(ids),
      season: (code, year) => getProvider().season(code, year), competitions: () => getProvider().competitions },
    push: new FirebasePush(env.FIREBASE_SERVICE_ACCOUNT_JSON)
  });
}
