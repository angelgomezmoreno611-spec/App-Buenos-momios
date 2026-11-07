# Buenos Momios

App Flutter con selecciones explicadas para **over 2.5 goles**: tres goles o más
en 90 minutos más descuento. La API Node.js publica hasta cuatro tickets de
cuatro partidos, consulta resultados y prepara avisos de tickets acertados.

## Continuar el desarrollo

Leer primero [CONTEXTO.md](CONTEXTO.md). Contiene el estado verificado, las
decisiones y el próximo paso. [AGENTS.md](AGENTS.md) establece su actualización
en cada bloque de trabajo.

## Ejecutar la demo

Requisitos: Flutter con Dart 3.9 o posterior; Node.js 22 para el backend.

La app demo funciona sin servidor, cuentas ni credenciales:

```bash
cd mobile
flutter pub get
flutter run -d web-server --web-port=8080 --dart-define=APP_MODE=demo
```

Abrir la URL local que muestre Flutter. También se puede ejecutar en un emulador
o teléfono con `flutter run --dart-define=APP_MODE=demo`.

En **Mis tickets**, pulsar **Guardar tanda**; después abrir **Historial**. La
demo conserva hasta 14 tandas en el almacenamiento de ese dispositivo o navegador,
sin duplicados. Todos sus equipos, resultados y probabilidades son sintéticos.
Los resultados de ejemplo permanecen fijos. Borrar los datos de la app o del
navegador elimina ese historial.

Para probar por separado la API demo:

```bash
cd backend
npm ci
DATA_MODE=demo npm run dev
```

Consultar `http://localhost:3000/api/health` y `/api/tickets`. El historial demo
de la app se guarda localmente; la API demo no almacena tandas de usuarios.

## Configurar datos reales

1. Crear el proyecto de Supabase y aplicar en orden los SQL de
   [supabase/migrations](supabase/migrations). En una base ya creada con `001`,
   aplicar únicamente `002_saved_batches.sql` para este cambio. La migración
   conserva las tandas antes guardadas al activar los avisos.
2. Configurar las variables de [backend/.env.example](backend/.env.example) en
   `backend/.env` o en el entorno del servidor, usando `DATA_MODE=live`.
   Usar `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`.
   `CRON_SECRET` requiere al menos 32 caracteres. El token de fútbol es necesario
   para los jobs de generación/liquidación; la API de lectura puede arrancar
   mientras falta ese token. Firebase es opcional si no se envían avisos.
3. Arrancar el backend con `npm run dev` y disponer de una URL HTTPS para el
   cliente real. En web, configurar `ALLOWED_ORIGIN` con el origen del cliente.
4. Ejecutar la app con las variables públicas de conexión:

```bash
cd mobile
flutter run \
  --dart-define=APP_MODE=live \
  --dart-define=API_URL=https://TU-API \
  --dart-define=SUPABASE_URL=https://TU-PROYECTO.supabase.co \
  --dart-define=SUPABASE_PUBLISHABLE_KEY=TU-CLAVE-PUBLICA
```

`API_URL` se configura sin barra final. La clave Secret, el token del
proveedor, `CRON_SECRET` y la cuenta de servicio Firebase pertenecen solo al
servidor. El cliente utiliza la clave pública de Supabase y la sesión del usuario.

La app inicializa Supabase una vez y comparte `Supabase.instance.client` en todas
las pantallas. Los nombres antiguos `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` se conservan como alternativa de compatibilidad.
El backend verifica las sesiones contra Supabase Auth; la URL JWKS se utiliza
en el diagnóstico de conectividad y no sustituye esa verificación.

### Arranque local con Supabase

La configuración privada está en `backend/.env`, ignorado por Git, con permisos
de acceso solo para su propietario. El archivo `mobile/config.local.json`, también
ignorado, contiene únicamente URL y clave pública, y apunta a la API local.
No pasar `backend/.env` al compilador de Flutter ni incluir claves Secret en JSON
del cliente. La plantilla pública es [mobile/config.example.json](mobile/config.example.json).

Comprobar la conexión antes de arrancar:

```bash
cd backend
npm run check:supabase
npm run dev
```

En otra terminal, abrir el cliente:

```bash
cd mobile
flutter run -d web-server --web-port=8080 --dart-define-from-file=config.local.json
```

En este entorno Node está disponible en `/tmp/node-v22.23.4-linux-x64/bin`;
si no está en PATH, ejecutar primero
`export PATH="/tmp/node-v22.23.4-linux-x64/bin:$PATH"`.

