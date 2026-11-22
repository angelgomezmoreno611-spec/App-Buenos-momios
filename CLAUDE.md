# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reglas del proyecto (de AGENTS.md)

- Antes de cada bloque de trabajo, leer `CONTEXTO.md` (estado verificado, decisiones,
  pendientes y próximo paso) y `TAREAS.md` (lista de tareas en curso con bitácora). Actualizarlo al terminar cada bloque, en español,
  distinguiendo lo comprobado de lo supuesto. Nunca escribir credenciales en él.
- **Laptop con poca RAM**: un solo proceso pesado a la vez (pruebas, análisis o
  compilación); no usar agentes paralelos ni emuladores Android por defecto.
  Si falta memoria, reducir trabajo/concurrencia antes de subir límites.
- Node: usar los scripts npm (heap 512 MiB, `--test-concurrency=1`); si se llama a
  `node` directamente, conservar esas opciones.
- Flutter: siempre `flutter test --concurrency=1`; análisis y build por separado.
- Android: no tocar el perfil de bajo consumo de `mobile/android/gradle.properties`.

## Entorno

- Herramientas en `~/.local/opt` (antes en `/tmp`, que se borra al reiniciar):
  - Node 22 no está en PATH: `export PATH="$HOME/.local/opt/node-v22.23.4-linux-x64/bin:$PATH"`.
  - Flutter 3.35.7 (coincide con `pubspec.lock`; versiones nuevas cambian el lock y
    rompen pruebas de widgets): `~/.local/opt/flutter-3.35.7/bin/flutter`, con
    `PUB_CACHE=$HOME/.local/opt/pub-cache`.
  - Supabase CLI 2.122.0 en `~/.local/bin/supabase`, ya vinculada al proyecto
    `vbxnbhajqcohgpzyeeli`. Migraciones nuevas: `supabase db push --linked --dry-run` y
    luego `supabase db push --linked` (pedir confirmación: es producción). `db dump` no
    funciona (requiere Docker).
  - Vercel CLI 65.9.0 en `~/.local/bin/vercel` (sesión del usuario; correr desde
    `backend/`, ya vinculado). Variables: `vercel env ls production`.
- Remoto Git: `origin` → github.com/angelgomezmoreno611-spec/App-Buenos-momios (público), rama `main`.

## Comandos

Backend (`cd backend`):

```bash
npm test                                  # todos los archivos en serie
npm test -- test/model.test.js            # un archivo
npm test -- --test-name-pattern="texto"   # pruebas por nombre
DATA_MODE=demo npm run dev                # API demo sin servicios externos
npm run dev                               # carga backend/.env si existe
npm run check:supabase                    # diagnóstico solo lectura (Auth, JWKS, 8 tablas)
npm run check:football [-- --configured]  # consultas reales; --configured consume cuota
npm run import:openfootball               # descarga ~10.7k partidos CC0 a data/ (ignorado)
npm run backtest -- data/openfootball.json # evaluar el modelo con ese histórico
npm run calibrate -- data/openfootball.json [AAAA-MM-DD] # ajustar Platt y validar tras la fecha
npm run tune -- data/openfootball.json [AAAA-MM-DD val] [AAAA-MM-DD prueba] # búsqueda de parámetros con validación temporal
npm run backtest:form -- data/openfootball.json [--test=AAAA-MM-DD] # backtest del modelo de forma (formPredict)
npm run import:csv -- D2,F2 [temporadas]   # descarga única de CSV football-data.co.uk para backtest (cuenta para la política de descargas)
npm run import:fc -- brazil2,korea1|all    # Football Charts para backtest (gasta cuota diaria; reanudable en data/fc/)
```

Mobile (`cd mobile`):

