const LIMITS = {
  openligadb: [20, 1000], openfootball: [15, 300], 'football-data': [10, 1200],
  'api-football': [8, 80], sportmonks: [10, 200], thesportsdb: [20, 300],
  allsports: [20, 200], 'the-odds-api': [5, 10]
};
const HOSTS = { openligadb: 'api.openligadb.de', openfootball: 'raw.githubusercontent.com',
  'football-data': 'api.football-data.org', 'api-football': 'v3.football.api-sports.io',
  sportmonks: 'api.sportmonks.com', thesportsdb: 'www.thesportsdb.com',
  allsports: 'apiv2.allsportsapi.com', 'the-odds-api': 'api.the-odds-api.com' };
export const footballError = (message, status = 503) => Object.assign(new Error(message), { status, publicMessage: message });

// Un transporte por instancia de la API: una consulta externa a la vez.
// Los presupuestos son locales al proceso; el proveedor sigue siendo autoritativo.
export class FootballHttp {
  constructor({ fetcher = fetch, now = Date.now, maxBytes = 2_000_000, timeoutMs = 5000 } = {}) {
    this.fetcher = fetcher; this.now = now; this.maxBytes = maxBytes; this.timeoutMs = timeoutMs;
    this.queue = Promise.resolve(); this.pending = 0; this.budgets = new Map();
  }
  async get(source, url, headers = {}) {
    const parsed = new URL(url);
    if (!LIMITS[source] || parsed.protocol !== 'https:' || HOSTS[source] !== parsed.hostname || parsed.username || parsed.password) {
      throw footballError('Dirección de proveedor inválida', 400);
    }
    if (this.pending >= 6) throw footballError('Hay varias consultas en curso. Inténtalo en unos segundos.', 429);
    this.pending++;
    const operation = this.queue.then(() => this._get(source, parsed, headers));
    this.queue = operation.catch(() => {});
    try { return await operation; }
    finally { this.pending--; }
  }
  async _get(source, url, headers) {
    const at = this.now(), day = new Date(at).toISOString().slice(0, 10);
    let budget = this.budgets.get(source);
    if (!budget) { budget = { day, calls: 0, recent: [], blockedUntil: 0 }; this.budgets.set(source, budget); }
    if (budget.day !== day) { budget.day = day; budget.calls = 0; }
    budget.recent = budget.recent.filter(time => time > at - 60_000);
    const [minute, daily] = LIMITS[source];
    if (at < budget.blockedUntil || budget.recent.length >= minute || budget.calls >= daily) {
      throw footballError('Se alcanzó el presupuesto de consultas de esta fuente. Prueba más tarde.', 429);
    }
    budget.calls++; budget.recent.push(at);
    let response;
    try { response = await this.fetcher(url.href, { headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch { throw footballError('La fuente no respondió a tiempo. Inténtalo más tarde.'); }
    if (!response.ok) {
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        budget.blockedUntil = at + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86400) * 1000 : 60_000);
      }
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw footballError('La fuente no permite este acceso. Revisa su clave, cobertura y plan.');
      if (response.status === 404) throw footballError('La fuente no dispone de ese partido o temporada.', 404);
      if (response.status === 429) throw footballError('La fuente agotó su cuota de consultas. Prueba más tarde.', 429);
      throw footballError('La fuente está temporalmente fuera de servicio.');
    }
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > this.maxBytes) { await response.body?.cancel(); throw footballError('La respuesta excede el límite de datos de la app.'); }
    if (!response.body) throw footballError('La fuente devolvió una respuesta vacía.');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) { await reader.cancel(); throw footballError('La respuesta excede el límite de datos de la app.'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    } catch (error) {
      if (error.publicMessage) throw error;
      throw footballError('La fuente devolvió datos incompletos o con un formato inválido.');
    } finally { reader.releaseLock(); }
  }
}
