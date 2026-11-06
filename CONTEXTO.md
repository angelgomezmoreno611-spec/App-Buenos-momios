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
