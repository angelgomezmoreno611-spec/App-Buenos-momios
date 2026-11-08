// Baseline explicable. Pesos y umbrales iniciales, todavía sin calibrar.
export const MODEL_VERSION = 'goals-poisson-shrinkage-v1';
const DAY = 86_400_000;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const validGoals = x => Number.isInteger(x) && x >= 0;
// Calibración Platt sobre logit(p). Identidad mientras no haya ajuste validado.
export const CALIBRATION = null;
// Parámetros del baseline. Cambiarlos solo con validación temporal (scripts/tune.js).
// Resultado medido con validación temporal (scripts/calibrate.js y tune.js) sobre
// datos que el modelo no vio. Corresponde a DEFAULT_PARAMS y al umbral indicado.
export const MODEL_EVIDENCE = Object.freeze({
  period: '2024-25', leagues: 'Premier League, LaLiga, Bundesliga, Serie A y Ligue 1',
  source: 'OpenFootball (CC0)', threshold: 0.65, picks: 154, hitRate: 0.656
});
// Evidencia del over 1.5 (scripts en scratchpad, misma validación temporal):
// 2022-07 a 2025-05, umbral 0.80, sin LaLiga ni Serie A (76% y 70% medidos).
export const MODEL_EVIDENCE_O15 = Object.freeze({
  period: '2022-23 a 2024-25', leagues: 'Premier League, Bundesliga y Ligue 1', market: 'OVER_1_5',
  source: 'OpenFootball (CC0)', threshold: 0.8, picks: 1336, hitRate: 0.851
});
export const EVIDENCE = Object.freeze({ OVER_2_5: { ...MODEL_EVIDENCE, market: 'OVER_2_5' }, OVER_1_5: MODEL_EVIDENCE_O15 });
export const DEFAULT_PARAMS = Object.freeze({ halfLifeDays: 90, maxGames: 20, prior: 8, poissonWeight: 0.8 });
export function calibrate(p, calibration = CALIBRATION) {
  if (!calibration) return p;
  const x = Math.log(p / (1 - p));
  return clamp(1 / (1 + Math.exp(-(calibration.a + calibration.b * x))), 0.05, 0.92);
}

// Líneas de goles soportadas: over 1.5 = 2+ goles; over 2.5 = 3+; over 3.5 = 4+.
export const LINES = Object.freeze({ 1.5: 2, 2.5: 3, 3.5: 4 });
// P(N >= k) con N ~ Poisson(lambda).
export function overLine(lambda, line = 2.5) {
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error('Lambda inválida');
  const k = LINES[line];
  if (!k) throw new Error('Línea no soportada');
  let term = Math.exp(-lambda), below = 0;
  for (let i = 0; i < k; i++) { below += term; term *= lambda / (i + 1); }
  return 1 - below;
}
export const over25 = lambda => overLine(lambda, 2.5);

function sample(rows, team, venue, at, leagueRate, baseFor, baseAgainst, params, need) {
  const games = rows.filter(r => r[venue].id === team)
    .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).slice(0, params.maxGames);
  let weight = 0, scored = 0, conceded = 0, overs = 0;
  for (const g of games) {
    const w = Math.exp(-Math.LN2 * (at - Date.parse(g.kickoff)) / (params.halfLifeDays * DAY));
    const gf = venue === 'home' ? g.homeGoals : g.awayGoals;
    const ga = venue === 'home' ? g.awayGoals : g.homeGoals;
    weight += w; scored += w * gf; conceded += w * ga;
    overs += w * Number(gf + ga >= need);
  }
  // Partidos equivalentes de prior que suavizan muestras pequeñas.
  const prior = params.prior;
  return {
    count: games.length,
    effectiveSample: weight,
    attack: (scored + prior * baseFor) / (weight + prior),
    defense: (conceded + prior * baseAgainst) / (weight + prior),
    overRate: (overs + prior * leagueRate) / (weight + prior),
    rawOverRate: games.length ? games.filter(g => g.homeGoals + g.awayGoals >= need).length / games.length : null,
    latest: games[0]?.kickoff
  };
}

