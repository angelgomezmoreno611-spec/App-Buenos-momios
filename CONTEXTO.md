# Contexto de Buenos Momios

Última actualización: 2026-11-06 (America/Mazatlan).

## Instrucción permanente del usuario

Mantener este archivo como memoria de trabajo. Leerlo antes de cada bloque de
trabajo y actualizarlo al terminar el bloque, cambiar de tarea o encontrar un
bloqueo. Registrar lo realmente verificado y el siguiente paso concreto.

### Preferencia permanente de recursos

El usuario indica que su laptop tiene poca RAM: limitar el consumo y aceptar
mayor tiempo de ejecución. Ejecutar una tarea pesada por vez, pruebas en serie,
sin agentes paralelos ni emuladores por defecto. Antes de aumentar un límite de
memoria, revisar el fallo concreto y la disponibilidad.

- Scripts Node: heap de 512 MiB; pruebas con `--test-concurrency=1`.
- Flutter: usar `flutter test --concurrency=1`; análisis y build por separado.
- Android: heap Java de 1 GiB (antes 8 GiB), metaspace 512 MiB, caché de código
  128 MiB, un trabajador, sin paralelismo/daemons persistentes, Kotlin in-process.
- Son límites del heap; no garantizan un límite total de RAM por proceso.
- Se revisó memoria disponible antes de los cambios: aproximadamente 1.5 GiB
  disponibles y swap prácticamente llena. Evitar comprobaciones pesadas innecesarias.
- Verificado: `npm test` pasó los tres archivos en serie con el límite Node de
  512 MiB. No se ha compilado Android con el nuevo perfil; no se iniciaron
  compilaciones ni emuladores para este cambio.

## Último objetivo completado

Continuar la app existente. Mejora seleccionada tras revisar el código: guardar
tandas e historial sin exigir notificaciones ni Firebase, incluyendo demo local.
El usuario no indicó una nueva función específica; esta elección es de implementación.

## Último bloque completado: varias APIs gratuitas de fútbol

El usuario solicita buscar muchas APIs gratuitas, integrarlas para ampliar la
información de partidos y buscar específicamente BeSoccer.

- Investigar planes y documentación oficial, distinguir planes gratis, muestras
  limitadas, históricos abiertos y pruebas temporales.
- Implementar consulta de partidos y detalles con varias fuentes, caché acotada,
  consultas en serie y errores por proveedor. No mezclar IDs ni duplicar datos
  de distintos proveedores dentro del modelo de probabilidades.
- Añadir una vista Flutter para consultar esa información y documentar cómo
  configurar las claves gratuitas; no crear cuentas ni contratar planes.
- BeSoccer: API oficial en `api.besoccer.com`, pero su uso se contrata y la
  documentación de acceso requiere registro. No se confirmó ningún plan público
  gratuito. Fuentes: https://api.besoccer.com/es/presupuestos y
  https://es.besoccer.com/legal . No inventar un endpoint ni usar APIs privadas.
- Confirmados: OpenLigaDB sin clave (ODbL), OpenFootball JSON sin clave (CC0),
  football-data.org gratis con token (10/min), API-Football gratis con clave
  (100/día, temporadas limitadas), Sportmonks gratis (Dinamarca/Escocia),
  TheSportsDB con muestras muy limitadas (buscar equipos con clave 123 devuelve
  solo Arsenal), ScoreBat free-feed con token (videos de al menos 7 días).
- Football-data.co.uk restringe el uso gratuito a personal/académico y descargas
  ligeras; no habilitar su descarga automática para esta app sin resolver el uso.
- Open-Meteo es complementaria de clima, gratis sin clave para uso no comercial.
  Falta decidir su utilidad real cuando haya coordenadas verificadas del estadio.
- Implementados transporte secuencial acotado (2 MB/respuesta), normalizadores,
  ocho adaptadores y servicio con caché LRU de 4 MB. Fuentes: OpenLigaDB,
  OpenFootball, football-data.org, API-Football, Sportmonks, TheSportsDB,
  AllSportsAPI y The Odds API (dominio correcto: the-odds-api.com).
- Nuevas rutas autenticadas `/api/football/{sources,matches,match}` y transporte
  compartido con los jobs existentes de football-data.org para respetar cuota.
  No se cambiaron el modelo ni las reglas de liquidación.
- Añadidas pruebas de los ocho adaptadores, normalización de marcadores,
  namespaces, validaciones, caché, cuotas, respuestas grandes y transporte en serie.
- Añadido `npm run check:football`: consultas reales públicas por defecto;
  `--configured` incluye claves configuradas y consume la cuota correspondiente.
- Vista Flutter «Partidos» y fichas implementadas con selector de fuente,
  competición, temporada/fecha, marcadores, estadísticas, alineaciones, eventos
  y cuotas cuando existen. API HTTP compartida con el dashboard; sin imágenes
  pesadas ni polling adicional. Modo demo sigue separado de datos reales.
- Pruebas de adaptadores aprobadas (6); primer fallo fue solo la precisión ISO
  de una aserción de fecha, ya corregida. Añadidas pruebas de ficha/reintento UI.
- Comprobaciones reales aprobadas: OpenLigaDB 306 partidos, OpenFootball 380 y
  TheSportsDB 15, incluyendo ficha individual. Sin usar claves privadas.
- Documentación `docs/APIS_FUTBOL.md` creada: 14 fuentes contrastadas, ocho
  conectores implementados, límites y pasos de configuración.
- Verificación final: cinco archivos de pruebas backend aprobados, nueve pruebas
  Flutter aprobadas y análisis sin incidencias. Incluye retorno a la lista,
  reintentos, fallos de fuente y comprobaciones de los ocho adaptadores.
