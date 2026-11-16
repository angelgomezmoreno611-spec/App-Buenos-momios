import { readFile } from 'node:fs/promises';
import { formPredict, lambdaFromOver15 } from '../src/apifootball.js';

// Backtest del modelo de forma reciente (el de API-Football) con partidos
// históricos: para cada partido se calculan, SOLO con partidos anteriores, los
// mismos datos que da API-Football /predictions (promedios de la temporada en
// casa/fuera y últimos 5) y se compara el método original (mínimo 4 partidos)
// con el encogimiento hacia la media (mínimo 2). k se elige con la validación
// [inicio, test) y se mide una sola vez en [test, ...).
// Uso: npm run backtest:form -- data/openfootball.json [otro.json ...] [--test=AAAA-MM-DD]
const args = process.argv.slice(2);
const testFrom = Date.parse(`${(args.find(a => a.startsWith('--test=')) ?? '--test=2023-07-01').slice(7)}T00:00:00Z`);
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('Uso: npm run backtest:form -- data/openfootball.json [otro.json ...] [--test=AAAA-MM-DD]');
  process.exit(1);
}

const rows = [];
for (const file of files) rows.push(...JSON.parse(await readFile(file, 'utf8')));
const matches = [...new Map(rows.filter(m => m.status === 'FINISHED' && Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals))
  .map(m => [m.id, m])).values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));

const DAY = 86_400_000, LINES = { 'OVER_2_5': 2.5, 'OVER_1_5': 1.5 };
// Temporada = racha de partidos de la liga sin pausas de más de 45 días.
const lastByLeague = new Map(), seasonOf = new Map(), seasonCount = new Map();
for (const m of matches) {
  const lg = m.league.id, t = Date.parse(m.kickoff), last = lastByLeague.get(lg);
  if (last === undefined || t - last > 45 * DAY) seasonCount.set(lg, (seasonCount.get(lg) ?? 0) + 1);
  lastByLeague.set(lg, t);
  seasonOf.set(m.id, `${lg}#${seasonCount.get(lg)}`);
}

const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const homeGames = new Map(), awayGames = new Map(), recent = new Map(), leagueRecent = new Map();
const samples = []; // { t, goals, features, leagueGoals }
for (const m of matches) {
  const t = Date.parse(m.kickoff), season = seasonOf.get(m.id);
  const hk = `${season}|${m.home.id}`, ak = `${season}|${m.away.id}`;
  const hg = homeGames.get(hk) ?? [], ag = awayGames.get(ak) ?? [];
  const hr = (recent.get(m.home.id) ?? []).slice(-5), ar = (recent.get(m.away.id) ?? []).slice(-5);
  const lr = (leagueRecent.get(m.league.id) ?? []).filter(x => x.t > t - 120 * DAY);
  if (hg.length && ag.length && hr.length >= 5 && ar.length >= 5) {
    const over15 = lr.length >= 10 ? avg(lr.map(x => x.goals >= 2 ? 1 : 0)) : null;
    samples.push({ t, goals: m.homeGoals + m.awayGoals, id: m.id, leagueGoals: over15 === null ? undefined : lambdaFromOver15(over15),
      features: {
        homePlayed: hg.length, homeFor: avg(hg.map(x => x.for)), homeAgainst: avg(hg.map(x => x.against)),
        awayPlayed: ag.length, awayFor: avg(ag.map(x => x.for)), awayAgainst: avg(ag.map(x => x.against)),
        homeLast5For: avg(hr.map(x => x.for)), homeLast5Against: avg(hr.map(x => x.against)),
        awayLast5For: avg(ar.map(x => x.for)), awayLast5Against: avg(ar.map(x => x.against))
      } });
  }
  hg.push({ for: m.homeGoals, against: m.awayGoals }); homeGames.set(hk, hg);
  ag.push({ for: m.awayGoals, against: m.homeGoals }); awayGames.set(ak, ag);
  recent.set(m.home.id, [...(recent.get(m.home.id) ?? []).slice(-4), { for: m.homeGoals, against: m.awayGoals }]);
  recent.set(m.away.id, [...(recent.get(m.away.id) ?? []).slice(-4), { for: m.awayGoals, against: m.homeGoals }]);
  leagueRecent.set(m.league.id, [...lr, { t, goals: m.homeGoals + m.awayGoals }]);
}

