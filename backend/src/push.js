import { createSign } from 'node:crypto';

export class FirebasePush {
  constructor(accountJson, fetcher = fetch) {
    this.account = accountJson ? JSON.parse(accountJson) : null; this.fetcher = fetcher;
  }
  get configured() { return Boolean(this.account?.project_id && this.account?.client_email && this.account?.private_key); }
  async accessToken() {
    if (this.cached && this.cached.expires > Date.now() + 60_000) return this.cached.token;
    const now = Math.floor(Date.now() / 1000), account = this.account;
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
    })}`;
    const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
    const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error(`Autorización Firebase: HTTP ${response.status}`);
    const data = await response.json();
    if (!data.access_token) throw new Error('Firebase no devolvió token');
    this.cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }
  async send(event) {
    if (!this.configured) throw new Error('Firebase no configurado');
    const response = await this.fetcher(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token: event.token,
        notification: { title: '¡Ticket acertado!', body: `Las 4 selecciones del ticket ${event.ticket_id.slice(0, 8)} superaron 2.5 goles.` },
        data: { ticketId: event.ticket_id, eventId: event.id, batchId: event.batch_id },
        android: { priority: 'high', notification: { tag: event.ticket_id } },
        apns: { headers: { 'apns-collapse-id': event.ticket_id } }
      } }), signal: AbortSignal.timeout(4000)
    });
    if (response.ok) return 'sent';
    const data = await response.json().catch(() => ({}));
    const codes = data.error?.details?.map(x => x.errorCode) ?? [];
    if (codes.includes('UNREGISTERED')) return 'invalid';
    throw new Error(`Firebase: HTTP ${response.status}`);
  }
}

export async function deliverNotifications(repo, push, deadline = Date.now() + 35_000) {
  if (!push.configured) return { sent: 0, disabled: true };
  const events = await repo.claimNotifications();
  let sent = 0, failed = 0;
  // Grupo pequeño: el lease permite reintentar si Vercel termina la función.
  for (const event of events) {
    if (Date.now() > deadline) break;
    try {
      if (!await repo.ownsDevice(event.user_id, event.token)) {
        await repo.finishNotification(event.id, event.lease, 'invalid'); continue;
      }
      const status = await push.send(event);
      await repo.finishNotification(event.id, event.lease, status);
      if (status === 'sent') sent++;
      if (status === 'invalid') await repo.removeDevice(event.user_id, event.token);
    } catch {
      failed++;
      await repo.finishNotification(event.id, event.lease, event.attempts >= 8 ? 'failed' : 'pending', 'No se pudo entregar; revisar credenciales o proveedor');
    }
  }
  return { sent, failed };
}
