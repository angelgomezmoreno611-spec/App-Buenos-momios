import { readFile } from 'node:fs/promises';
import { predict, DEFAULT_PARAMS } from '../src/model.js';

// Búsqueda de parámetros con validación temporal:
// - selección SOLO con la temporada de validación [val, test);
// - la temporada de prueba [test, ...) se mide una vez con la configuración elegida.
// Todas las configuraciones se comparan sobre el mismo conjunto de partidos.
// Uso: npm run tune -- data/openfootball.json [AAAA-MM-DD validación] [AAAA-MM-DD prueba]
const [file, valFrom = '2023-07-01', testFrom = '2024-07-01'] = process.argv.slice(2);
if (!file) {
  console.error('Uso: npm run tune -- data/openfootball.json [validación] [prueba]');
  process.exit(1);
}
const valStart = Date.parse(`${valFrom}T00:00:00Z`), testStart = Date.parse(`${testFrom}T00:00:00Z`);
const rows = JSON.parse(await readFile(file, 'utf8'));
const sorted = [...new Map(rows.map(r => [r.id, r])).values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
const targets = sorted.filter(m => Date.parse(m.kickoff) >= valStart && m.status === 'FINISHED' &&
  Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals));

const grid = [];
for (const halfLifeDays of [45, 90, 180, 365])
  for (const maxGames of [10, 20, 38])
    for (const prior of [4, 8, 16]) grid.push({ halfLifeDays, maxGames, prior });
const weights = [0, 0.2, 0.4, 0.6, 0.8, 1];

const results = [];
for (const [i, base] of grid.entries()) {
  const preds = new Map();
  for (const match of targets) {
    const p = predict({ ...match, status: 'TIMED' }, sorted, { asOf: Date.parse(match.kickoff) - 60_000, params: { ...base, poissonWeight: 1 } });
    if (p.eligible) preds.set(match.id, { poisson: p.poisson, empirical: p.empirical });
  }
  results.push({ base, preds });
  console.error(`${i + 1}/${grid.length} ${JSON.stringify(base)}: ${preds.size} elegibles`);
}
const common = targets.filter(m => results.every(r => r.preds.has(m.id)));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function evaluate(preds, weight, set) {
  let brier = 0; const picks = { 0.6: [0, 0], 0.65: [0, 0] };
  for (const m of set) {
    const { poisson, empirical } = preds.get(m.id);
    const p = clamp(weight * poisson + (1 - weight) * empirical, 0.05, 0.92), y = Number(m.homeGoals + m.awayGoals >= 3);
    brier += (p - y) ** 2;
    for (const t of [0.6, 0.65]) if (p >= t) { picks[t][0]++; picks[t][1] += y; }
  }
  const pick = t => ({ picks: picks[t][0], hitRate: picks[t][0] ? +(picks[t][1] / picks[t][0]).toFixed(3) : null });
  return { n: set.length, brier: +(brier / set.length).toFixed(5), at60: pick(0.6), at65: pick(0.65) };
}
const val = common.filter(m => Date.parse(m.kickoff) < testStart), test = common.filter(m => Date.parse(m.kickoff) >= testStart);
const ranked = results.flatMap(r => weights.map(w => ({ params: { ...r.base, poissonWeight: w }, preds: r.preds, val: evaluate(r.preds, w, val) })))
  .sort((a, b) => a.val.brier - b.val.brier);
const best = ranked[0];
const current = ranked.find(r => JSON.stringify(r.params) === JSON.stringify({ ...DEFAULT_PARAMS }));
const yRate = set => set.reduce((s, m) => s + Number(m.homeGoals + m.awayGoals >= 3), 0) / set.length;
const trainRate = yRate(sorted.filter(m => Date.parse(m.kickoff) < valStart && Number.isInteger(m.homeGoals)));
const constBrier = set => set.reduce((s, m) => s + (trainRate - Number(m.homeGoals + m.awayGoals >= 3)) ** 2, 0) / set.length;
console.log(JSON.stringify({
  validation: { from: valFrom, to: testFrom, matches: val.length }, test: { from: testFrom, matches: test.length },
  top5Validation: ranked.slice(0, 5).map(r => ({ params: r.params, ...r.val })),
  current: { params: current.params, validation: current.val, test: evaluate(current.preds, current.params.poissonWeight, test) },
  best: { params: best.params, validation: best.val, test: evaluate(best.preds, best.params.poissonWeight, test) },
  constantBaselineTestBrier: +constBrier(test).toFixed(5),
  note: 'La referencia constante usa la tasa de over 2.5 previa a la validación (disponible al pronosticar).'
}, null, 2));
