// Baseline explicable. Pesos y umbrales iniciales, todavía sin calibrar.
export const MODEL_VERSION = 'goals-poisson-shrinkage-v1';
const DAY = 86_400_000;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const validGoals = x => Number.isInteger(x) && x >= 0;
// Calibración Platt sobre logit(p). Identidad mientras no haya ajuste validado.
export const CALIBRATION = null;
export function calibrate(p, calibration = CALIBRATION) {
  if (!calibration) return p;
  const x = Math.log(p / (1 - p));
  return clamp(1 / (1 + Math.exp(-(calibration.a + calibration.b * x))), 0.05, 0.92);
}

export function over25(lambda) {
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error('Lambda inválida');
  return 1 - Math.exp(-lambda) * (1 + lambda + lambda * lambda / 2);
}

function sample(rows, team, venue, at, leagueRate, baseFor, baseAgainst) {
  const games = rows.filter(r => r[venue].id === team)
    .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).slice(0, 20);
  let weight = 0, scored = 0, conceded = 0, overs = 0;
  for (const g of games) {
    const w = Math.exp(-Math.LN2 * (at - Date.parse(g.kickoff)) / (90 * DAY));
    const gf = venue === 'home' ? g.homeGoals : g.awayGoals;
    const ga = venue === 'home' ? g.awayGoals : g.homeGoals;
    weight += w; scored += w * gf; conceded += w * ga;
    overs += w * Number(gf + ga >= 3);
  }
  // Ocho partidos equivalentes de prior suavizan muestras pequeñas.
  const prior = 8;
  return {
    count: games.length,
    effectiveSample: weight,
    attack: (scored + prior * baseFor) / (weight + prior),
    defense: (conceded + prior * baseAgainst) / (weight + prior),
    overRate: (overs + prior * leagueRate) / (weight + prior),
    rawOverRate: games.length ? games.filter(g => g.homeGoals + g.awayGoals >= 3).length / games.length : null,
    latest: games[0]?.kickoff
  };
}

export function predict(fixture, history, { asOf = Date.now() } = {}) {
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
  const leagueRate = rows.filter(r => r.homeGoals + r.awayGoals >= 3).length / rows.length;
  const h = sample(rows, fixture.home.id, 'home', asOf, leagueRate, homeMean, awayMean);
  const a = sample(rows, fixture.away.id, 'away', asOf, leagueRate, awayMean, homeMean);
  if (h.count < 6 || a.count < 6 || h.effectiveSample < 3 || a.effectiveSample < 3) {
    return reject('Muestra insuficiente: mínimo 6 juegos por condición y 3 efectivos');
  }
  if (asOf - Date.parse(h.latest) > 60 * DAY || asOf - Date.parse(a.latest) > 60 * DAY) {
    return reject('Sin actividad reciente en la condición analizada');
  }
  const expectedHome = clamp(h.attack * a.defense / homeMean, 0.15, 4);
  const expectedAway = clamp(a.attack * h.defense / awayMean, 0.15, 4);
  const poisson = over25(expectedHome + expectedAway);
  const empirical = (h.overRate + a.overRate) / 2;
  const rawProbability = clamp(0.8 * poisson + 0.2 * empirical, 0.05, 0.92);
  const probability = calibrate(rawProbability);
  return {
    eligible: true, matchId: fixture.id, probability, rawProbability, poisson, empirical,
    expectedGoals: expectedHome + expectedAway, expectedHome, expectedAway,
    homeSample: h, awaySample: a, leagueSample: rows.length, leagueOverRate: leagueRate,
    modelVersion: MODEL_VERSION, calibrated: Boolean(CALIBRATION), asOf: new Date(asOf).toISOString(),
    reasons: [
      `Local: over 2.5 en ${Math.round(h.rawOverRate * 100)}% de ${h.count} partidos en casa.`,
      `Visitante: over 2.5 en ${Math.round(a.rawOverRate * 100)}% de ${a.count} partidos fuera.`,
      `Goles esperados por el modelo: ${(expectedHome + expectedAway).toFixed(2)}.`,
      'Sin ajuste por alineaciones, lesiones, clima o motivación; datos gratuitos de marcadores.'
    ]
  };
}
