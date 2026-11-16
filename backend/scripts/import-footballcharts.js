import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

// Descarga resultados de Football Charts (clave gratis: uso personal con atribución,
// "Data by football-charts.com") para backtest: las temporadas que da el plan
// gratuito (actual y anterior) de las ligas pedidas. Reanudable: guarda un archivo
// por liga y temporada en backend/data/fc/ y no repite los que ya existen. Va a
// ~1 consulta/s (límite 60/min) y se detiene si quedan 5 o menos del día.
// Uso: FOOTBALL_CHARTS_KEY=fc_… npm run import:fc -- brazil2,korea1   (o "all")
const BASE = 'https://footballcharts-backend.onrender.com/api/v1';
const key = process.env.FOOTBALL_CHARTS_KEY?.trim();
const arg = process.argv[2] ?? '';
if (!key || !arg) {
  console.error('Uso: FOOTBALL_CHARTS_KEY=fc_… npm run import:fc -- liga1,liga2 | all');
  process.exit(1);
}
const dir = new URL('../data/fc/', import.meta.url);
await mkdir(dir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let remaining = Infinity;
async function get(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  remaining = Number(response.headers.get('x-ratelimit-remaining') ?? remaining);
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? `HTTP ${response.status}`), { status: response.status });
  return body;
}
const exists = async url => access(url).then(() => true, () => false);

const catalogFile = new URL('leagues.json', dir);
const catalog = await exists(catalogFile) ? JSON.parse(await readFile(catalogFile, 'utf8')) : (await get('/leagues/')).leagues;
await writeFile(catalogFile, JSON.stringify(catalog));
const wanted = arg === 'all' ? catalog.map(l => l.league) : arg.split(',').map(s => s.trim()).filter(Boolean);
let calls = 0;
for (const slug of wanted) {
  const league = catalog.find(l => l.league === slug);
  if (!league) { console.log(`${slug}: no está en el catálogo`); continue; }
  for (const season of league.seasons) {
    const file = new URL(`${slug}_${season}.json`, dir);
    if (await exists(file)) continue;
    if (remaining <= 5) { console.log(`Quedan ${remaining} consultas: se sigue mañana.`); process.exit(0); }
    if (calls++) await sleep(1100);
    try {
      const data = await get(`/leagues/${slug}/results/?season=${encodeURIComponent(season)}`);
      await writeFile(file, JSON.stringify({ league, season, matches: data.matches ?? [] }));
      console.log(`${slug} ${season}: ${data.matches?.length ?? 0} partidos (quedan ${remaining})`);
    } catch (error) { console.log(`${slug} ${season}: ${error.message}`); }
  }
}
console.log(`Listo. Consultas usadas: ${calls}; quedan ${remaining}.`);
