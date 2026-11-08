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