- Añadido indicador de cantidad mostrada/total y reconocimiento de «Match
  Finished» de TheSportsDB. Formato aplicado y auditoría de secretos aprobada.
- `backend/.env` mantiene permisos 600; solo se añadieron cinco campos vacíos,
  sin modificar Supabase. No se configuraron cuentas ni se compraron planes.
- Fuentes operativas sin clave propia: OpenLigaDB, OpenFootball y muestra de
  TheSportsDB. Otras cinco requieren claves para probar su acceso real.
- Archivos principales nuevos: `backend/src/football/{http,normalize,providers,service}.js`,
  `backend/test/football.test.js`, `backend/scripts/check-football.js`,
  `mobile/lib/{football_models,football_screen}.dart`, `mobile/test/football_test.dart`
  y `docs/APIS_FUTBOL.md`. Se actualizaron app/config/API, dashboard y README.
- No hubo migraciones de base de datos, despliegue ni servidores persistentes.

## Última conexión completada: Supabase con singleton

El usuario informa que ya creó la base de datos/proyecto en Supabase y solicita
cómo proporcionar API o cadena de conexión para integrarla usando singleton.
El usuario ya proporcionó URL, clave pública, clave secreta y URL JWKS. No copiar
sus valores a este registro. El diagnóstico confirmó acceso a las ocho tablas
esperadas, incluida `saved_batches`; no fue necesario aplicar migraciones.
Se le indicó que rote la clave privada publicada en el chat.

- Verificado en el código: Flutter inicializa Supabase una vez en `main.dart`
  y comparte `Supabase.instance.client` en autenticación, API y dashboard; ya
  utiliza el singleton del SDK. No hace falta crear clientes por pantalla.
- Para empezar se necesitan Project URL y Publishable key, disponibles en
  Connect o Settings > API Keys. No se necesita una cadena PostgreSQL para la
  arquitectura actual basada en Supabase Auth y REST.
- Las claves privadas del backend deben configurarse en un `.env` local ignorado
  por Git o en el entorno del servidor; nunca en Flutter ni en este registro.
- Documentación oficial consultada:
  https://supabase.com/docs/guides/getting-started/api-keys
  https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- Implementado soporte de `SUPABASE_PUBLISHABLE_KEY` y
  `SUPABASE_SECRET_KEY` manteniendo compatibilidad con los nombres antiguos.
  Las claves `sb_secret_...` se envían únicamente en `apikey`; el Bearer se
  conserva para claves JWT antiguas. Los valores reales se configuraron solo
  en archivos locales ignorados por Git.

### Resultado de la conexión

1. Backend adaptado a claves nuevas y compatible con claves antiguas.
2. `Supabase.instance.client` sigue siendo el singleton compartido en Flutter.
3. Configurados `backend/.env` privado y `mobile/config.local.json` público.
4. Comprobados Auth, JWKS y ocho tablas con consultas sin filas.
5. API de lectura puede arrancar sin token de fútbol; el proveedor se inicializa
   cuando un job lo necesita. No se generaron datos ni tokens de fútbol ficticios.
6. Pruebas y análisis completados secuencialmente con el perfil de poca RAM.

Backend adaptado a claves nuevas/antiguas y proveedor de fútbol diferido.
`backend/.env` creado con permisos 600; `mobile/config.local.json` contiene solo
datos públicos y apunta a la API local, con HTTP permitido únicamente en debug.
Diagnóstico `npm run check:supabase` implementado sin leer filas. El primer
intento fue bloqueado por DNS del sandbox; el reintento con elevación aprobó
Auth HTTP 200, JWKS HTTP 200 (una clave pública) y acceso a las ocho tablas.
Flutter acepta la variable pública moderna y mantiene el singleton del SDK.
Formato aplicado y cuatro archivos de pruebas backend aprobados con concurrencia
1 y heap de 512 MiB. Análisis Flutter sin incidencias y 7 pruebas Flutter
aprobadas con concurrencia 1. Comprobados permisos 600 y ausencia de claves
privadas en el código, la documentación y la configuración Flutter.

Archivos principales de esta conexión: `backend/src/{config,repository}.js`,
`backend/test/{api,repository}.test.js`, `backend/scripts/check-supabase.js`,
`backend/package.json`, `backend/.env.example`, `mobile/lib/{main,api}.dart`,
`mobile/lib/connection_config.dart`, `mobile/test/connection_config_test.dart`,
`mobile/config.example.json`, `.gitignore` y los README. Los archivos con valores
reales son locales e ignorados; nunca copiar sus valores a esta memoria.

## Estado encontrado

- App móvil Flutter en `mobile/`; API Node.js ESM en `backend/`.
- Integraciones previstas: Supabase (autenticación y datos), proveedor de fútbol
  y Firebase (notificaciones). Existe modo demo.
- El modelo actual estima over 2.5 goles con Poisson y suavizado; declara que sus
  probabilidades aún no están calibradas.
- Las pruebas existentes esperan cuatro tickets de cuatro partidos, sin repetir
  partidos, con controles de datos antiguos y liquidación con resultados finales.
- Archivo abierto en el IDE: `backend/test/model.test.js`.
- No había documentación de continuidad; `mobile/README.md` era el texto inicial
  de Flutter. `docs/` y `tools/` estaban vacíos.
- (Resuelto 2026-11-06) `.git/` estaba vacío; ahora es un repositorio Git con
  remoto `origin` = https://github.com/angelgomezmoreno611-spec/App-Buenos-momios
  (público), rama `main`.

## Resultado del bloque

