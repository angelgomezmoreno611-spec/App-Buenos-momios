import { createApp } from './app.js';
import { SupabaseRepository } from './repository.js';
import { FootballData } from './provider.js';
import { FirebasePush } from './push.js';
import { FootballHttp } from './football/http.js';
import { FootballService } from './football/service.js';
import { CSV_LEAGUES, DEFAULT_CSV_LEAGUES } from './csvleagues.js';

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
  // Ligas de football-data.co.uk (CSV): "none" las desactiva.
  const csvLeagues = env.CSV_COMPETITIONS === undefined ? DEFAULT_CSV_LEAGUES
    : env.CSV_COMPETITIONS.trim() === 'none' ? [] : [...new Set(env.CSV_COMPETITIONS.split(',').map(x => x.trim()).filter(Boolean))];
  if (csvLeagues.some(code => !CSV_LEAGUES[code])) throw new Error('CSV_COMPETITIONS contiene una liga no compatible');
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
  return createApp({ ...common, csvLeagues,
    repo: new SupabaseRepository({ url: env.SUPABASE_URL,
      secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.SUPABASE_ANON_KEY }),
    provider: { snapshot: now => getProvider().snapshot(now), results: ids => getProvider().results(ids),
      season: (code, year) => getProvider().season(code, year), competitions: () => getProvider().competitions },
    push: new FirebasePush(env.FIREBASE_SERVICE_ACCOUNT_JSON)
  });
}
