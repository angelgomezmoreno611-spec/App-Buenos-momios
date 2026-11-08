# APIs de fútbol

Investigación: **6 de noviembre de 2026**. Se implementaron ocho conectores para
la pestaña **Partidos**. Los planes y la cobertura pueden cambiar; se enlazan las
fuentes oficiales. Preparar un conector no concede acceso al servicio.

## Comparación de 14 fuentes

| Fuente | Plan gratuito y límites | Estado |
| --- | --- | --- |
| [OpenLigaDB](https://openligadb.de/) | Sin clave, datos comunitarios ODbL; calendario, resultados, estadios y goles | Integrada y comprobada en vivo |
| [OpenFootball](https://github.com/openfootball/football.json) | JSON CC0 sin clave; calendarios/históricos, sin seguimiento en directo ni hora UTC verificable | Integrada y comprobada en vivo |
| [football-data.org](https://www.football-data.org/pricing) | Token gratuito, 12 competiciones y 10 llamadas/minuto; resultados retrasados | Integrada; falta token local |
| [API-Football](https://www.api-football.com/pricing) | 100 llamadas/día; temporadas restringidas; fichas con estadísticas, eventos y alineaciones según cobertura | Conector probado con respuestas simuladas; falta clave |
| [Sportmonks](https://www.sportmonks.com/football-api/free-plan/) | Plan permanente de Dinamarca y Escocia; estadísticas, alineaciones y eventos | Conector probado; falta token |
| [TheSportsDB](https://api.thesportsdb.com/documentation) | Clave pública `123`: muestras limitadas, hasta 15 eventos por temporada | Integrada y comprobada; no representa una temporada completa |
| [AllSportsAPI](https://allsportsapi.com/soccer-football-api) | Dos ligas asignadas por el proveedor, 260 llamadas/hora | Conector probado; falta clave y confirmar las ligas de la cuenta |
| [The Odds API](https://the-odds-api.com/) | 500 créditos/mes, sin históricos; eventos y cuotas | Conector probado; falta clave. Consulta Over/Under 2.5 en una región |
| [BeSoccer](https://api.besoccer.com/es/presupuestos) | El registro es gratis; no se confirmó un plan público gratuito de uso de API | Investigada; requiere contratación y documentación de acceso |
| [ScoreBat](https://www.scorebat.com/video-api/docs/) | `free-feed` con token: hasta 50 videos de encuentros de al menos siete días | Investigada; no añade estadísticas actuales, sin integrar |
| [StatsBomb / Hudl Open Data](https://github.com/hudl/open-data) | Archivos de competiciones seleccionadas para análisis histórico | Investigada; sin descargas masivas ni incorporación al modelo |
| [Football-Data.co.uk](https://football-data.co.uk/contact.php) | CSV solo para uso personal/académico (no comercial); automatización ligera hasta dos veces por semana | Integrada en `src/csvleagues.js`: job `/api/jobs/csv` martes y viernes, con tope de 2 descargas en 7 días registrado en `csv_sync_runs`. Si la app pasa a uso comercial, desactivar (`CSV_COMPETITIONS=none`) |
| [Open-Meteo](https://open-meteo.com/en/pricing) | Clima sin clave para uso no comercial, hasta 10 000 consultas/día y atribución | Investigada; pendiente de coordenadas verificadas de estadios |
| [TheSports](https://www.thesports.com/pricing) | Prueba de 15 días; no se confirmó plan permanente gratis | Investigada; no activada como fuente gratuita permanente |

The Odds API corresponde a **the-odds-api.com**, con guiones; hay otros servicios
con nombres parecidos.

## BeSoccer

Su [API oficial](https://api.besoccer.com/es/presupuestos) existe. Las
[condiciones de BeSoccer](https://es.besoccer.com/legal) distinguen registro
gratuito y contratación del acceso. Aparece como fuente sin acceso, sin inventar
rutas ni anunciar gratuidad. No se contactó con ellos ni se creó cuenta.

## Configurar acceso

Guardar las claves exclusivamente en `backend/.env` y reiniciar la API:

```dotenv
FOOTBALL_DATA_TOKEN=
API_FOOTBALL_KEY=
SPORTMONKS_TOKEN=
THESPORTSDB_API_KEY=
ALLSPORTS_API_KEY=
ODDS_API_KEY=
```

Se añadieron campos vacíos conservando Supabase. OpenLigaDB y OpenFootball no
necesitan claves. TheSportsDB usa su clave pública `123` cuando el campo está
vacío, conservando el aviso de muestra parcial. No se usa su búsqueda restringida
de equipos por nombre. Ninguna clave privada se envía a Flutter.

## Uso

Abrir **Partidos**, elegir fuente, competición y temporada o fecha. Se muestran
hasta 60 encuentros cercanos a la fecha actual entre los recibidos. Tocar uno
abre la ficha con los campos disponibles, su fuente y sus limitaciones.

Rutas GET autenticadas con la sesión del usuario:

```text
/api/football/sources
/api/football/matches?provider=openligadb&competition=bl1&season=2026
/api/football/match?provider=openligadb&id=ID_DEL_PARTIDO&competition=bl1&season=2026
```

Sportmonks y AllSportsAPI consultan un solo día: `date=YYYY-MM-DD` en UTC.
Los IDs pertenecen a cada proveedor y no se intercambian. OpenFootball conserva
la fecha sin inventar una zona horaria. Los campos ausentes siguen ausentes;
no se convierten marcadores nulos en ceros.

Esta información **no modifica el modelo ni liquida tickets**. Las cuotas son
informativas; el modelo no calcula valor esperado con ellas. La generación y
liquidación existentes siguen usando football-data.org y necesitan su token.

## Consumo de recursos

- Un request externo a la vez por instancia, hasta seis en cola.
- Hasta 2 MB por respuesta y caché de 4 MB/48 entradas.
- Caché de cinco minutos, una hora para OpenFootball; mantiene la fecha de consulta.
- Presupuestos locales conservadores: API-Football, 80 llamadas/día; The Odds API,
  diez/día. El tráfico de consulta y jobs de football-data.org comparte 10/minuto.
- HTTP 429 aplica enfriamiento. No hay reintentos masivos ni polling nuevo.
- Los presupuestos son por proceso: reinicios y múltiples instancias/serverless
  no sustituyen las cuotas de la cuenta del proveedor.

## Comprobaciones

```bash
cd backend
npm run check:football
```

Solo consulta fuentes públicas. `npm run check:football -- --configured` incluye
las claves configuradas y puede consumir sus cuotas. No modifica Supabase.

El 6 de noviembre se recibieron 306 partidos de OpenLigaDB, 380 de OpenFootball y
la muestra de 15 de TheSportsDB, comprobando también una ficha por fuente.
Los números corresponden a esa consulta. El acceso real de los otros cinco
conectores queda pendiente de sus claves; se validaron con respuestas simuladas.

Ejecutar por separado `npm test`, `flutter analyze` y
`flutter test --concurrency=1` para mantener el perfil de poca RAM.