```bash
flutter analyze
flutter test --concurrency=1
flutter test --concurrency=1 test/football_test.dart
flutter run -d web-server --web-port=8080 --dart-define=APP_MODE=demo
flutter run -d web-server --web-port=8080 --dart-define-from-file=config.local.json
flutter build web --dart-define=APP_MODE=demo
../tools/release-apk.sh "Qué cambió"   # APK arm64 build N+1 → release app-vN en GitHub (+ adb install)
```

El botón "Actualizar" de la app (`lib/updater.dart`) busca el release `app-vN` más
alto con APK y lo compara con `APP_BUILD`. Publicar siempre con el script (misma
clave debug de firma y número de versión creciente).

## Arquitectura

Producto: **3 tickets over 2.5 de 4 partidos** (umbral por partido 0.67 en los tres,
`TICKET_THRESHOLDS` admite escalonar, p. ej. "0.67,0.65,0.63"; si un nivel no se llena,
sus partidos bajan al siguiente; cada over 2.5 que falte se cambia por 2 over 1.5 con ≥ √umbral, de
los partidos que no son candidatos a over 2.5) por tanda, sin repetir
partidos (`TICKET_COUNT`, `TICKET_MARKET`, `TICKET_LEGS` = 3, 4 (por defecto) o 6; over 1.5 con 6 partidos y
umbral 0.80 sigue disponible y ahí se excluyen LaLiga y Serie A, `MARKET_BLOCKED`).
Además, el ticket especial **"La soñadora"** (`dreamerTicket`, `kind: 'dreamer'`):
8 over 2.5 (≥0.60, también en partidos de API-Football; mismo respaldo de 2 over 1.5
con ≥0.78 por cada over 2.5 que falte, hasta 16 partidos; migraciones 012 y 017) con partidos que no usan los normales; `TICKET_DREAMER=false` lo
apaga. Requiere migración 008; si la base lo rechaza, la tanda se publica sin él.
"El arriesgado del día" (`kind: 'risky'`) ya no se genera, pero la base y la app
siguen leyendo tandas antiguas con él. La API liquida según el mercado de cada
selección y el tamaño (`legs`) de cada ticket.
**Tandas de varios días**: entran partidos de los `TICKET_DAYS` (1–7, por defecto 7) días
locales desde el día de la tanda (la demo usa 72 h). La tanda sigue en juego mientras le
quede un ticket activo (`activeTickets`: pendiente/revisión y último partido hace <4 días);
`/api/tickets` devuelve la más reciente (`latestBatch`). Cada noche generate (23:45)
envía a todos los teléfonos el estado ("Siguen activos: ticket 1 y 3…", clave
`status:<día>`) o, si ya no queda ningún ticket activo, crea la tanda nueva y avisa
"Tus nuevos tickets ya están listos" (`new:<id>`); los envía en la misma ejecución.

**Backend** (`backend/`, Node ESM sin framework, sin dependencias de runtime):
- `src/config.js` → `configuredApp(env)` es el único punto de cableado: según
  `DATA_MODE` (`demo`/`live`) construye repo, proveedor y push, y los inyecta en
  `createApp` (`src/app.js`), un router manual sobre `http`. `src/server.js` lo
  sirve localmente; `api/index.js` + `vercel.json` lo exponen en Vercel.
- El proveedor `FootballData` (`src/provider.js`) se crea de forma diferida: la API
  de lectura arranca sin `FOOTBALL_DATA_TOKEN`; solo los jobs lo exigen (503).
- Flujo de tickets: `model.js` (Poisson con suavizado, no calibrado) →
  `tickets.js` (`generateBatch`, `ticketStatus`) → `jobs.js` (`runJob` para
  `history`/`csv`/`generate`/`settle`/`notify`, llamados por `/api/jobs/*` con `CRON_SECRET`;
  `history` guarda la temporada anterior en `match_history` y `generate` la combina
  con la temporada actual) →
  `repository.js` (`SupabaseRepository`, REST de Supabase con clave secreta) y
  `push.js` (Firebase, opcional). `demo.js` genera datos sintéticos.
