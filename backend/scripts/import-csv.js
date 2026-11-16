import { writeFile, mkdir } from 'node:fs/promises';
import { CSV_LEAGUES, CSV_BASE, parseResults, seasonCode } from '../src/csvleagues.js';

// Descarga UNA VEZ el historial de ligas de football-data.co.uk para backtest
// (uso personal; no es la descarga automática del job csv). En serie y con pausa
// de 3 s entre archivos. Ligas "main": las últimas `seasons` temporadas; "extra":
// un archivo con todas. Salida en backend/data/ (ignorado por git).
// Uso: npm run import:csv -- D2,F2,JPN [temporadas=5]
const [codesArg, seasonsArg = '5'] = process.argv.slice(2);
const codes = (codesArg ?? '').split(',').map(c => c.trim()).filter(Boolean);
if (!codes.length || codes.some(c => !CSV_LEAGUES[c])) {
  console.error(`Uso: npm run import:csv -- CODIGOS [temporadas]. Disponibles: ${Object.keys(CSV_LEAGUES).join(',')}`);
  process.exit(1);
}
const seasons = Math.max(1, Math.min(8, Number(seasonsArg) || 5));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];
let first = true;
for (const code of codes) {
  const spec = CSV_LEAGUES[code];
  const files = spec.type === 'extra' ? [`${CSV_BASE}/new/${spec.file}.csv`]
    : Array.from({ length: seasons }, (_, back) => `${CSV_BASE}/mmz4281/${seasonCode(Date.now(), back)}/${spec.div}.csv`);
  for (const url of files) {
    if (!first) await sleep(3000);
    first = false;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { console.log(`${code}: ${url.split('/').slice(-2).join('/')} → HTTP ${response.status}`); continue; }
    const matches = parseResults(await response.text(), code).filter(m => m.status === 'FINISHED');
    rows.push(...matches);
    console.log(`${code}: ${url.split('/').slice(-2).join('/')} → ${matches.length} partidos`);
  }
}
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const out = new URL(`../data/csv-${codes.join('-')}.json`, import.meta.url);
await writeFile(out, JSON.stringify(rows));
console.log(`Guardados ${rows.length} partidos en ${out.pathname}`);
