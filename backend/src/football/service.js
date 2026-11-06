import { FootballHttp, footballError } from './http.js';
import { createAdapters, SOURCE_DEFINITIONS } from './providers.js';
import { demoSnapshot } from '../demo.js';

const MAX_CACHE_BYTES = 4_000_000;
const MAX_ROWS = 60;
const DISCLAIMER = 'Información complementaria: no modifica las probabilidades ni liquida los tickets. La cobertura depende de cada fuente.';
const seasonsYear = now => { const at = new Date(now); return at.getUTCFullYear() - Number(at.getUTCMonth() < 6); };

export class FootballService {
  constructor({ env = {}, http = new FootballHttp(), now = Date.now, mode = 'live' } = {}) {
    this.env = env; this.http = http; this.now = now; this.mode = mode;
    this.adapters = createAdapters(env, http); this.cache = new Map(); this.pending = new Map(); this.cacheBytes = 0;
  }
  sources() {
    if (this.mode === 'demo') return { sources: [{ id: 'demo', name: 'Demostración', enabled: true, season: false, date: false,
      competitions: [{ id: 'demo', name: 'Liga de ejemplo' }], note: 'Equipos y estadísticas inventados.' }], defaultSeason: seasonsYear(this.now()) };
    return { sources: SOURCE_DEFINITIONS.map(source => ({
      id: source.id, name: source.name, url: source.url, enabled: !source.key || Boolean(this.env[source.key]?.trim()),
      season: source.season === true, date: source.date === true, competitions: source.competitions,
      note: source.note, needsKey: Boolean(source.key), implemented: true
    })).concat([{ id: 'besoccer', name: 'BeSoccer', url: 'https://api.besoccer.com/es/presupuestos', enabled: false,
      implemented: false, season: false, date: false, competitions: [],
      note: 'API oficial con contratación. No se confirmó un plan público gratuito; falta acceso y documentación de integración.' }]),
      defaultSeason: seasonsYear(this.now()) };
  }
  _context({ provider = 'openligadb', competition, season, date } = {}) {
    const source = SOURCE_DEFINITIONS.find(source => source.id === provider);
    if (!source) throw footballError('Fuente desconocida o sin integración disponible.', 400);
    if (source.key && !this.env[source.key]?.trim()) throw footballError('Esta fuente necesita configurar su clave de acceso en el servidor.', 409);
    competition ??= source.competitions[0].id;
    if (!source.competitions.some(item => item.id === competition)) throw footballError('Competición no admitida para esta fuente.', 400);
    const currentYear = new Date(this.now()).getUTCFullYear();
    season = String(season ?? seasonsYear(this.now()));
    if (!/^\d{4}$/.test(season) || Number(season) < 2000 || Number(season) > currentYear + 1) throw footballError('Temporada inválida.', 400);
    date ??= new Date(this.now()).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw footballError('Fecha inválida.', 400);
    return { provider, competition, season, date, source };
  }
  async _cached(key, producer, ttl = 300_000) {
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) {
      this.cache.delete(key); this.cache.set(key, cached);
      return JSON.parse(cached.json);
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 6) throw footballError('Hay varias consultas en curso. Prueba de nuevo en unos segundos.', 429);
    const operation = (async () => {
      const value = await producer(), json = JSON.stringify(value), size = Buffer.byteLength(json);
      if (size <= MAX_CACHE_BYTES) {
        for (const [entryKey, entry] of this.cache) {
          if (entryKey === key || entry.expires <= this.now()) { this.cacheBytes -= entry.bytes; this.cache.delete(entryKey); }
        }
        while (this.cache.size >= 48 || this.cacheBytes + size > MAX_CACHE_BYTES) {
          const oldest = this.cache.keys().next().value;
          this.cacheBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest);
        }
        this.cache.set(key, { json, bytes: size, expires: this.now() + ttl }); this.cacheBytes += size;
      }
      return value;
    })();
    this.pending.set(key, operation);
    try { return await operation; } finally { this.pending.delete(key); }
  }
  _envelope(context) {
    return { provider: context.provider, source: context.source.name, sourceUrl: context.source.url,
      fetchedAt: new Date(this.now()).toISOString(), warnings: [context.source.note, DISCLAIMER],
      competition: context.competition, season: context.season, date: context.date };
  }
  async _all(context) {
    const key = `list:${context.provider}:${context.competition}:${context.season}:${context.source.date ? context.date : ''}`;
    return this._cached(key, async () => {
      const matches = (await this.adapters[context.provider].list(context)).filter(Boolean);
      const unique = [...new Map(matches.map(match => [match.id, match])).values()];
      return { ...this._envelope(context), matches: unique };
    }, context.provider === 'openfootball' ? 3_600_000 : 300_000);
  }
  async matches(options = {}) {
    if (this.mode === 'demo') return this._demo();
    const context = this._context(options), result = await this._all(context), at = this.now();
    const distance = match => Math.abs((Date.parse(match.kickoff ?? `${match.date}T12:00:00Z`) || 0) - at);
    result.matches.sort((a, b) => distance(a) - distance(b));
    return { ...result, totalMatches: result.matches.length, matches: result.matches.slice(0, MAX_ROWS) };
  }
  async detail(options = {}) {
    if (this.mode === 'demo') {
      const result = this._demo(), match = result.matches.find(match => match.remoteId === options.id);
      if (!match) throw footballError('Partido de ejemplo no encontrado.', 404);
      const { matches, ...meta } = result; return { ...meta, match };
    }
    const context = this._context(options), id = String(options.id ?? '');
    const validId = context.provider === 'openfootball' ? /^[a-f0-9]{24}$/.test(id)
      : context.provider === 'the-odds-api' ? /^[a-f0-9]{32}$/.test(id) : /^\d{1,16}$/.test(id);
    if (!validId) throw footballError('Identificador de partido inválido para esta fuente.', 400);
    return this._cached(`detail:${context.provider}:${context.competition}:${context.season}:${context.date}:${id}`, async () => {
      const adapter = this.adapters[context.provider];
      const match = adapter.detail ? await adapter.detail({ ...context, id }) : (await this._all(context)).matches.find(match => match.remoteId === id);
      if (!match || match.remoteId !== id) throw footballError('El partido no está disponible en esta fuente.', 404);
      return { ...this._envelope(context), match };
    });
  }
  _demo() {
    const at = this.now(), snapshot = demoSnapshot(at);
    return { provider: 'demo', source: 'Demostración', fetchedAt: new Date(at).toISOString(),
      warnings: ['DEMOSTRACIÓN: equipos, marcadores y estadísticas inventados.', DISCLAIMER],
      matches: snapshot.fixtures.slice(0, 16).map(match => ({ id: `demo:${match.id}`, remoteId: match.id, provider: 'demo',
        home: match.home.name, away: match.away.name, league: match.league.name, kickoff: match.kickoff,
        date: match.kickoff.slice(0, 10), status: 'scheduled', score: null, venue: 'Estadio de ejemplo', referee: null,
        statistics: [], lineups: [], events: [], odds: [] })) };
  }
}