- Los jobs **no** se programan en Vercel: los dispara pg_cron + pg_net desde
  Supabase (URL y secreto en Vault), según `supabase/schedule.example.sql`. Los
  cambios de horario van como migración (010, 011, 014 usan `cron.schedule`, que no
  hace nada sin pg_cron, p. ej. en PGlite). generate corre a las 23:45 de Mazatlán
  (UTC-7; desde las 23:40 el backend ya usa la fecha de mañana, `tickets.js`) y la
  de las 00:01 queda como respaldo sin duplicar.
- Rutas de usuario (`/api/tickets`, `/api/history`, `/api/subscriptions`,
  `/api/devices`, `/api/football/*`) verifican la sesión contra Supabase Auth.
- `src/csvleagues.js`: ligas extra desde CSV de football-data.co.uk (sin API). Su
  política: **solo uso personal y máx. 2 descargas automáticas/semana**. El job
  `csv` (mar/vie) descarga y guarda en `csv_matches` (migración 004), con tope en
  `csv_sync_runs`; `generate` y `settle` solo leen de la tabla (IDs `fdu-`).
  Ligas activas = las que pasaron backtest (`CSV_VALIDATION`); `CSV_COMPETITIONS`
  las cambia (`none` desactiva). Si la app se vuelve comercial, desactivarlas.
- `src/openliga.js`: 3. Liga desde OpenLigaDB (gratis, sin clave, ODbL: la tanda
  incluye la atribución). Solo en over 1.5 (validada); `OPENLIGADB_COMPETITIONS`
  (`none` desactiva). generate descarga 2 temporadas; settle consulta cada partido
  pendiente (IDs `oldb-`, máx. 10 por ejecución). Fallos no detienen la tanda.
- `src/apifootball.js` + `src/discover.js`: descubrimiento con API-Football gratis
  (solo ayer/hoy/mañana, 100 consultas/día, 10/min). Job `discover` (sin lock, cada
  5 min de 04:00 a 05:55 UTC, migración 011): listas del día → `af_matches` (migración 007), luego
  "predictions" de partidos de ligas NO cubiertas (prioriza ligas goleadoras por
  `af_league_rates`). generate usa `formPredict` (temporada casa/fuera + últimos 5)
  con umbral `FORM_MIN`; settle lee el resultado de la lista de "ayer". Si un
  partido no tiene análisis, generate calcula la forma con los resultados guardados
  (`featuresFromHistory`) y discover no gasta consulta en él; discover solo analiza
  partidos del día de la próxima tanda (desde las 19:00 locales, los de mañana). IDs `af-`. `AF_DISCOVERY=false` lo apaga. Uso diario en `af_usage`.
- `src/footballcharts.js`: Football Charts (clave gratis `FOOTBALL_CHARTS_KEY`, 200/día,
  uso personal con atribución). Job `fc` (migración 014, 2 veces al día, ≤10 ligas por
  vuelta, tabla `fc_matches` de la 013); generate calcula la forma con sus resultados
  (`featuresFromHistory`) y respeta `FC_VALIDATION` por mercado; settle lee la tabla
  (por id o por equipos ±1 día). Sus ligas cuentan como cubiertas para API-Football
  (sin duplicados). IDs `fc-`. `FC_COMPETITIONS` (`none` desactiva).
- `src/bsd.js`: Bzzoiro Sports Data (gratis permanente, 7500/día, `BSD_TOKEN`). Job `bsd`
  cada hora (:12, migración 018) guarda una ventana de 3 días atrás a 8 adelante de TODAS
  sus competiciones en `bsd_matches` (400 días; carga inicial `npm run import:bsd`).
  Ligas activas = `BSD_VALIDATION` (backtest 2026-11-22; `BSD_COMPETITIONS`, `none`
  desactiva); las que toma se quitan de CSV/Football Charts (`BSD_REPLACES`). La Europa
  League (solo respaldo over 1.5) se calcula con la liga local de cada equipo
  (`crossPredict` en `model.js`, `crossLeague` en el partido). IDs `bsd-`. El mismo job
  guarda cada día las bajas (lesionados/dudosos/suspendidos, `/teams/{id}/squad/`) de los
  equipos que juegan en ≤30 h en `bsd_absences` (migración 019, ≤40 equipos por vuelta);
  todavía NO alimentan el modelo: son para medir su efecto más adelante.