1. Implementados `saved_batches`, RLS, RPC idempotente y POST `/api/history`.
2. Implementados botón «Guardar tanda» y persistencia local de 14 tandas demo.
3. Pruebas de API, permisos, persistencia y navegación aprobadas.
4. Añadida prueba de migración de datos existentes y README de ejecución.
5. Verificaciones finales aprobadas y documentación de continuidad actualizada.

La suscripción de avisos también guarda la tanda para conservar el comportamiento
existente. Guardar una tanda por sí solo no suscribe a notificaciones.

Archivos principales cambiados: `backend/src/{app,repository}.js`,
`backend/test/{api,database}.test.js`, `supabase/migrations/002_saved_batches.sql`,
`mobile/lib/{api,dashboard}.dart`, `mobile/test/{widget_test,history_test}.dart`,
`README.md`, `mobile/README.md`, `AGENTS.md` y este archivo.

## Validaciones

- Backend final: `npm test` aprobó los cinco archivos (API, PostgreSQL/PGlite,
  modelo, repositorio y fútbol), incluidas compatibilidad de claves y cabeceras Auth.
- Perfil de poca RAM: `npm test` con heap Node de 512 MiB y concurrencia 1
  aprobado; nueva compilación Android pendiente. No se compiló Android ni se
  iniciaron emuladores durante la conexión Supabase.
- Node/npm no están en PATH; usar el directorio Node temporal indicado arriba.
- Flutter: análisis final aprobado sin incidencias. Requiere elevación por
  actualizaciones de caché del SDK fuera del proyecto.
- Flutter final: 9 pruebas aprobadas (2 de configuración, 2 de historial, 3 de
  interfaz original y 2 de partidos); formato aplicado. Verificados guardado,
  persistencia, HTTP local, fichas, datos demo y recuperación tras fallos.
- APIs públicas de fútbol: calendario y ficha individual comprobados con
  OpenLigaDB, OpenFootball y TheSportsDB. Otras cinco fuentes: adaptadores
  comprobados con respuestas simuladas; falta acceso real de sus cuentas.
- Supabase real: Auth 200, JWKS 200 y ocho tablas accesibles con `limit=0`.
  No se crearon usuarios, no se consultaron filas ni se modificó la base real.
- Secretos: permisos 600 en el archivo privado; valores ausentes de archivos
  de código/documentación y del JSON público de Flutter; exclusiones Git presentes.
- PostgreSQL: 6 pruebas aprobadas, incluida migración del historial existente.
- Build demo web del bloque anterior aprobado: `mobile/build/web/`. Aviso de fuentes Cupertino
  no incluidas, sin impedir la compilación; la app utiliza Material Icons.
- SDK Flutter: `/tmp/buenos-momios-flutter/bin/flutter` (enlace al SDK instalado).
  Dependencias disponibles en `PUB_CACHE=/tmp/buenos-momios-pub-cache`.

## Próximo paso exacto

El bloque de investigación e integración está terminado. Para abrir la app, arrancar
`npm run dev` desde `backend/` y, en otra terminal, ejecutar desde `mobile/`:
`flutter run -d web-server --web-port=8080 --dart-define-from-file=config.local.json`.
Abrir **Partidos**. Hay tres fuentes disponibles sin claves propias; la demo
muestra solo datos inventados. Cobertura y configuración: `docs/APIS_FUTBOL.md`.
Los detalles de PATH y arranque están en `README.md`.

El siguiente paso opcional es configurar claves gratuitas de las cinco fuentes
restantes en `backend/.env` y ejecutar `npm run check:football -- --configured`.
Para generar tickets reales sigue siendo necesario `FOOTBALL_DATA_TOKEN`.
Después verificar el flujo con una cuenta de usuario. La clave Secret compartida en el
chat debe rotarse en Supabase y reemplazarse localmente; no se rotó por el agente.
No se dejaron servidores activos ni se desplegó el proyecto.

## Pendientes del producto

- Probar inicio de sesión, guardado e historial con una cuenta de usuario real.
  La conectividad y presencia de tablas ya se comprobaron; los flujos se probaron
  con API simulada y PostgreSQL embebido, sin crear cuentas reales.
- Completar `FOOTBALL_DATA_TOKEN` para habilitar jobs de generación/liquidación.
- Completar configuración nativa Firebase (incluida integración Gradle en Android)
  y probar avisos en Android/iOS. No se comprobó ningún envío real.
- Validar/calibrar el modelo con históricos temporales válidos; no hay conjunto
  real de backtest en el repositorio.
- Si se continúa sin servicios externos, siguiente mejora local sugerida:
  reforzar validación de históricos incompletos o fechas inválidas en `model.js`
  con pruebas que impidan contaminar el pronóstico.

## Historial de esta sesión

- 2026-11-05: inspección inicial; creado este registro y la instrucción persistente
  de consultar y actualizarlo en `AGENTS.md`.
- 2026-11-05: leídos modelo, generador, repositorio, proveedor, jobs, migración,
  pruebas, autenticación y servicio de avisos; localizados SDK temporales.
- 2026-11-05: pruebas iniciales del backend aprobadas; confirmado que el historial
  depende de avisos. Iniciado desarrollo del guardado independiente.
- 2026-11-05: añadidas migración 002, API de guardado y pruebas de acceso,
  idempotencia, aislamiento de usuarios y separación de avisos.
- 2026-11-06: pruebas nuevas del backend aprobadas; implementado guardado en
  Flutter, historial demo persistente (14 tandas) y pruebas de persistencia/UI.
- 2026-11-06: 5 pruebas Flutter aprobadas; añadida prueba de migración con datos
  anteriores y ajustado el texto para distinguir resultados demo de reales.
- 2026-11-06: documentados arranque, configuración, guardado, migración y límites;
  corregido el detalle de estilo indicado por Flutter.