export function predict(fixture, history, { asOf = Date.now(), params = DEFAULT_PARAMS, line = 2.5 } = {}) {
  const need = LINES[line];
  if (!need) throw new Error('Línea no soportada');
  const reject = reason => ({ eligible: false, matchId: fixture.id, reason });
  const kickoff = Date.parse(fixture.kickoff);
  if (!Number.isFinite(kickoff) || kickoff <= asOf) return reject('El partido ya empezó o no tiene horario');
  if (!['TIMED', 'SCHEDULED'].includes(fixture.status)) return reject('Partido no programado');
  if (!fixture.home?.id || !fixture.away?.id || fixture.home.id === fixture.away.id) return reject('Equipos inválidos');
  if (fixture.contextRisk === true) return reject('Exclusión contextual explícita');
  // En backtest tampoco se pueden usar marcadores que no estaban disponibles.
  const seen = new Set();
  const rows = history.filter(r => {
    const end = Date.parse(r.availableAt);
    if (seen.has(r.id) || r.id === fixture.id || r.league.id !== fixture.league.id || r.status !== 'FINISHED' ||
        !validGoals(r.homeGoals) || !validGoals(r.awayGoals) || !Number.isFinite(end) || end > asOf ||
        Date.parse(r.kickoff) >= asOf || Date.parse(r.kickoff) < asOf - 400 * DAY) return false;
    seen.add(r.id); return true;
  });
  if (rows.length < 50) return reject('Menos de 50 resultados en la liga');
  const homeMean = rows.reduce((s, r) => s + r.homeGoals, 0) / rows.length;
  const awayMean = rows.reduce((s, r) => s + r.awayGoals, 0) / rows.length;
  if (homeMean < 0.2 || awayMean < 0.2) return reject('Promedios de liga insuficientes');
  const leagueRate = rows.filter(r => r.homeGoals + r.awayGoals >= need).length / rows.length;
  const h = sample(rows, fixture.home.id, 'home', asOf, leagueRate, homeMean, awayMean, params, need);
  const a = sample(rows, fixture.away.id, 'away', asOf, leagueRate, awayMean, homeMean, params, need);
  if (h.count < 6 || a.count < 6 || h.effectiveSample < 3 || a.effectiveSample < 3) {
    return reject('Muestra insuficiente: mínimo 6 juegos por condición y 3 efectivos');
  }
  if (asOf - Date.parse(h.latest) > 60 * DAY || asOf - Date.parse(a.latest) > 60 * DAY) {
    return reject('Sin actividad reciente en la condición analizada');
  }
  const expectedHome = clamp(h.attack * a.defense / homeMean, 0.15, 4);
  const expectedAway = clamp(a.attack * h.defense / awayMean, 0.15, 4);
  const poisson = overLine(expectedHome + expectedAway, line);
  const empirical = (h.overRate + a.overRate) / 2;
  const rawProbability = clamp(params.poissonWeight * poisson + (1 - params.poissonWeight) * empirical, 0.05, line === 1.5 ? 0.97 : 0.92);
  const probability = calibrate(rawProbability);
  return {
    eligible: true, matchId: fixture.id, line, probability, rawProbability, poisson, empirical,
    expectedGoals: expectedHome + expectedAway, expectedHome, expectedAway,
    homeSample: h, awaySample: a, leagueSample: rows.length, leagueOverRate: leagueRate,
    modelVersion: MODEL_VERSION, calibrated: Boolean(CALIBRATION), asOf: new Date(asOf).toISOString(),
    reasons: [
      `Local: over ${line} en ${Math.round(h.rawOverRate * 100)}% de ${h.count} partidos en casa.`,
      `Visitante: over ${line} en ${Math.round(a.rawOverRate * 100)}% de ${a.count} partidos fuera.`,
      `Goles esperados por el modelo: ${(expectedHome + expectedAway).toFixed(2)}.`,
      'Sin ajuste por alineaciones, lesiones, clima o motivación; datos gratuitos de marcadores.'
    ]
  };
}
