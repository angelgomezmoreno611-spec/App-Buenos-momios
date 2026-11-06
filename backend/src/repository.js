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
    return this.request(`selections?result=in.(pending,review)&kickoff=lte.${encodeURIComponent(new Date(now).toISOString())}&select=match_id&order=kickoff.asc&limit=1000`);
  }
  async applyResults(results) { return this.rpc('apply_results', { p_results: results }); }
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
