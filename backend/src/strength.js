import { overLine } from './model.js';

// Modelo de fuerza: cada equipo tiene un multiplicador de ataque y otro de defensa
// (goles que concede), más un promedio global y la ventaja de local:
//   goles local = mu · H · ataque(local) · defensa(visitante)
//   goles visita = mu · ataque(visitante) · defensa(local)
// Se ajusta con TODAS las competiciones de BSD a la vez (ligas y copas): las copas
// europeas conectan las ligas y así se comparan equipos de ligas distintas. Partidos
// recientes pesan más (vida media `halfLife` días) y un prior de `prior` partidos
// promedio encoge cada multiplicador hacia 1. Actualización por bloques (estable).
// Backtest 2026-11-22 (reajuste semanal solo con partidos anteriores, 400 días):
// Champions over 2.5 ≥0.67 → 69.4% (72) en 2023-08/2025-06 y 80.7% (88) en 2025-07/
// 2026-11; Brier 0.224 frente a 0.235 de la tasa base. Europa y Conference: no mejora.
export const STRENGTH_VERSION = 'strength-v1';
export const STRENGTH_PARAMS = Object.freeze({ halfLife: 365, prior: 3, iterations: 60, minGames: 8 });
const DAY = 86_400_000;

// matches: [{ home: { id }, away: { id }, kickoff, homeGoals, awayGoals, neutral }]
export function fitStrength(matches, now = Date.now(), { halfLife, prior, iterations } = STRENGTH_PARAMS) {
  const games = matches.filter(m => Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals) && m.homeGoals >= 0 && m.awayGoals >= 0
    && m.home.id !== m.away.id && Date.parse(m.kickoff) < now);
  const w = games.map(m => Math.exp(-Math.LN2 * (now - Date.parse(m.kickoff)) / (halfLife * DAY)));
  const attack = new Map(), defense = new Map(), count = new Map();
  for (const m of games) for (const t of [m.home.id, m.away.id]) count.set(t, (count.get(t) ?? 0) + 1);
  const A = t => attack.get(t) ?? 1, D = t => defense.get(t) ?? 1;
  let mu = 1.35, home = 1.2;
  const lam = m => [mu * (m.neutral ? 1 : home) * A(m.home.id) * D(m.away.id), mu * A(m.away.id) * D(m.home.id)];
  for (let it = 0; it < iterations; it++) {
    for (const block of ['attack', 'defense', 'home', 'mu']) {
      const obs = new Map(), exp = new Map(); let o = 0, e = 0;
      const add = (team, x, y) => { obs.set(team, (obs.get(team) ?? 0) + x); exp.set(team, (exp.get(team) ?? 0) + y); };
      for (let i = 0; i < games.length; i++) {
        const m = games[i], wi = w[i], [lh, la] = lam(m);
        if (block === 'attack') { add(m.home.id, wi * m.homeGoals, wi * lh / A(m.home.id)); add(m.away.id, wi * m.awayGoals, wi * la / A(m.away.id)); }
        else if (block === 'defense') { add(m.away.id, wi * m.homeGoals, wi * lh / D(m.away.id)); add(m.home.id, wi * m.awayGoals, wi * la / D(m.home.id)); }
        else if (block === 'home') { if (!m.neutral) { o += wi * m.homeGoals; e += wi * lh / home; } }
        else { o += wi * (m.homeGoals + m.awayGoals); e += wi * (lh + la) / mu; }
      }
      if (block === 'attack') for (const [t, x] of obs) attack.set(t, (x + prior * mu) / (exp.get(t) + prior * mu));
      else if (block === 'defense') for (const [t, x] of obs) defense.set(t, (x + prior * mu) / (exp.get(t) + prior * mu));
      else if (block === 'home' && e > 0) home = o / e;
      else if (block === 'mu' && e > 0) mu = o / e;
    }
  }
  const teams = [...count].map(([team, n]) => ({ team, attack: A(team), defense: D(team), games: n }));
  return { mu, home, teams, fittedAt: new Date(now).toISOString(), matches: games.length };
}

// input: { mu, home, homeTeam: { attack, defense, games }, awayTeam: {...}, fittedAt }
export function strengthPredict(fixture, input, { asOf = Date.now(), line = 2.5, minGames = STRENGTH_PARAMS.minGames } = {}) {
  const reject = reason => ({ eligible: false, matchId: fixture.id, reason });
  if (!input?.homeTeam || !input?.awayTeam) return reject('Equipo sin fuerza calculada');
  if (input.homeTeam.games < minGames || input.awayTeam.games < minGames) return reject(`Menos de ${minGames} partidos recientes de algún equipo`);
  if (!(Date.parse(fixture.kickoff) > asOf)) return reject('El partido ya empezó o no tiene horario');
  // Ratings de hace más de 3 días: datos viejos, no se usan.
  if (!(asOf - Date.parse(input.fittedAt) < 3 * DAY)) return reject('Fuerza de equipos desactualizada');
  const expectedHome = input.mu * (fixture.neutral ? 1 : input.home) * input.homeTeam.attack * input.awayTeam.defense;
  const expectedAway = input.mu * input.awayTeam.attack * input.homeTeam.defense;
  const probability = Math.min(line === 1.5 ? 0.97 : 0.92, Math.max(0.05, overLine(expectedHome + expectedAway, line)));
  return { eligible: true, matchId: fixture.id, line, probability, expectedGoals: expectedHome + expectedAway, expectedHome, expectedAway,
    modelVersion: STRENGTH_VERSION, asOf: new Date(asOf).toISOString(),
    reasons: [`Goles esperados: ${expectedHome.toFixed(2)} + ${expectedAway.toFixed(2)} = ${(expectedHome + expectedAway).toFixed(2)}.`,
      'Fuerza de ataque y defensa calculada con todas las competiciones (ligas y copas) del último año.',
      'Sin ajuste por alineaciones, lesiones ni contexto de la eliminatoria.'] };
}
