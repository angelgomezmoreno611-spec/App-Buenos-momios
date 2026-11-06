import { generateBatch, dayKey, resultOf } from './tickets.js';
import { deliverNotifications } from './push.js';

export async function runJob(kind, { repo, provider, push, timeZone, minProbability, now = Date.now() }) {
  const owner = await repo.acquireLock();
  if (!owner) return { skipped: true, reason: 'Hay otra tarea ejecutándose o se está respetando el límite del proveedor' };
  const deadline = Date.now() + 45_000;
  try {
    if (kind === 'generate') {
      const day = dayKey(now, timeZone), existing = await repo.getBatch(day);
      if (existing) return { batchId: existing.id, existing: true };
      const excludedIds = await repo.usedMatches(now);
      const snapshot = await provider.snapshot(now);
      const batch = generateBatch(snapshot, { now, timeZone, minProbability, excludedIds });
      const publishedId = await repo.publish(batch);
      return { batchId: publishedId, tickets: batch.tickets.length, missingMatches: batch.missingMatches };
    }
    if (kind === 'settle') {
      const pending = await repo.pendingMatches(now);
      const ids = [...new Set(pending.map(x => x.match_id))];
      // Hasta 9 consultas por ejecución, bajo la cuota gratuita de 10/min.
      const results = [];
      for (let i = 0; i < Math.min(ids.length, 450); i += 50) {
        if (Date.now() > deadline - 6000) break;
        const matches = await provider.results(ids.slice(i, i + 50));
        results.push(...matches.map(m => ({ matchId: m.id, ...resultOf(m) })));
      }
      if (results.length) await repo.applyResults(results);
      return { checked: results.length, remaining: Math.max(0, ids.length - results.length) };
    }
    if (kind === 'notify') return deliverNotifications(repo, push, deadline);
    throw new Error('Tarea desconocida');
  } finally { await repo.releaseLock(owner); }
}
