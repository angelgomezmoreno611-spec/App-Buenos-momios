import { FootballService } from '../src/football/service.js';

// Por defecto solo consulta fuentes públicas. --configured incluye las que
// tengan una clave local y puede consumir su cuota. No muestra claves ni URLs
// privadas y no guarda ni publica partidos en la base de datos.
const configured = process.argv.includes('--configured');
// La muestra pública de TheSportsDB también debe usar 123 en este modo,
// incluso si el propietario configuró una clave privada para la app.
const service = new FootballService({ env: configured ? process.env : { ...process.env, THESPORTSDB_API_KEY: '' } });
const results = [];
for (const source of service.sources().sources.filter(source => source.implemented && source.enabled && (configured || !source.needsKey))) {
  try {
    const data = await service.matches({ provider: source.id });
    const sample = data.matches[0];
    const detail = sample ? await service.detail({ provider: source.id, id: sample.remoteId, competition: data.competition, season: data.season, date: data.date }) : null;
    results.push({ provider: source.id, ok: true, matches: data.matches.length, totalMatches: data.totalMatches,
      detailChecked: Boolean(detail?.match), fetchedAt: data.fetchedAt });
  } catch (error) {
    results.push({ provider: source.id, ok: false, status: error.status ?? 503,
      message: error.publicMessage ?? 'No se pudo comprobar la fuente.' });
  }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
if (!results.some(result => result.ok)) process.exitCode = 1;
