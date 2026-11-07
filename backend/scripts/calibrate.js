import { readFile } from 'node:fs/promises';
import { predict } from '../src/model.js';

// Ajusta una calibración Platt (p' = sigmoide(a + b·logit(p))) sobre las
// probabilidades SIN calibrar del modelo y la valida en partidos posteriores.
// Uso: npm run calibrate -- data/openfootball.json [fecha-de-corte]
const [file, cut = '2024-07-01'] = process.argv.slice(2);
if (!file) {
  console.error('Uso: npm run calibrate -- data/openfootball.json [AAAA-MM-DD]');
  process.exit(1);
}
const cutoff = Date.parse(`${cut}T00:00:00Z`);
const rows = JSON.parse(await readFile(file, 'utf8'));
const sorted = [...new Map(rows.map(r => [r.id, r])).values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));

const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const points = [];
for (const match of sorted) {
  if (match.status !== 'FINISHED' || !Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals)) continue;
  const prediction = predict({ ...match, status: 'TIMED' }, sorted, { asOf: Date.parse(match.kickoff) - 60_000 });
  if (!prediction.eligible) continue;
  points.push({ x: logit(prediction.rawProbability), y: Number(match.homeGoals + match.awayGoals >= 3),
    league: match.league.id, test: Date.parse(match.kickoff) >= cutoff });
}
const train = points.filter(p => !p.test), test = points.filter(p => p.test);

// Newton-Raphson para la regresión logística de dos parámetros.
let a = 0, b = 1;
for (let i = 0; i < 50; i++) {
  let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
  for (const { x, y } of train) {
    const p = sigmoid(a + b * x), w = p * (1 - p), e = p - y;
    ga += e; gb += e * x; haa += w; hab += w * x; hbb += w * x * x;
  }
  const det = haa * hbb - hab * hab;
  const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
  a -= da; b -= db;
  if (Math.abs(da) + Math.abs(db) < 1e-10) break;
}

function metrics(set, prob) {
  let brier = 0, logLoss = 0, base = 0;
  const rate = set.reduce((s, p) => s + p.y, 0) / set.length;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, actual: 0 }));
  for (const point of set) {
    const p = prob(point), y = point.y;
    brier += (p - y) ** 2; base += (rate - y) ** 2;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.count++; bin.predicted += p; bin.actual += y;
  }
  const thresholds = [0.55, 0.58, 0.6, 0.62, 0.65].map(t => {
    const picked = set.filter(point => prob(point) >= t);
    const hit = picked.length ? picked.reduce((s, p) => s + p.y, 0) / picked.length : null;
    return { threshold: t, picks: picked.length, hitRate: hit,
      // Estimación suponiendo partidos independientes; no simula tickets reales.
      ticket2: hit ** 2, ticket3: hit ** 3, ticket4: hit ** 4 };
  });
  return { n: set.length, overRate: rate, brier: brier / set.length, constantRateBrier: base / set.length,
    logLoss: logLoss / set.length,
    reliability: bins.filter(x => x.count).map(x => ({ count: x.count, predicted: +(x.predicted / x.count).toFixed(3), actual: +(x.actual / x.count).toFixed(3) })),
    thresholds };
}
const raw = point => sigmoid(point.x);
const calibrated = point => sigmoid(a + b * point.x);
console.log(JSON.stringify({
  cutoff: cut, calibration: { a, b }, trainMatches: train.length,
  test: { raw: metrics(test, raw), calibrated: metrics(test, calibrated) },
  note: 'constantRateBrier usa la tasa real del propio periodo de prueba (referencia optimista, no disponible al pronosticar).'
}, null, 2));