function evaluate(set, market, threshold, opts) {
  const line = LINES[market], need = Math.floor(line) + 1;
  let picks = 0, hits = 0, brier = 0, n = 0;
  for (const s of set) {
    // asOf antes del partido; el kickoff ficticio solo cumple la validación de horario.
    const p = formPredict({ id: s.id, kickoff: new Date(s.t + 3_600_000).toISOString() }, s.features,
      { line, asOf: s.t, leagueGoals: opts.league ? s.leagueGoals : undefined, ...opts });
    if (!p.eligible) continue;
    const won = s.goals >= need ? 1 : 0;
    n++; brier += (p.probability - won) ** 2;
    if (p.probability >= threshold) { picks++; hits += won; }
  }
  return { evaluated: n, picks, hitRate: picks ? hits / picks : NaN, brier: n ? brier / n : NaN };
}

const fmt = r => `${String(r.picks).padStart(5)} sel. ${(r.hitRate * 100).toFixed(1).padStart(5)}% | evaluados ${r.evaluated} | Brier ${r.brier.toFixed(4)}`;
const validation = samples.filter(s => s.t < testFrom), test = samples.filter(s => s.t >= testFrom);
console.log(`Partidos: ${matches.length}; con datos de forma: ${samples.length} (validación ${validation.length}, prueba ${test.length})`);
for (const [market, threshold] of [['OVER_2_5', 0.65], ['OVER_1_5', 0.85]]) {
  console.log(`\n== ${market} con umbral ${threshold}`);
  const base = { method: 'raw' };
  console.log(`validación  original (mín. 4)       ${fmt(evaluate(validation, market, threshold, base))}`);
  const grid = [];
  for (const league of [false, true]) for (const k of [2, 4, 6, 8, 12]) {
    const r = evaluate(validation, market, threshold, { method: 'shrink', k, league });
    grid.push({ k, league, r });
    console.log(`validación  encogido k=${String(k).padEnd(2)} ${league ? 'liga  ' : 'global'}  ${fmt(r)}`);
  }
  // Elegida: la de más selecciones sin perder más de 1 punto de acierto frente al original.
  const ref = evaluate(validation, market, threshold, base).hitRate;
  const ok = grid.filter(g => g.r.hitRate >= ref - 0.01).sort((a, b) => b.r.picks - a.r.picks);
  const best = ok[0] ?? grid.sort((a, b) => b.r.hitRate - a.r.hitRate)[0];
  console.log(`elegida: k=${best.k} ${best.league ? 'liga' : 'global'}`);
  console.log(`PRUEBA     original (mín. 4)       ${fmt(evaluate(test, market, threshold, base))}`);
  console.log(`PRUEBA     encogido k=${String(best.k).padEnd(2)} ${best.league ? 'liga  ' : 'global'}  ${fmt(evaluate(test, market, threshold, { method: 'shrink', k: best.k, league: best.league }))}`);
}

// Curva de umbral con la configuración de producción (k=2, media de liga), en prueba.
console.log('\n== Over 2.5 según umbral (k=2, media de liga): elegir con validación, confirmar en prueba');
for (const threshold of [0.55, 0.58, 0.6, 0.62, 0.65, 0.7]) {
  const opts = { method: 'shrink', k: 2, league: true };
  console.log(`umbral ${threshold.toFixed(2)}  validación ${fmt(evaluate(validation, 'OVER_2_5', threshold, opts))}`);
  console.log(`             prueba     ${fmt(evaluate(test, 'OVER_2_5', threshold, opts))}`);
}