- 2026-11-06: 6 pruebas PostgreSQL aprobadas y demo web compilada; añadida
  comprobación de guardado con los privilegios reales de service_role.
- 2026-11-06: cerrado el bloque con backend, 5 pruebas Flutter y análisis estático
  aprobados; memoria e instrucciones de ejecución actualizadas.
- 2026-11-06: usuario creó Supabase; revisada conexión existente y documentación
  oficial para indicarle los datos necesarios. Sin cambios de código ni nuevas
  pruebas; quedan pendientes URL, clave pública y estado de migraciones.
- 2026-11-06: usuario solicita bajo consumo de RAM. Registrada la preferencia en
  AGENTS y contexto; ajustados scripts Node, perfil Gradle y comandos de pruebas
  Flutter en la documentación. La integración Supabase sigue pendiente de datos.
- 2026-11-06: comprobadas pruebas backend con el perfil de poca RAM, todas
  aprobadas. Este ajuste está terminado; siguiente paso: datos de Supabase.
- 2026-11-06: recibidos datos Supabase; iniciado bloque de integración real.
  Credenciales excluidas de documentación; se recomienda rotar la clave secreta.
- 2026-11-06: creados archivos locales de configuración; adaptados backend y
  Flutter, añadido diagnóstico de solo lectura y pruebas de cabeceras/configuración.
- 2026-11-06: diagnóstico real aprobado (Auth, JWKS y ocho tablas); cuatro
  archivos de pruebas backend aprobados; actualizado README para conexión local.
- 2026-11-06: conexión completada; análisis sin incidencias, 7 pruebas Flutter
  aprobadas y comprobación de secretos aprobada. Sin despliegue ni cambios a la
  base real. Pendientes token de fútbol, prueba con cuenta y rotación de clave.
- 2026-11-06: investigadas 14 fuentes e implementados ocho conectores de fútbol,
  vista Partidos y fichas. Comprobadas tres fuentes reales, cinco archivos de
  pruebas backend y nueve pruebas Flutter. Memoria, cuotas y caché acotadas;
  documentación de BeSoccer y accesos gratuitos actualizada.
- 2026-11-06: creado `CLAUDE.md` (comandos, arquitectura y reglas de poca RAM
  resumidas de AGENTS/README). Solo documentación; sin cambios de código ni pruebas.
- 2026-11-06: inicializado Git y subido el proyecto a GitHub (repo público,
  rama `main`, commit inicial). Verificado antes de subir: `backend/.env` y
  `mobile/config.local.json` ignorados; escaneo sin claves ni valores privados.
