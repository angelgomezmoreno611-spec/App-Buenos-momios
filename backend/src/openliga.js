// Ligas de OpenLigaDB (gratis, sin clave, datos comunitarios con licencia ODbL:
// requiere atribución). Se usa para la 3. Liga alemana, validada en over 1.5.
const HOUR = 3_600_000, DAY = 24 * HOUR;
export const OLDB_LEAGUES = { BL3: { shortcut: 'bl3', name: '3. Liga' } };
// Backtest 2022-07 a 2026-11 (OpenLigaDB, mismo modelo y criterios que las CSV).
export const OLDB_VALIDATION = {
  OVER_1_5: { BL3: { picks: 437, hitRate: 0.812 } },
  OVER_2_5: {} // 3. Liga en over 2.5: 118 selecciones, 57.6% → no apta
};
export const defaultOldbLeagues = market => Object.keys(OLDB_VALIDATION[market] ?? {});
export const OLDB_ATTRIBUTION = 'Datos de 3. Liga: OpenLigaDB (licencia ODbL).';

// OpenLigaDB nombra la temporada por su año de inicio (2026 = 2026/27).
export const oldbSeason = (now, back = 0) => {
  const d = new Date(now);
  return (d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1) - back;
};

export function normalizeOldb(row, code) {
  const kickoff = Date.parse(row?.matchDateTimeUTC);
  if (!row?.matchID || !row.team1?.teamId || !row.team2?.teamId || row.team1.teamId === row.team2.teamId || !Number.isFinite(kickoff)) return null;
  // resultTypeID 2 = "Endergebnis" (resultado final de 90 minutos en liga).
  const end = row.matchResults?.find(r => r.resultTypeID === 2);
  const finished = row.matchIsFinished === true && Number.isInteger(end?.pointsTeam1) && Number.isInteger(end?.pointsTeam2);
  if (row.matchIsFinished === true && !finished) return null; // terminado sin marcador confirmado
  return {
    id: `oldb-${row.matchID}`, league: { id: code, name: OLDB_LEAGUES[code].name },
    home: { id: `oldb-team-${row.team1.teamId}`, name: row.team1.teamName },
    away: { id: `oldb-team-${row.team2.teamId}`, name: row.team2.teamName },
    kickoff: new Date(kickoff).toISOString(), status: finished ? 'FINISHED' : 'TIMED',
    homeGoals: finished ? end.pointsTeam1 : null, awayGoals: finished ? end.pointsTeam2 : null,
    // Igual que en los demás históricos: marcador conocido 3 h después del inicio.
    availableAt: finished ? new Date(kickoff + 3 * HOUR).toISOString() : null, sourceUpdatedAt: row.lastUpdateDateTime ?? null
  };
}

// get(url) → JSON ya parseado (transporte compartido con límite de tamaño y cuota).
export async function oldbSnapshot(codes, { now = Date.now(), get }) {
  const history = [], fixtures = [];
  for (const code of codes) {
    const spec = OLDB_LEAGUES[code];
    if (!spec) throw new Error('Liga OpenLigaDB no compatible');
    for (const back of [0, 1]) {
      const rows = await get(`https://api.openligadb.de/getmatchdata/${spec.shortcut}/${oldbSeason(now, back)}`);
      if (!Array.isArray(rows)) throw new Error('OpenLigaDB: respuesta inválida');
      for (const m of rows.map(r => normalizeOldb(r, code)).filter(Boolean)) {
        if (m.status === 'FINISHED' && Date.parse(m.kickoff) >= now - 400 * DAY && Date.parse(m.availableAt) <= now) history.push(m);
        if (m.status === 'TIMED' && Date.parse(m.kickoff) > now) fixtures.push(m);
      }
    }
  }
  return { history, fixtures };
}

// Resultado de partidos concretos: una consulta pequeña por partido (máx. 10 por llamada).
export async function oldbResults(ids, { get }) {
  const out = [];
  for (const id of ids.filter(x => /^oldb-\d+$/.test(x)).slice(0, 10)) {
    const row = await get(`https://api.openligadb.de/getmatchdata/${id.slice(5)}`);
    const code = Object.keys(OLDB_LEAGUES).find(c => OLDB_LEAGUES[c].shortcut === row?.leagueShortcut) ?? 'BL3';
    const m = normalizeOldb(row, code);
    if (m?.status === 'FINISHED') out.push(m);
  }
  return out;
}
