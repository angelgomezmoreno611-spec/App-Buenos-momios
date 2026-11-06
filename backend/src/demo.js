import { generateBatch } from './tickets.js';

// Ligas y clubes ficticios: nunca se confunden con pronósticos reales.
export function demoSnapshot(now = Date.now()) {
  const history = [], fixtures = [];
  const names = ['Aurora', 'Atlético Norte', 'Bahía', 'Cumbre', 'Dorado', 'Estrella', 'Faro', 'Granada', 'Horizonte', 'Islas', 'Jardín', 'Laguna', 'Montaña', 'Niebla', 'Olivo', 'Pacífico', 'Puerto', 'Real Sur', 'Sierra', 'Valle'];
  for (let leagueIndex = 0; leagueIndex < 2; leagueIndex++) {
    const league = { id: `demo-liga-${leagueIndex}`, name: `Liga de ejemplo ${leagueIndex + 1}` };
    const teams = names.map((name, i) => ({ id: `demo-${leagueIndex}-${i}`, name: `${name} ${leagueIndex ? 'FC' : 'CF'}` }));
    for (let round = 0; round < 19; round++) {
      for (let i = 0; i < 20; i++) {
        const kickoff = new Date(now - (4 + round * 3) * 86_400_000 - i * 60_000).toISOString();
        history.push({ id: `demo-history-${leagueIndex}-${round}-${i}`, league, kickoff,
          availableAt: new Date(Date.parse(kickoff) + 3 * 3_600_000).toISOString(),
          home: teams[i], away: teams[(i + round + 1) % 20], homeGoals: (i + round) % 4 === 0 ? 1 : 3,
          awayGoals: (i + round) % 3 === 0 ? 0 : 2, status: 'FINISHED' });
      }
    }
    for (let i = 0; i < 10; i++) fixtures.push({
      id: `demo-match-${leagueIndex}-${i}`, league, home: teams[i], away: teams[19 - i],
      kickoff: new Date(now + (4 + leagueIndex * 12 + i) * 3_600_000).toISOString(), status: 'TIMED'
    });
  }
  return { fixtures, history, source: 'Datos sintéticos de demostración', fetchedAt: new Date(now).toISOString() };
}

export function demoBatch(now = Date.now()) {
  return generateBatch(demoSnapshot(now), { now, mode: 'demo' });
}