- 2026-11-06: despliegue en Vercel (proyecto `backend`, Root Directory `backend`,
  dominio https://backend-angelgomezmoreno611-specs-projects.vercel.app). Usuario
  desactivó Vercel Authentication. Error 500 FUNCTION_INVOCATION_FAILED en todas
  las rutas: Vercel detectaba un preset de servidor. Corregido con
  `"framework": null` en `backend/vercel.json` (commit 8a7dbba); verificado `/` 404
  y `/api/*` llegando al código. Pendiente: la API responde 503 por variables de
  entorno faltantes/incorrectas en Production; el usuario debe revisarlas y hacer
  Redeploy. Siguiente paso: comprobar `/api/health` = {"ok":true,"mode":"live"}.
- 2026-11-06: `backend/api/index.js` ahora responde en el 503 `revisar: [...]`
  con los NOMBRES de variables que faltan (nunca valores). 35/35 pruebas backend
  aprobadas; subido a GitHub. Verificado en producción: Vercel no ve ninguna de
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY ni CRON_SECRET aunque
  el usuario hizo Redeploy. Pendiente: que las agregue en el proyecto `backend`
  para el entorno Production y vuelva a desplegar.
- 2026-11-06: API desplegada y verificada en producción
  (https://backend-angelgomezmoreno611-specs-projects.vercel.app):
  `/api/health` 200 {"ok":true,"mode":"live"}; rutas de usuario 401 sin sesión;
  `/api/jobs/settle` 401 sin CRON_SECRET. No se ejecutaron jobs reales.
  Pendientes: rotar la clave Secret de Supabase (expuesta en el chat dos veces),
  compilar la app con API_URL de Vercel, ALLOWED_ORIGIN si se usa web,
  FOOTBALL_DATA_TOKEN y programar jobs con `supabase/schedule.example.sql`.
- 2026-11-06: `mobile/config.local.json` (ignorado por Git) apunta ahora a la API
  de Vercel; se quitó ALLOW_LOCAL_API. Para volver al backend local: API_URL
  `http://localhost:3000` + `"ALLOW_LOCAL_API": "true"`. Comprobado: el preflight
  CORS desde `http://localhost:8080` no devuelve Access-Control-Allow-Origin; para
  usar la app web local falta `ALLOWED_ORIGIN=http://localhost:8080` en Vercel
  (Production) + Redeploy. Android/iOS no necesitan CORS.
- 2026-11-06: detectado que CRON_SECRET en Vercel contenía la URL pública de
  JWKS. Con Vercel CLI (temporal en el scratchpad de la sesión, proyecto
  vinculado en `backend/.vercel/`, ignorado) se reemplazaron CRON_SECRET y
  SUPABASE_SECRET_KEY por los valores de `backend/.env` como Sensitive, se añadió
  ALLOWED_ORIGIN=http://localhost:8080 y se redesplegó. Verificado: health 200,
  CORS permite localhost:8080 y `/api/jobs/settle` rechaza la URL pública (401).
  Alias extra de Vercel: https://backend-sable-six-36.vercel.app.
  Pendiente: rotar la clave Secret de Supabase (expuesta tres veces) y probar
  inicio de sesión en la app web.
- 2026-11-06: APK release arm64 compilado (`flutter build apk --release
  --target-platform android-arm64 --dart-define-from-file=config.local.json`,
  ~5 min, 18.4 MB) con el perfil de poca RAM: Java llegó a ~2.4 GB RSS y quedaron
  ~100 MB libres (cerrar el navegador ayuda). Firmado con clave debug.
  Instalado con adb en el Poco F7 (model 25053PC47G; requirió activar
  "Instalar vía USB" en HyperOS) y la app arranca sin errores en logcat.
  Flutter migró `minSdk = 23` a `flutter.minSdkVersion` en build.gradle.kts.
  JDK: /home/angel/jdk/jdk-17.0.21+9 (configurado en Flutter); adb en
  ~/Android/Sdk/platform-tools (no está en PATH). Pendiente: el usuario debe
  probar inicio de sesión, tickets y Partidos en el teléfono.
- 2026-11-07: investigada la app Bullet (Bullet Bet Predictions, bulletpredictions.com,
  desarrollador Giovanni Pecoraro). Sin API pública ni licencia de datos; sus
  términos (/terms, sección 4) prohíben scraping/bots, copiar, redistribuir y uso
  comercial. No integrar ni extraer sus datos. Sin cambios de código.
- 2026-11-07: pasos 1-2 del plan "el modelo aprende de datos abiertos".
  Nuevo `backend/scripts/import-openfootball.js` (`npm run import:openfootball`):
  descarga en serie 2019-20..2024-25 de en.1, es.1, de.1, it.1 y fr.1 (CC0) y
  normaliza al formato del backtest en `backend/data/openfootball.json` (ignorado).
  10.687 partidos con marcador. Ids de equipo unificados (sufijos FC/CF… y tabla
  de alias por liga); auditado: 20/18 equipos por temporada y sin cortes falsos.
  Supuestos: horas como UTC (sin zona en origen) y availableAt = kickoff + 3 h.
  Prueba nueva `test/import-openfootball.test.js` (2/2 aprobadas).
  Backtest del modelo actual (27 s, heap 512 MiB), comprobado:
  8.776 evaluados; Brier 0.2455 vs 0.2471 de la tasa de la liga (mejora ~0.7%,
  señal débil); log loss 0.684. Con p>=0.65: 767 partidos, acierto 64.9%.
  Fiabilidad: bien en el centro, sobreconfiado en extremos (pred. 0.37 → real
  0.45; pred. 0.73 → real 0.66). Un ticket de 4 partidos a ~65% acierta ~18%
  (0.65^4), suponiendo independencia.
  Siguiente paso propuesto (paso 3, sin hacer): calibrar con temporadas
  2019-20..2023-24 y validar en 2024-25; ajustar umbral y mostrar el acierto
  histórico en la app.
- 2026-11-07: paso 3 (calibración). `model.js` devuelve `rawProbability` y admite
  `CALIBRATION` (Platt sobre logit); nuevo `npm run calibrate`. Ajuste con
  2019-20..2023-24 (7.276 partidos): a=0.065, b=0.672. Validación 2024-25 (1.500):
  Brier sin calibrar 0.2422 vs calibrado 0.2428 → la calibración NO mejora fuera
  de muestra; se deja `CALIBRATION = null` (modelo sin cambios de comportamiento).
  En 2024-25 sin calibrar: umbral 0.65 → 154 picks, acierto 65.6%; 0.60 → 409,
  64.1%; 0.55 → 721, 61.4%. Ticket estimado (independencia): 2 partidos ~43%,
  3 ~28%, 4 ~18.5%. Única sobreconfianza clara: pred. 0.73 → real 0.62 (42 casos).
  37/37 pruebas backend aprobadas. Siguiente paso propuesto: mejorar la
  discriminación (vida media, prior, pesos Poisson/empírico) con validación
  temporal, y mostrar en la app el acierto histórico y la probabilidad del ticket.
- 2026-11-07: búsqueda de parámetros (`npm run tune`, 36 configs × pesos,
  selección solo con 2023-24, prueba 2024-25, conjunto común de 730/796
  partidos). Mejor en validación (vida media 365 d, 38 juegos, prior 8, solo
  empírico) EMPEORÓ en prueba: Brier 0.2460 vs 0.2422 del actual. Conclusión:
  diferencias = ruido; se mantienen DEFAULT_PARAMS (90 d, 20, 8, 0.8). Mejorar de
  verdad requiere información nueva (p. ej. cuotas del mercado), no reajustar.
  `predict` acepta `params` (por defecto los actuales; sin cambio de conducta).
  Añadido `MODEL_EVIDENCE` (2024-25, 5 ligas, umbral 0.65, 154 picks, 65.6%) al
  lote solo si minProbability = 0.65; texto de aviso actualizado.
  App: tarjeta y detalle muestran "~1 de cada N"; detalle y "Cómo funciona"
  muestran la evidencia; se quitaron textos obsoletos (75%, "sin calibrar").
  Verificado: 38/38 pruebas backend, `flutter analyze` sin incidencias y 11/11
  pruebas Flutter (nuevo `test/evidence_test.dart`).
- 2026-11-07: APK con la nueva interfaz compilado (129 s) e instalado en el Poco
  F7; arranca sin errores en logcat. API en Vercel redesplegada desde GitHub y
  `/api/health` OK. adb detenido. La evidencia aparecerá en lotes generados a
  partir de ahora (requiere FOOTBALL_DATA_TOKEN para generar lotes reales); los
  lotes antiguos muestran el texto genérico.
- 2026-11-07: durante esa compilación el kernel mató Brave por falta de memoria
  (OOM 15:08) y la sesión de VS Code se reinició; el APK sí terminó (exit 0).
  Reinstalado el mismo APK (verificado que contiene los textos nuevos). Para
  compilar: cerrar el navegador antes; con caché de Gradle ya caliente tarda
  ~2 min. Si se compila de nuevo, no iniciar nada más en paralelo.
- 2026-11-07: FOOTBALL_DATA_TOKEN configurado (validado HTTP 200) en
  `backend/.env` (600) y en Vercel como Secret; redesplegado. Job generate
  ejecutado en producción: lote 2026-11-07 creado con 0 tickets. Causa
  comprobada: 32/33 partidos rechazados por "Muestra insuficiente" porque
  `provider.js` solo descarga la temporada actual (iniciada en agosto; ~5 juegos
  por condición). El backtest sí usaba la temporada anterior (ventana de 400
  días), así que producción no coincide con lo evaluado. Comprobado: el plan
  gratuito devuelve la temporada anterior (PL 2025: 380 terminados).
  Límite: 10 peticiones/min, así que no cabe descargar 16 temporadas en cada
  generación. Propuesta pendiente de aprobar: migración 003 con tabla de
  histórico + job que guarda la temporada anterior una sola vez + generador que
  combina ambos.
- 2026-11-07: implementado histórico de temporadas anteriores.
  Migración `003_match_history.sql` (tablas `match_history` e `history_seasons`,
  RLS sin políticas, solo service_role). Nuevo job `/api/jobs/history`: calcula
  la temporada anterior (`previousSeason`), descarga 1 petición por liga
  pendiente (máx. 8 por ejecución) y la guarda; la marca de temporada se escribe
  al final. `generate` lee `match_history` (ventana 400 días, ligas configuradas,
  paginación de 1000) y lo combina sin duplicar con la temporada actual.
  `schedule.example.sql` añade history a las 12:50 UTC. Verificado: 42/42
  pruebas backend (incluye migración en PGlite). PENDIENTE del usuario: aplicar
  003 en Supabase (SQL Editor) y borrar el lote vacío del 2026-11-07
  (786789d2-c527-4845-9331-28fc8fb1bb19) para regenerar hoy. Después: ejecutar
  history, esperar >70 s y ejecutar generate.
- 2026-11-07: el usuario aplicó la migración 003 y borró el lote vacío.
  Job history en producción: temporada 2025 guardada en las 8 ligas
  (PL 380, PD 380, BL1 306, SA 380, FL1 305, DED 306, PPL 306, ELC 556;
  2919 partidos, remaining 0). Job generate: lote
  c7086606-0fe6-47fb-821e-e5112abfc04c (día 2026-11-07, partidos del 08-11) con
  **1 ticket** (conjunta estimada 0.23): Cambuur-PSV 0.761, Freiburg-Union
  Berlin 0.699, Köln-Leverkusen 0.660, AZ-Groningen 0.653. 4 elegibles; de 30
  rechazados, 25 por probabilidad < 0.65 y solo 5 por muestra insuficiente
  (antes eran 32/33). Comprobado: la falta de muestra quedó resuelta; tener
  pocos tickets es el umbral 0.65 funcionando, no un fallo.
  Pendiente: programar los crons (history 12:50, generate 13:00 UTC, etc.).
- 2026-11-08 (UTC): el usuario ejecutó en Supabase el SQL de programación
  (pg_cron + pg_net + Vault con `buenos_momios_api_url` y
  `buenos_momios_cron_secret`). Activos: momios-history 12:42, momios-generate
  13:00, momios-settle :05/:20/:35/:50 (UTC). notify no se programó porque
  Firebase no está configurado. Comprobado en logs de Vercel: POST
  /api/jobs/settle a las 06:05:00 UTC respondió 200. history se movió a 12:42 en
  `schedule.example.sql` para no coincidir con settle a las 12:50 (lock de 70 s).
  El archivo temporal con el secreto se borró.
  Opciones de cobertura presentadas (sin decidir): A) añadir BSA y CLI (incluidas
  en el plan gratuito de football-data.org); B) CSV de football-data.co.uk para
  validar Brasil/México; C) Wikipedia para Honduras/Costa Rica; D) carga manual;
  E) scraping descartado por términos de uso.
