import { SupabaseRepository } from '../src/repository.js';
import { bsdEvents, BSD_BASE } from '../src/bsd.js';

// Carga inicial de bsd_matches (migración 018): los últimos N días (400 por defecto)
// de todas las competiciones de BSD, mes por mes (~11 consultas por mes, de 7500/día).
// Después, el job bsd solo actualiza una ventana corta cada hora.
// Uso: npm run import:bsd -- [días]
const days = Number(process.argv[2] ?? 400), token = process.env.BSD_TOKEN?.trim();
if (!token || !Number.isInteger(days) || days < 1 || days > 400) {
  console.error('Uso: BSD_TOKEN=… npm run import:bsd -- [días 1-400]');
  process.exit(1);
}
const repo = new SupabaseRepository({ url: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY });
const get = async path => {
  await new Promise(resolve => setTimeout(resolve, 300));
  const response = await fetch(`${BSD_BASE}${path}`, { headers: { Authorization: `Token ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`BSD: HTTP ${response.status}`);
  return response.json();
};
const DAY = 86_400_000, end = Date.now() + 8 * DAY, utc = t => new Date(t).toISOString().slice(0, 10);
let total = 0;
for (let from = Date.now() - days * DAY; from < end; from += 30 * DAY) {
  const to = Math.min(from + 29 * DAY, end);
  const matches = await bsdEvents(utc(from), utc(to), { get, maxPages: 60 });
  await repo.storeBsdMatches(matches);
  total += matches.length;
  console.log(utc(from), utc(to), matches.length);
}
console.log('guardados', total);
