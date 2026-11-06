# Buenos Momios · Cliente Flutter

Consultar el [README del proyecto](../README.md) para configuración y arquitectura,
y [CONTEXTO.md](../CONTEXTO.md) antes de continuar el desarrollo.

## Demo local

```bash
flutter pub get
flutter run -d web-server --web-port=8080 --dart-define=APP_MODE=demo
```

La demo utiliza `assets/demo_batch.json`, sin backend ni credenciales. Pulsar
**Guardar tanda** en **Mis tickets** y consultar **Historial**. El historial
persiste localmente con un máximo de 14 tandas; los datos son inventados y sus
resultados permanecen fijos.

## Validación

```bash
flutter analyze
flutter test --concurrency=1
flutter build web --dart-define=APP_MODE=demo
```

Ejecutar cada tarea por separado para reducir el consumo de RAM. Android tiene
un perfil de Gradle con un trabajador y heap de 1 GiB; su compilación con estos
límites sigue pendiente de verificar. Preferir navegador o teléfono físico.

## Supabase real en desarrollo local

Con el backend iniciado (`npm run dev` desde `backend/`), usar el archivo público
de configuración local, ya excluido de Git:

```bash
flutter run -d web-server --web-port=8080 --dart-define-from-file=config.local.json
```

`config.local.json` solo contiene URL y clave pública. Nunca usar `backend/.env`
como archivo de `dart-define`: contiene secretos del servidor.

El modo real requiere `APP_MODE=live`, `API_URL` con HTTPS, `SUPABASE_URL` y
`SUPABASE_PUBLISHABLE_KEY` (también se acepta `SUPABASE_ANON_KEY`). HTTP hacia
localhost solo se admite en debug con `ALLOW_LOCAL_API=true`. El SDK comparte una
sola instancia mediante `Supabase.instance.client`.

Guardar tandas funciona sin activar Firebase; los avisos son
una función opcional para Android/iOS que requiere su configuración nativa.

## Partidos de varias fuentes

La pestaña **Partidos** permite cambiar de fuente y competición y abrir fichas con
la información disponible. OpenLigaDB, OpenFootball y la muestra de TheSportsDB
funcionan sin claves propias; el resto requiere configurar acceso en el backend.
La demo usa datos inventados sin consultar servicios externos. Ver
[APIS_FUTBOL.md](../docs/APIS_FUTBOL.md) para cobertura, límites y BeSoccer.