- 2026-11-08: añadido Brasileirão (BSA) a football-data.org: hasta 9 ligas,
  temporada de año natural en `previousSeason(now, league)`, liga vacía = aviso.
  FOOTBALL_COMPETITIONS actualizado en Vercel y `.env`; history cargó BSA 2025
  (380). 45/45 pruebas. Libertadores NO añadida: el modelo filtra historial por
  competición y en una copa ningún equipo llega a 6 partidos por condición.
  Fuentes revisadas sin API de pago: football-data.co.uk (CSV gratis: MEX, ARG,
  USA, BRA... con resultados de todas las temporadas, con días de retraso, y
  `new_league_fixtures.csv` con próximos partidos, horas en Europe/London);
  Wikipedia ES tiene calendario y resultados de Honduras (Apertura 2026, tablas
  por jornada con rowspan); Costa Rica no tiene página de la temporada actual.
  Backtest (scratchpad, mismo modelo, umbral 0.65): Liga MX 68 picks en 14 años,
  57% acierto, Brier peor que la referencia → no apta; Argentina 2 picks (liga de
  pocos goles); Brasil 8 picks, 50% → BSA aportará muy pocos; MLS 592 picks, 67%
  (2024: 66%, 2025: 74%, 2026: 70%) → apta, pero ahora está en playoffs (posible
  prórroga) y vuelve en febrero. Módulo `src/csvleagues.js` creado y probado,
  AÚN NO conectado a config/jobs. Pendiente decisión del usuario.
