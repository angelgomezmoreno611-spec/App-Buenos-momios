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
- `.git/` está vacío en este entorno: no hay historial ni `git status`/diffs.

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
npm run backtest -- ./partidos.json       # evaluar modelo con históricos
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

Producto: tickets de **over 2.5 goles**. La API publica hasta cuatro tickets de
cuatro partidos (sin repetir partidos), liquida resultados y prepara avisos.

**Backend** (`backend/`, Node ESM sin framework, sin dependencias de runtime):
- `src/config.js` → `configuredApp(env)` es el único punto de cableado: según
  `DATA_MODE` (`demo`/`live`) construye repo, proveedor y push, y los inyecta en
  `createApp` (`src/app.js`), un router manual sobre `http`. `src/server.js` lo
  sirve localmente; `api/index.js` + `vercel.json` lo exponen en Vercel.
- El proveedor `FootballData` (`src/provider.js`) se crea de forma diferida: la API
  de lectura arranca sin `FOOTBALL_DATA_TOKEN`; solo los jobs lo exigen (503).
- Flujo de tickets: `model.js` (Poisson con suavizado, no calibrado) →
  `tickets.js` (`generateBatch`, `ticketStatus`) → `jobs.js` (`runJob` para
  `generate`/`settle`/`notify`, llamados por `/api/jobs/*` con `CRON_SECRET`) →
  `repository.js` (`SupabaseRepository`, REST de Supabase con clave secreta) y
  `push.js` (Firebase, opcional). `demo.js` genera datos sintéticos.
- Rutas de usuario (`/api/tickets`, `/api/history`, `/api/subscriptions`,
  `/api/devices`, `/api/football/*`) verifican la sesión contra Supabase Auth.
- `src/football/`: módulo independiente de información de partidos con ocho
  adaptadores (`providers.js`), normalizador común, transporte HTTP secuencial con
  límite de 2 MB por respuesta (`http.js`, compartido con `FootballData` para
  respetar cuotas) y caché LRU de 4 MB (`service.js`). Los IDs llevan namespace por
  proveedor; estos datos **no** alimentan el modelo de probabilidades. Detalles y
  límites de cada fuente en `docs/APIS_FUTBOL.md`.
- Claves Supabase: `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` (con
  compatibilidad para `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`). Las
  `sb_secret_...` van solo en la cabecera `apikey`; Bearer solo para claves JWT antiguas.

**Base de datos** (`supabase/migrations/`, aplicar en orden): RLS por usuario;
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
