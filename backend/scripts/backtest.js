import { readFile } from 'node:fs/promises';
import { predict } from '../src/model.js';

// JSON de partidos normalizados con availableAt real y anterior al pronóstico.
// No admite timestamps inventados para los históricos descargados hoy.
const file = process.argv[2];
// --line=1.5 mide over 1.5 (por defecto over 2.5).
const line = Number((process.argv.find(a => a.startsWith('--line=')) ?? '--line=2.5').slice(7));
const need = Math.floor(line) + 1;
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
  // Acierto por umbral (tickets escalonados: 0.65 / 0.63 / 0.62 y La soñadora 0.60).
  const tiers = (line < 2 ? [0.75, 0.79, 0.8, 0.85] : [0.6, 0.62, 0.63, 0.65, 0.7]).map(t => ({ threshold: t, selected: 0, hits: 0 }));
  for (const match of sorted) {
    if (match.status !== 'FINISHED' || !Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals)) continue;
    const prediction = predict({ ...match, status: 'TIMED' }, sorted, { asOf: Date.parse(match.kickoff) - 60_000, line });
    if (!prediction.eligible) continue;
    const actual = Number(match.homeGoals + match.awayGoals >= need), p = prediction.probability;
    n++; brier += (p - actual) ** 2;
    logLoss -= actual * Math.log(p) + (1 - actual) * Math.log(1 - p);
    baselineBrier += ((prediction.leagueOverRate ?? p) - actual) ** 2;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.count++; bin.predicted += p; bin.actual += actual;
    if (p >= .65) { selected++; hits += actual; }
    for (const t of tiers) if (p >= t.threshold) { t.selected++; t.hits += actual; }
  }
  console.log(JSON.stringify({ evaluated: n, brier: n ? brier / n : null,
    logLoss: n ? logLoss / n : null, leagueBaselineBrier: n ? baselineBrier / n : null,
    selected, hitRate: selected ? hits / selected : null,
    byThreshold: tiers.map(t => ({ threshold: t.threshold, selected: t.selected, hitRate: t.selected ? t.hits / t.selected : null })),
    reliability: bins.filter(b => b.count).map(b => ({ count: b.count, predicted: b.predicted / b.count, actual: b.actual / b.count })),
    note: 'Evaluación temporal. No calibra ni demuestra rentabilidad. No calcula ROI sin cuotas disponibles al apostar.'
  }, null, 2));
}