- 2026-11-08: ligas extra vía CSV de football-data.co.uk. Comprobado en
  contact.php: uso solo personal/académico, NO comercial, descarga automática
  máx. 2 veces/semana. Diseño: job `/api/jobs/csv` (mar y vie 12:27 UTC) registra
  el intento en `csv_sync_runs` y se niega si ya hubo 2 en 7 días; guarda
  próximos partidos y resultados (400 días) en `csv_matches` (migración 004).
  generate/settle solo leen la tabla y toleran que no exista (aviso, sin fallo).
  Backtest por liga (2022-07 a 2026-11, umbral 0.65; script en scratchpad):
  activadas NOR 157 sel./75.8%, SWE 50/74%, CHN 149/72.5%, SWZ 149/69.8%,
  T1 71/66.2%, DNK 56/64.3%, USA 592/67.2% (MLS sin nov-dic por playoffs).
  Rechazadas: D2 55.6%, B1 53.2%, AUT 54.2%, POL 57.9%, FIN 62.9% (borde);
  muestra insuficiente: F2, I2, SP2, G1, ROU, JPN, IRL, SC0-SC3. Supuesto: hay
  sesgo de selección al elegir las mejores de 22 ligas. Liga MX, ARG y BSA
  rinden mal con este modelo (ver entrada anterior). 50/50 pruebas.
  Descargas de hoy para el backtest: ~80 archivos (manual, investigación); no se
  ejecutó el job csv para no gastar el cupo semanal: la primera descarga
  automática será el martes 2026-11-10. Comprobado: migración 004 aplicada
  (tablas vacías accesibles vía REST) y `momios-csv` activo ('27 12 * * 2,5')
  junto a generate, history y settle. Próximo paso: el martes 10 revisar
  `csv_sync_runs`, filas en `csv_matches` y la tanda de las 13:00 UTC.
- 2026-11-08: backtests de rentabilidad con cuotas de cierre (CSV ya descargados,
  sin descargas nuevas; scripts en scratchpad `bt-dc.mjs` y `bt-ou.mjs`).
  Doble oportunidad (25 ligas, 60 867 predicciones): Brier modelo 0.2086 vs
  mercado 0.1990; ROI −5% a −7% en todos los umbrales; cuando el modelo difiere
  ≥5 pt del mercado, ROI −12%. Ticket de 4 a ≥0.80: ~53% de acierto, ~−14%.
  Decisión recomendada: NO añadir doble oportunidad.
  Over 2.5 (11 divisiones "main" con cuotas: B1, D2, F2, G1, I2, SC0-3, SP2, T1;
  10 796 predicciones desde 2022-07): Brier modelo 0.2483 vs mercado 0.2411.
  Selecciones ≥0.65: 350, acierto 60.6% (el mercado ya esperaba 61.9%), cuota
  media 1.54, ROI −8.5% (−5.0% con la mejor cuota). T1 (activada): ROI −7.2%.
  Tickets de 4 simulados: 87, acertados 11.5%, ROI −44%. Seleccionar por
  probabilidad del mercado ≥0.65 acierta más (71.8%) pero ROI −2.4%.
  Comprobado: el modelo no tiene ventaja sobre las casas en estas ligas.
  NO medido: las 8 ligas de producción (PL, PD, BL1, SA, FL1, DED, PPL, ELC)
  porque no hay cuotas en disco; supuesto razonable: mercados aún más eficientes.
- 2026-11-08: cambio de producto pedido por el usuario: over 1.5 y tickets de 6.
  Backtest over 1.5 (2022-07 a hoy, umbral 0.80; script `bt-o15.mjs` en
  scratchpad): PL 522 sel./85.1%, BL1 575/84.7%, FL1 239/86.2%, LaLiga 76/76.3%,
  Serie A 80/70.0% (excluidas), Brasil 57/82.5%. Brier ≈ referencia de liga: el
  modelo aporta poco sobre la tasa base; elige sobre todo ligas goleadoras.
  Sin cuotas de over 1.5 en las fuentes: NO se pudo medir rentabilidad. Con
  6 partidos de ~85%: ~38% de tickets acertados (si fueran independientes).
  Ligas CSV para over 1.5 (≥100 sel. y ≥80%): USA, NOR, SWZ, CHN, T1, B1, MEX,
  SWE, DNK, SC0, FIN, SC2, SC3, POL (Liga MX entra en over 1.5).
  Código: `overLine`/`predict(..., {line})`, `MARKETS` y `MARKET_BLOCKED` en
  tickets.js, `resultOf(match, market)`, settle lee `market` de cada selección,
  config `TICKET_MARKET` (OVER_1_5), `TICKET_LEGS` (6), umbral por defecto según
  mercado. Eliminado MIN_PROBABILITY=0.65 de Vercel y `.env`. Migración 005:
  `tickets.legs` (4|6), mercado OVER_1_5, publish/apply_results por tamaño.
  App: lee `line`/`legs` del lote (lotes antiguos: 2.5 y 4). 53/53 backend,
  12/12 Flutter, analyze limpio. PENDIENTE: usuario aplica 005 ANTES de las
  13:00 UTC del 2026-11-09 (si no, publish_batch rechaza el lote de 6); compilar
  e instalar la app nueva en el Poco F7.
- 2026-11-08: comprobado que la migración 005 está aplicada (columna
  `tickets.legs` accesible vía REST). APK release arm64 recompilado con Brave
  cerrado (~23 s con caché caliente, 18.4 MB) e instalado en el Poco F7
  (lastUpdateTime 2026-11-08 10:07:47, app abierta). El primer lote over 1.5 / 6
  partidos se generará el 2026-11-09 a las 13:00 UTC.