- `src/strength.js`: modelo de fuerza (ataque/defensa por equipo, todas las competiciones
  de BSD juntas, vida media 365 días, prior 3). Job `ratings` (06:30 UTC, migración 020)
  ajusta con `bsd_matches` y guarda `bsd_ratings`/`bsd_rating_meta`; generate lo usa para
  la Champions (`BSD_STRENGTH`, `strengthInput` en el partido). Backtest semanal sin fuga:
  Champions o2.5 ≥0.67 69.4% (72) ajuste / 80.7% (88) prueba 2025-26.
- Copas europeas: Champions con el modelo de fuerza y Europa League como respaldo over 1.5;
  Conference **no** entra. Champions (football-data, gratis) probada el 2026-11-21
  con la liga local de cada equipo: ≥0.67 acertó 58.8% (34 sel.) frente a 61% base, sin
  capacidad de distinguir; Europa y Conference League no están en el plan gratuito.
- `src/football/`: módulo independiente de información de partidos con ocho
  adaptadores (`providers.js`), normalizador común, transporte HTTP secuencial con
  límite de 2 MB por respuesta (`http.js`, compartido con `FootballData` para
  respetar cuotas) y caché LRU de 4 MB (`service.js`). Los IDs llevan namespace por
  proveedor; estos datos **no** alimentan el modelo de probabilidades. Detalles y
  límites de cada fuente en `docs/APIS_FUTBOL.md`.
- Claves Supabase: `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` (con
  compatibilidad para `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`). Las
  `sb_secret_...` van solo en la cabecera `apikey`; Bearer solo para claves JWT antiguas.

**Base de datos** (`supabase/migrations/`, aplicar en orden; 009 admite 3, 4 o 6
partidos; 005 añadió OVER_1_5/OVER_2_5): RLS por usuario;
`saved_batches` (002) guarda tandas vía RPC idempotente y las escrituras pasan por
la API. `apply_results` (015) avisa de tickets ganados a todos los teléfonos en
`devices` (un registro existe solo mientras los avisos están activos); `enqueue_notice`
(016) encola avisos con título/texto propios, sin ticket, deduplicados por
`(token, dedupe_key)`. La app activa los avisos sola la primera vez que carga una tanda. Las pruebas usan PGlite (PostgreSQL embebido), sin Supabase real.

**Mobile** (`mobile/lib/`, Flutter): `main.dart` inicializa Supabase una sola vez y
todo usa `Supabase.instance.client`. `api.dart` es el cliente HTTP compartido
(`Api.demo` cambia a datos locales); `dashboard.dart` (tickets, guardar tanda,
historial), `football_screen.dart` (pestaña Partidos), `notifications.dart`
(solo con `ENABLE_PUSH=true`). Configuración por `--dart-define`: `APP_MODE`,
`API_URL` (sin barra final), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`ALLOW_LOCAL_API`. HTTP solo se permite hacia loopback/emulador en debug; release
exige HTTPS. La demo guarda hasta 14 tandas en almacenamiento local.

## Restricciones

- El cliente Flutter solo recibe datos públicos (`mobile/config.local.json`);
  la clave secreta, el token de fútbol, `CRON_SECRET` (≥32 caracteres) y Firebase
  van únicamente en `backend/.env` (ignorado, permisos 600).
- Los modos demo y real no se mezclan: la demo usa solo datos sintéticos.
