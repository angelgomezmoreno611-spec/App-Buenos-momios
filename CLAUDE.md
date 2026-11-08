# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reglas del proyecto (de AGENTS.md)

- Antes de cada bloque de trabajo, leer `CONTEXTO.md` (estado verificado, decisiones,
  pendientes y próximo paso). Actualizarlo al terminar cada bloque, en español,
  distinguiendo lo comprobado de lo supuesto. Nunca escribir credenciales en él.
- **Laptop con poca RAM**: un solo proceso pesado a la vez (pruebas, análisis o
  compilación); no usar agentes paralelos ni emuladores Android por defecto.
  Si falta memoria, reducir trabajo/concurrencia antes de subir límites.
- Node: usar los scripts npm (heap 512 MiB, `--test-concurrency=1`); si se llama a
  `node` directamente, conservar esas opciones.
- Flutter: siempre `flutter test --concurrency=1`; análisis y build por separado.
- Android: no tocar el perfil de bajo consumo de `mobile/android/gradle.properties`.

## Entorno

- Node 22 no está en PATH: `export PATH="/tmp/node-v22.23.4-linux-x64/bin:$PATH"`.
- Flutter SDK: `/tmp/buenos-momios-flutter/bin/flutter`, con `PUB_CACHE=/tmp/buenos-momios-pub-cache`.
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
```

Mobile (`cd mobile`):

```bash
flutter analyze
flutter test --concurrency=1
flutter test --concurrency=1 test/football_test.dart
flutter run -d web-server --web-port=8080 --dart-define=APP_MODE=demo
flutter run -d web-server --web-port=8080 --dart-define-from-file=config.local.json
flutter build web --dart-define=APP_MODE=demo
```

## Arquitectura

Producto: tickets de **over 1.5 goles con 6 partidos** (umbral 0.80) por defecto;
over 2.5 con 4 partidos (umbral 0.65) sigue disponible con `TICKET_MARKET=OVER_2_5`
y `TICKET_LEGS=4`. La API publica hasta cuatro tickets por día (sin repetir
partidos), liquida resultados según el mercado de cada selección y prepara avisos.
En over 1.5 se excluyen LaLiga y Serie A (`MARKET_BLOCKED`, acierto medido bajo).
Además, un quinto ticket opcional "El arriesgado del día" (`riskyTicket`, `kind:
'risky'`): 2 over 3.5 (≥0.40) + 2 over 2.5 (≥0.65) con partidos que no usan los
normales; `TICKET_RISKY=false` lo apaga. Requiere migración 006; si la base lo
rechaza, la tanda se publica sin él.

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
- `src/football/`: módulo independiente de información de partidos con ocho
  adaptadores (`providers.js`), normalizador común, transporte HTTP secuencial con
  límite de 2 MB por respuesta (`http.js`, compartido con `FootballData` para
  respetar cuotas) y caché LRU de 4 MB (`service.js`). Los IDs llevan namespace por
  proveedor; estos datos **no** alimentan el modelo de probabilidades. Detalles y
  límites de cada fuente en `docs/APIS_FUTBOL.md`.
- Claves Supabase: `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` (con
  compatibilidad para `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`). Las
  `sb_secret_...` van solo en la cabecera `apikey`; Bearer solo para claves JWT antiguas.

**Base de datos** (`supabase/migrations/`, aplicar en orden; 005 admite 4 o 6
partidos y OVER_1_5/OVER_2_5): RLS por usuario;
`saved_batches` (002) guarda tandas vía RPC idempotente y las escrituras pasan por
la API. Las pruebas usan PGlite (PostgreSQL embebido), sin Supabase real.

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