- 2026-11-08: lote del día regenerado (el de over 2.5 tenía 0 tickets; el
  usuario autorizó borrarlo): b8d47d65… con 0 tickets en over 1.5/6 porque solo
  había 7 partidos en las próximas 72 h (domingo tarde + parón de selecciones
  9-17 nov). API-Football: clave del usuario guardada en `backend/.env`
  (API_FOOTBALL_KEY; quedó escrita en el chat, recomendar regenerarla). Plan Free
  comprobado: 100/día y SIN temporada actual ("Free plans do not have access to
  this season, try from 2022 to 2024") → no sirve para tickets. Backtest con
  2022-2024 (12 consultas, script `bt-af.mjs`): tasas over 1.5/over 2.5 y
  selecciones ≥0.80 en over 1.5: Honduras 72.4%/48.2%, 57 sel. 71.9%; Costa Rica
  72.7%/48.9%, 91 sel. 79.1%; Guatemala 67.7%/44.6%, 23 sel. 73.9%; El Salvador
  70.2%/42.8%, 23 sel. 73.9%. Ninguna alcanza el criterio (≥80%); son ligas de
  menos goles que las europeas activadas. No se recomienda pagar Pro para ellas.
- 2026-11-08: el usuario pidió actualizar los tickets a medianoche de Mazatlán
  (UTC-7 fijo). Nuevo horario: momios-generate '1 7 * * *' (00:01 local, para que
  `dayKey` ya sea el día nuevo) y momios-history '42 6 * * *' (23:42 local).
  settle y csv sin cambios. Actualizado `schedule.example.sql`; el usuario debe
  aplicar el cambio con `cron.alter_job` en Supabase.
- 2026-11-08: fuentes gratuitas extra. OpenFootball 2026-27 solo tiene ligas ya
  cubiertas (no añade partidos), pero sirvió para validar ligas de producción sin
  medir, over 1.5 ≥0.80 (script `bt-extra.mjs`): Championship 193 sel./80.8%,
  Eredivisie 617/87.7%, Portugal 163/81.6% → se mantienen. 3. Liga (OpenLigaDB,
  2021-2026): over 1.5 437 sel./81.2% → activada; over 2.5 118/57.6% → no.
  Implementado `src/openliga.js` (ODbL con atribución en la tanda), generate y
  settle con fallo tolerante. 56/56 pruebas. Prueba real: 411 partidos de
  historial; la 3. Liga vuelve el 20-22 nov tras el parón.
- 2026-11-08: pedido del usuario: usar todas las fuentes gratuitas y añadir "El
  arriesgado del día" (2 over 3.5 + 2 over 2.5). Backtest over 3.5 (30 ligas,
  2022-07 en adelante, `bt-o35.mjs`): ≥0.40 3246 sel./42.1%, ≥0.45 1143/47.1%,
  ≥0.50 334/48.8% (modelo algo sobreconfiado). Elegido mínimo 0.40 para 3.5 y
  0.65 para 2.5; el ticket toma los 2 mejores de cada mercado entre los partidos
  libres tras los tickets normales. Estimación ≈ 0.45²·0.63² ≈ 8% (1 de cada 12).
  Modelo: línea 3.5; MARKETS con OVER_3_5; migración 006 (tickets.kind, ordinal
  hasta 5, mercado OVER_3_5, máx. 4 normales + 1 arriesgado). Si publish falla con
  el arriesgado, se reintenta sin él. Ligas CSV over 1.5: añadidas G1 (77/89.6%) e
  IRL (43/83.7%) bajando el mínimo de selecciones a 40. No añadidas: CL/WC/EC de
  football-data.org (copas: el modelo usa historial de la misma competición),
  2. Bundesliga (79.4%, bajo el corte). App: ticket arriesgado aparte con borde
  naranja. 59/59 backend, 13/13 Flutter, analyze limpio. PENDIENTE: usuario aplica
  006 y se recompila la app.
- 2026-11-08: comprobado que la migración 006 está aplicada (`tickets.kind`
  accesible). APK recompilado con Brave cerrado (24 s) e instalado en el Poco F7
  con soporte del ticket arriesgado.
- 2026-11-08: descubrimiento de partidos con API-Football gratis. Comprobado:
  `fixtures?date=` funciona solo de ayer a mañana (1242 partidos hoy, 330 ligas);
  `last`, temporadas actuales y fechas viejas bloqueados; `predictions?fixture=`
  SÍ funciona (promedios casa/fuera de la temporada + últimos 5). Límites: 10/min,
  100/día. Método "forma reciente" (70% temporada casa/fuera + 30% últimos 5,
  Poisson) medido en 25 660 partidos de 30 ligas (`bt-form.mjs`): over 1.5 ≥0.80
  82.0%, ≥0.85 2135 sel./84.7%; over 2.5 ≥0.65 63.2%; over 3.5 ≥0.45 43.0%.
  Umbrales para ligas nuevas (no validadas): 0.85 / 0.65 / 0.45.
  Implementado: `src/apifootball.js`, `src/discover.js` (job sin lock, ≤6
  consultas por ejecución con 6.5 s entre ellas, presupuesto 85/día en
  `af_usage`, listas una vez por día, prioriza ligas por `af_league_rates`),
  migración 007 (`af_matches`, `af_usage`, vista `af_league_rates`), generate y
  settle integrados, excluye las 26 ligas ya cubiertas (ids verificados con
  /leagues?current=true), copas, amistosos, juveniles y eliminatorias.
  API_FOOTBALL_KEY añadida a Vercel (sensible). 65/65 pruebas. Consultas AF
  gastadas hoy en pruebas: ~22. PENDIENTE usuario: migración 007 y cron
  `momios-discover`.
