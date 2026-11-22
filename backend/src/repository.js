export class SupabaseRepository {
  constructor({ url, secretKey, publishableKey, serviceKey, anonKey, fetcher = fetch }) {
    this.secretKey = secretKey?.trim() || serviceKey?.trim();
    this.publishableKey = publishableKey?.trim() || anonKey?.trim();
    if (!url?.trim() || !this.secretKey || !this.publishableKey) throw new Error('Falta configurar Supabase');
    this.url = url.trim().replace(/\/$/, ''); this.fetcher = fetcher;
  }
  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await this.fetcher(`${this.url}/rest/v1/${path}`, {
      method, headers: { apikey: this.secretKey,
        ...(this.secretKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${this.secretKey}` }),
        'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw Object.assign(new Error(`Base de datos: HTTP ${response.status}`), { upstreamStatus: response.status });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  rpc(name, body) { return this.request(`rpc/${name}`, { method: 'POST', body }); }
  async authenticate(bearer) {
    if (!bearer?.startsWith('Bearer ')) return null;
    const response = await this.fetcher(`${this.url}/auth/v1/user`, {
      headers: { apikey: this.publishableKey, Authorization: bearer }, signal: AbortSignal.timeout(5000)
    });
    if ([401, 403].includes(response.status)) return null;
    if (!response.ok) throw new Error('No se pudo verificar la sesión');
    const user = await response.json();
    return user.id ? user : null;
  }
  async getBatch(day) {
    const batches = await this.request(`batches?day=eq.${encodeURIComponent(day)}&select=payload&limit=1`);
    if (!batches.length) return null;
    const batch = batches[0].payload;
    const [tickets, picks] = await Promise.all([
      this.request(`tickets?batch_id=eq.${batch.id}&select=id,status`),
      this.request(`selections?batch_id=eq.${batch.id}&select=ticket_id,match_id,result,score,checked_at`)
    ]);
    for (const t of batch.tickets) {
      t.status = tickets.find(x => x.id === t.id)?.status ?? t.status;
      for (const p of t.selections) {
        const settled = picks.find(x => x.ticket_id === t.id && x.match_id === p.match.id);
        if (settled) Object.assign(p, { result: settled.result, score: settled.score, checkedAt: settled.checked_at });
      }
    }
    return batch;
  }
  async publish(batch) { return this.rpc('publish_batch', { p_batch: batch }); }
  // Tanda más reciente (la que sigue en juego o la última resuelta).
  async latestBatch() {
    const rows = await this.request('batches?select=day&order=day.desc&limit=1');
    return rows.length ? this.getBatch(rows[0].day) : null;
  }
  // Aviso para todos los teléfonos con avisos activos; `key` evita repetirlo.
  async enqueueNotice(key, batchId, { title, body }) {
    return this.rpc('enqueue_notice', { p_key: key, p_batch_id: batchId, p_title: title, p_body: body });
  }
  async saveBatch(userId, batchId) {
    return this.rpc('save_batch', { p_user_id: userId, p_batch_id: batchId });
  }
  async usedMatches(now = Date.now()) {
    const rows = await this.request(`selections?kickoff=gte.${encodeURIComponent(new Date(now).toISOString())}&select=match_id&limit=1000`);
    return rows.map(r => r.match_id);
  }
  async subscribe(userId, batchId, token, platform) {
    return this.rpc('subscribe_device', { p_user_id: userId, p_batch_id: batchId, p_token: token, p_platform: platform });
  }
  async removeDevice(userId, token) {
    return this.request(`devices?user_id=eq.${userId}&token=eq.${encodeURIComponent(token)}`, { method: 'DELETE' });
  }
  async pendingMatches(now = Date.now()) {
    return this.request(`selections?result=in.(pending,review)&kickoff=lte.${encodeURIComponent(new Date(now).toISOString())}&select=match_id,market&order=kickoff.asc&limit=1000`);
  }
  async applyResults(results) { return this.rpc('apply_results', { p_results: results }); }
  async storedSeasons() {
    const rows = await this.request('history_seasons?select=league,season&limit=1000');
    return rows.map(r => `${r.league}:${r.season}`);
  }
  async storeHistory(league, season, matches) {
    const rows = matches.map(m => ({
      id: m.id, league, league_name: m.league.name, season, kickoff: m.kickoff,
      home_id: m.home.id, home_name: m.home.name, away_id: m.away.id, away_name: m.away.name,
      home_goals: m.homeGoals, away_goals: m.awayGoals, available_at: m.availableAt
    }));
    const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
    for (let i = 0; i < rows.length; i += 500) {
      await this.request('match_history?on_conflict=id', { method: 'POST', body: rows.slice(i, i + 500), headers: upsert });
    }
    // La marca va al final: si algo falla antes, la temporada se reintenta.
    await this.request('history_seasons?on_conflict=league,season', { method: 'POST', body: [{ league, season, matches: rows.length }], headers: upsert });
  }
  // Partidos guardados desde una fecha, en el formato de model.js. Pagina de 1000
  // en 1000 porque PostgREST limita las filas por respuesta.
  async history(since, leagues) {
    const out = [], filter = `kickoff=gte.${encodeURIComponent(new Date(since).toISOString())}` +
      (leagues?.length ? `&league=in.(${leagues.map(encodeURIComponent).join(',')})` : '');
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const rows = await this.request(`match_history?${filter}&select=*&order=id.asc&limit=1000&offset=${offset}`);
      out.push(...rows.map(r => ({
        id: r.id, league: { id: r.league, name: r.league_name }, kickoff: new Date(r.kickoff).toISOString(),
        status: 'FINISHED', home: { id: r.home_id, name: r.home_name }, away: { id: r.away_id, name: r.away_name },
        homeGoals: r.home_goals, awayGoals: r.away_goals, availableAt: new Date(r.available_at).toISOString()
      })));
      if (rows.length < 1000) break;
    }
    return out;
  }
  // football-data.co.uk: máximo dos descargas automáticas por semana.
  async csvSyncsSince(since) {
    const rows = await this.request(`csv_sync_runs?ran_at=gte.${encodeURIComponent(new Date(since).toISOString())}&select=id&limit=10`);
    return rows.length;
  }
  async recordCsvSync() {
    await this.request('csv_sync_runs', { method: 'POST', body: [{}], headers: { Prefer: 'return=minimal' } });
  }
  async storeCsvMatches(matches, before) {
    const rows = matches.map(m => ({
      id: m.id, league: m.league.id, league_name: m.league.name, kickoff: m.kickoff,
      home_id: m.home.id, home_name: m.home.name, away_id: m.away.id, away_name: m.away.name,
      status: m.status, home_goals: m.homeGoals, away_goals: m.awayGoals, available_at: m.availableAt,
      synced_at: new Date().toISOString()
    }));
    const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
    for (let i = 0; i < rows.length; i += 500) {
      await this.request('csv_matches?on_conflict=id', { method: 'POST', body: rows.slice(i, i + 500), headers: upsert });
    }
    // Fuera de la ventana del modelo ya no se usan.
    await this.request(`csv_matches?kickoff=lt.${encodeURIComponent(new Date(before).toISOString())}`, { method: 'DELETE' });
  }
  async csvMatches(since) {
    const out = [], filter = `kickoff=gte.${encodeURIComponent(new Date(since).toISOString())}`;
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const rows = await this.request(`csv_matches?${filter}&select=*&order=id.asc&limit=1000&offset=${offset}`);
      out.push(...rows.map(r => ({
        id: r.id, league: { id: r.league, name: r.league_name }, kickoff: new Date(r.kickoff).toISOString(),
        status: r.status, home: { id: r.home_id, name: r.home_name }, away: { id: r.away_id, name: r.away_name },
        homeGoals: r.home_goals, awayGoals: r.away_goals,
        availableAt: r.available_at ? new Date(r.available_at).toISOString() : null
      })));
      if (rows.length < 1000) break;
    }
    return out;
  }
  async csvResults(ids) {
    if (!ids.length) return [];
    const list = ids.map(id => `"${id.replace(/["\\]/g, '')}"`).join(',');
    const rows = await this.request(`csv_matches?id=in.(${encodeURIComponent(list)})&status=eq.FINISHED&select=id,status,home_goals,away_goals`);
    return rows.map(r => ({ id: r.id, status: r.status, homeGoals: r.home_goals, awayGoals: r.away_goals }));
  }
  // Football Charts: partidos de las ligas activas (job fc) y última sincronización.
  async storeFcMatches(matches, before) {
    // Un id repetido en el mismo lote hace fallar el upsert (HTTP 500): se deja uno,
    // el terminado si lo hay.
    const unique = new Map();
    for (const m of matches) if (!unique.has(m.id) || m.status === 'FINISHED') unique.set(m.id, m);
    const rows = [...unique.values()].map(m => ({
      id: m.id, league: m.league.id.replace(/^fc-/, ''), league_name: m.league.name, kickoff: m.kickoff,
      home_id: m.home.id, home_name: m.home.name, away_id: m.away.id, away_name: m.away.name,
      status: m.status, home_goals: m.homeGoals, away_goals: m.awayGoals, synced_at: new Date().toISOString()
    }));
    const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
    for (let i = 0; i < rows.length; i += 500) {
      await this.request('fc_matches?on_conflict=id', { method: 'POST', body: rows.slice(i, i + 500), headers: upsert });
    }
    if (before) await this.request(`fc_matches?kickoff=lt.${encodeURIComponent(new Date(before).toISOString())}`, { method: 'DELETE' });
  }
  #fcRow(r) {
    return { id: r.id, league: { id: `fc-${r.league}`, name: r.league_name }, kickoff: new Date(r.kickoff).toISOString(),
      status: r.status, home: { id: r.home_id, name: r.home_name }, away: { id: r.away_id, name: r.away_name },
      homeGoals: r.home_goals, awayGoals: r.away_goals };
  }
  async fcMatches(since) {
    const out = [], filter = `kickoff=gte.${encodeURIComponent(new Date(since).toISOString())}`;
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const rows = await this.request(`fc_matches?${filter}&select=*&order=id.asc&limit=1000&offset=${offset}`);
      out.push(...rows.map(r => this.#fcRow(r)));
      if (rows.length < 1000) break;
    }
    return out;
  }
  // Resultado por id; si no coincide (fecha de calendario distinta), por equipos ±1 día.
  async fcResults(ids) {
    if (!ids.length) return [];
    const list = ids.map(id => `"${id.replace(/["\\]/g, '')}"`).join(',');
    const exact = (await this.request(`fc_matches?id=in.(${encodeURIComponent(list)})&status=eq.FINISHED&select=*`)).map(r => this.#fcRow(r));
    const out = exact.map(m => ({ ...m, matchId: m.id }));
    for (const id of ids.filter(id => !exact.some(m => m.id === id))) {
      const pending = (await this.request(`fc_matches?id=eq.${encodeURIComponent(id)}&select=*`))[0];
      if (!pending) continue;
      const t = Date.parse(pending.kickoff), day = 86_400_000;
      const near = await this.request(`fc_matches?status=eq.FINISHED&home_id=eq.${encodeURIComponent(pending.home_id)}` +
        `&away_id=eq.${encodeURIComponent(pending.away_id)}&kickoff=gte.${encodeURIComponent(new Date(t - day).toISOString())}` +
        `&kickoff=lte.${encodeURIComponent(new Date(t + day).toISOString())}&select=*&limit=1`);
      if (near[0]) out.push({ ...this.#fcRow(near[0]), matchId: id });
    }
    return out;
  }
  async fcSyncTimes() {
    const rows = await this.request('fc_sync?select=league,synced_at');
    return new Map(rows.map(r => [r.league, Date.parse(r.synced_at)]));
  }
  async markFcSync(leagues) {
    if (!leagues.length) return;
    const now = new Date().toISOString();
    await this.request('fc_sync?on_conflict=league', { method: 'POST', body: leagues.map(league => ({ league, synced_at: now })),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  }
  // Bzzoiro Sports Data: partidos de todas sus competiciones (job bsd).
  async storeBsdMatches(matches, before) {
    const unique = new Map(matches.map(m => [m.id, m]));
    const rows = [...unique.values()].map(m => ({
      id: m.id, league: m.league.id, league_name: m.league.name, cup: Boolean(m.cup), neutral: Boolean(m.neutral), kickoff: m.kickoff,
      home_id: m.home.id, home_name: m.home.name ?? '', away_id: m.away.id, away_name: m.away.name ?? '',
      status: m.status, home_goals: m.homeGoals, away_goals: m.awayGoals, synced_at: new Date().toISOString()
    }));
    const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
    for (let i = 0; i < rows.length; i += 500) {
      await this.request('bsd_matches?on_conflict=id', { method: 'POST', body: rows.slice(i, i + 500), headers: upsert });
    }
    if (before) await this.request(`bsd_matches?kickoff=lt.${encodeURIComponent(new Date(before).toISOString())}`, { method: 'DELETE' });
  }
  #bsdRow(r) {
    return { id: r.id, league: { id: r.league, name: r.league_name }, cup: r.cup, neutral: Boolean(r.neutral), kickoff: new Date(r.kickoff).toISOString(),
      status: r.status, home: { id: r.home_id, name: r.home_name }, away: { id: r.away_id, name: r.away_name },
      homeGoals: r.home_goals, awayGoals: r.away_goals };
  }
  // Partidos desde `since`: de las ligas dadas o, con `teams`, de esos equipos (sin copas).
  async bsdMatches(since, { leagues, teams } = {}) {
    if ((leagues && !leagues.length) || (teams && !teams.length)) return [];
    const list = xs => xs.map(x => encodeURIComponent(x)).join(',');
    const out = [], filter = `kickoff=gte.${encodeURIComponent(new Date(since).toISOString())}` +
      (leagues ? `&league=in.(${list(leagues)})` : '') +
      (teams ? `&cup=eq.false&or=(home_id.in.(${list(teams)}),away_id.in.(${list(teams)}))` : '');
    for (let offset = 0; offset < 100_000; offset += 1000) {
      const rows = await this.request(`bsd_matches?${filter}&select=*&order=id.asc&limit=1000&offset=${offset}`);
      out.push(...rows.map(r => this.#bsdRow(r)));
      if (rows.length < 1000) break;
    }
    return out;
  }
  async bsdResults(ids) {
    if (!ids.length) return [];
    const list = ids.map(id => `"${id.replace(/["\\]/g, '')}"`).join(',');
    const rows = await this.request(`bsd_matches?id=in.(${encodeURIComponent(list)})&status=in.(FINISHED,POSTPONED,CANCELLED,SUSPENDED,UNKNOWN)&select=*`);
    return rows.map(r => this.#bsdRow(r));
  }
  // Modelo de fuerza: todos los resultados desde `since` (solo las columnas necesarias).
  async bsdResultsSince(since) {
    const out = [], filter = `status=eq.FINISHED&kickoff=gte.${encodeURIComponent(new Date(since).toISOString())}`;
    for (let offset = 0; offset < 200_000; offset += 1000) {
      const rows = await this.request(`bsd_matches?${filter}&select=id,kickoff,home_id,away_id,home_goals,away_goals,neutral&order=id.asc&limit=1000&offset=${offset}`);
      out.push(...rows.map(r => ({ id: r.id, kickoff: r.kickoff, home: { id: r.home_id }, away: { id: r.away_id },
        homeGoals: r.home_goals, awayGoals: r.away_goals, neutral: r.neutral })));
      if (rows.length < 1000) break;
    }
    return out;
  }
  async storeRatings({ mu, home, teams, matches, fittedAt }) {
    const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
    const rows = teams.map(t => ({ team: t.team, attack: t.attack, defense: t.defense, games: t.games, fitted_at: fittedAt }));
    for (let i = 0; i < rows.length; i += 500) await this.request('bsd_ratings?on_conflict=team', { method: 'POST', body: rows.slice(i, i + 500), headers: upsert });
    // Equipos que ya no tienen partidos en la ventana: fuera.
    await this.request(`bsd_ratings?fitted_at=lt.${encodeURIComponent(fittedAt)}`, { method: 'DELETE' });
    await this.request('bsd_rating_meta?on_conflict=singleton', { method: 'POST', headers: upsert,
      body: [{ singleton: true, mu, home, matches, fitted_at: fittedAt }] });
  }
  async ratings(teams) {
    if (!teams.length) return null;
    const [meta] = await this.request('bsd_rating_meta?select=mu,home,fitted_at');
    if (!meta) return null;
    const rows = await this.request(`bsd_ratings?team=in.(${teams.map(t => encodeURIComponent(t)).join(',')})&select=team,attack,defense,games`);
    return { mu: meta.mu, home: meta.home, fittedAt: new Date(meta.fitted_at).toISOString(), teams: new Map(rows.map(r => [r.team, r])) };
  }
  // Bajas por equipo y día (job bsd).
  async bsdAbsenceTeams(day) {
    const rows = await this.request(`bsd_absences?day=eq.${day}&select=team&limit=5000`);
    return new Set(rows.map(r => r.team));
  }
  async storeBsdAbsences(rows) {
    if (!rows.length) return;
    await this.request('bsd_absences?on_conflict=day,team', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows.map(r => ({ day: r.day, team: r.team, team_name: r.teamName, match_id: r.matchId, kickoff: r.kickoff,
        squad_size: r.squadSize, players: r.players })) });
  }
  // API-Football (plan gratuito): consultas gastadas por día y listas ya bajadas.
  async afUsage(day) {
    const rows = await this.request(`af_usage?day=eq.${day}&select=calls,lists_done`);
    return rows[0] ? { calls: rows[0].calls, lists: rows[0].lists_done } : { calls: 0, lists: [] };
  }
  async setAfUsage(day, calls, lists) {
    await this.request('af_usage?on_conflict=day', { method: 'POST', body: [{ day, calls, lists_done: lists }],
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  }
  // Upsert sin tocar features/analyzed_at (no van en el cuerpo).
  async storeAfMatches(matches, before) {
    const rows = matches.map(m => ({
      id: m.id, league_id: m.league.afId, league_name: m.league.name, round: m.league.round ?? '', kickoff: m.kickoff,
      home_id: m.home.id, home_name: m.home.name, away_id: m.away.id, away_name: m.away.name,
      status: m.status, home_goals: m.homeGoals, away_goals: m.awayGoals, synced_at: new Date().toISOString()
    }));
    const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
    for (let i = 0; i < rows.length; i += 500) {
      await this.request('af_matches?on_conflict=id', { method: 'POST', body: rows.slice(i, i + 500), headers: upsert });
    }
    if (before) await this.request(`af_matches?kickoff=lt.${encodeURIComponent(new Date(before).toISOString())}`, { method: 'DELETE' });
  }
  async saveAfFeatures(id, features) {
    await this.request(`af_matches?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH',
      body: { features, analyzed_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' } });
  }
  #afRow(r) {
    return {
      id: r.id, league: { id: `af-${r.league_id}`, name: r.league_name, afId: r.league_id, round: r.round },
      home: { id: r.home_id, name: r.home_name }, away: { id: r.away_id, name: r.away_name },
      kickoff: new Date(r.kickoff).toISOString(), status: r.status, homeGoals: r.home_goals, awayGoals: r.away_goals,
      formFeatures: r.features ?? null, analyzed: Boolean(r.analyzed_at)
    };
  }
  // Partidos por jugar entre dos fechas (con o sin análisis).
  async afUpcoming(from, until, { analyzed } = {}) {
    const filter = `status=eq.TIMED&kickoff=gt.${encodeURIComponent(new Date(from).toISOString())}&kickoff=lte.${encodeURIComponent(new Date(until).toISOString())}` +
      (analyzed === true ? '&analyzed_at=not.is.null' : analyzed === false ? '&analyzed_at=is.null' : '');
    const rows = await this.request(`af_matches?${filter}&select=*&order=kickoff.asc&limit=1000`);
    return rows.map(r => this.#afRow(r));
  }
  // Resultados guardados de esas ligas desde `since` (para calcular la forma sin consultas).
  async afFinished(leagueIds, since) {
    const ids = [...new Set(leagueIds)].filter(Number.isInteger);
    if (!ids.length) return [];
    const out = [], page = 1000;
    for (let offset = 0; offset < 50_000; offset += page) {
      const rows = await this.request(`af_matches?status=eq.FINISHED&league_id=in.(${ids.join(',')})` +
        `&kickoff=gte.${encodeURIComponent(new Date(since).toISOString())}` +
        `&select=id,league_id,league_name,round,kickoff,home_id,home_name,away_id,away_name,status,home_goals,away_goals` +
        `&order=kickoff.asc,id.asc&limit=${page}&offset=${offset}`);
      out.push(...rows.map(r => this.#afRow(r)));
      if (rows.length < page) break;
    }
    return out;
  }
  async afLeagueRates() {
    const rows = await this.request('af_league_rates?select=league_id,matches,over15&limit=5000');
    return new Map(rows.map(r => [r.league_id, { matches: r.matches, over15: r.over15 }]));
  }
  async afResults(ids) {
    if (!ids.length) return [];
    const list = ids.map(id => `"${id.replace(/["\\]/g, '')}"`).join(',');
    const rows = await this.request(`af_matches?id=in.(${encodeURIComponent(list)})&status=in.(FINISHED,UNKNOWN)&select=*`);
    return rows.map(r => this.#afRow(r));
  }
  async acquireLock() { return this.rpc('acquire_job_lock', {}); }
  async releaseLock(owner) { return this.rpc('release_job_lock', { p_owner: owner }); }
  async claimNotifications() { return this.rpc('claim_notifications', {}); }
  async finishNotification(id, lease, status, error = null) {
    return this.request(`notification_outbox?id=eq.${id}&lease=eq.${lease}`, {
      method: 'PATCH', body: { status, last_error: error, locked_until: null }
    });
  }
  async ownsDevice(userId, token) {
    const rows = await this.request(`devices?user_id=eq.${userId}&token=eq.${encodeURIComponent(token)}&select=token&limit=1`);
    return rows.length > 0;
  }
}
