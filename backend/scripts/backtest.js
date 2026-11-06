import { readFile } from 'node:fs/promises';
import { predict } from '../src/model.js';

// JSON de partidos normalizados con availableAt real y anterior al pronóstico.
// No admite timestamps inventados para los históricos descargados hoy.
const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run backtest -- ./partidos-normalizados.json');
  process.exitCode = 1;
} else {
  const rows = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('El archivo debe ser un array');
  const sorted = [...new Map(rows.map(r => [r.id, r])).values()]
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, count: 0, predicted: 0, actual: 0 }));
  let n = 0, brier = 0, logLoss = 0, baselineBrier = 0, selected = 0, hits = 0;
  for (const match of sorted) {
    if (match.status !== 'FINISHED' || !Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals)) continue;
    const prediction = predict({ ...match, status: 'TIMED' }, sorted, { asOf: Date.parse(match.kickoff) - 60_000 });
    if (!prediction.eligible) continue;
    const actual = Number(match.homeGoals + match.awayGoals >= 3), p = prediction.probability;
    n++; brier += (p - actual) ** 2;
    logLoss -= actual * Math.log(p) + (1 - actual) * Math.log(1 - p);
    baselineBrier += (prediction.leagueOverRate - actual) ** 2;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.count++; bin.predicted += p; bin.actual += actual;
    if (p >= .65) { selected++; hits += actual; }
  }
  console.log(JSON.stringify({ evaluated: n, brier: n ? brier / n : null,
    logLoss: n ? logLoss / n : null, leagueBaselineBrier: n ? baselineBrier / n : null,
    selected, hitRate: selected ? hits / selected : null,
    reliability: bins.filter(b => b.count).map(b => ({ count: b.count, predicted: b.predicted / b.count, actual: b.actual / b.count })),
    note: 'Evaluación temporal. No calibra ni demuestra rentabilidad. No calcula ROI sin cuotas disponibles al apostar.'
  }, null, 2));
}