Para el desarrollo local se permite HTTP exclusivamente hacia localhost/loopback
o el host del emulador Android, con `ALLOW_LOCAL_API=true` y compilación debug.
En release se exige HTTPS. La clave del proyecto Supabase sigue usando HTTPS.

`check:supabase` hace consultas de solo lectura: comprueba Auth, acceso a JWKS
y ocho tablas con `limit=0`. No crea cuentas, no lee filas y no aplica migraciones.
Un resultado correcto no equivale a haber probado un inicio de sesión completo.
Si se rota la clave Secret, reemplazarla solo en `backend/.env` o en el entorno
del servidor y reiniciar el backend.

Referencia: [claves nuevas de Supabase](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

La generación, liquidación y entrega de avisos se ejecutan mediante los endpoints
protegidos `/api/jobs/generate`, `/api/jobs/settle` y `/api/jobs/notify`.
[supabase/schedule.example.sql](supabase/schedule.example.sql) contiene el ejemplo
de programación; no se activa automáticamente.

El guardado y el historial no necesitan Firebase. Los avisos requieren configurar
Firebase de forma nativa en Android/iOS y compilar con `ENABLE_PUSH=true`.
La configuración nativa y el envío a teléfonos reales siguen pendientes de
verificación; no basta con activar esa variable.

## Guardado e historial

- `POST /api/history`, con sesión y `{ "batchId": "UUID" }`, guarda una tanda
  publicada para el usuario autenticado. Repetir la petición no la duplica.
- `GET /api/history` devuelve las últimas 14 tandas guardadas, con sus estados
  actuales. Las selecciones originales mantienen sus identificadores.
- Guardar una tanda no registra dispositivos ni activa avisos. Activar los avisos
  sigue guardando la tanda automáticamente.
- `saved_batches` tiene aislamiento por usuario mediante RLS; las escrituras
  pasan por la API. Es necesario aplicar la migración 002 antes del nuevo backend.

## Información de partidos

La pestaña **Partidos** consulta ocho fuentes y abre fichas con datos disponibles
de marcadores, estadios, estadísticas, alineaciones, eventos y cuotas. OpenLigaDB,
OpenFootball y la muestra de TheSportsDB funcionan sin claves propias; los otros
cinco conectores se habilitan al configurar su acceso en `backend/.env`.

Consulta [la comparación de 14 fuentes y su configuración](docs/APIS_FUTBOL.md),
incluida BeSoccer. Las consultas son secuenciales, con caché acotada. No alteran
el modelo de tickets ni necesitan una nueva migración de Supabase.

```bash
cd backend
npm run check:football
```

## Comprobaciones

```bash
cd backend
npm test
```

```bash
cd mobile
flutter analyze
flutter test --concurrency=1
flutter build web --dart-define=APP_MODE=demo
```

Las pruebas de base de datos usan PostgreSQL embebido (PGlite), sin Supabase real.
Las pruebas Flutter verifican la navegación, el guardado, la persistencia y el
límite del historial demo.

## Trabajo con poca RAM

Ejecutar una sola tarea pesada a la vez y esperar a que termine antes de iniciar
otra. Los scripts de Node limitan su heap a 512 MiB; `npm test` procesa un archivo
de pruebas a la vez. En Flutter, usar siempre `flutter test --concurrency=1`.

Android está configurado con un trabajador Gradle, heap Java de 1 GiB, sin
compilación paralela ni daemons persistentes, y Kotlin dentro del proceso Gradle.
Estos son límites de heap: los procesos pueden necesitar memoria nativa adicional.
La compilación Android con este perfil todavía debe verificarse en un entorno
con SDK Android. Preferir teléfono físico o navegador al trabajar en esta laptop.

Referencias de las opciones: [configuración Gradle](https://docs.gradle.org/current/userguide/build_environment.html)
y [estrategias del compilador Kotlin](https://kotlinlang.org/docs/gradle-compilation-and-caches.html).

## Estado del modelo

Baseline Poisson con suavizado, muestras por condición local/visitante y controles
temporales. Las probabilidades todavía no están calibradas. El modelo no incluye
cuotas, lesiones, alineaciones, clima ni xG; no calcula rentabilidad.

Histórico para evaluar el modelo: `npm run import:openfootball` descarga las
temporadas 2019-20 a 2024-25 de cinco ligas (OpenFootball, CC0) a
`backend/data/openfootball.json`, ignorado por Git, y `npm run backtest --
data/openfootball.json` mide el modelo sin usar resultados futuros. Supuestos:
horas del archivo tratadas como UTC y marcador disponible 3 h tras el inicio.
