# Continuidad del proyecto

- Antes de cada bloque de trabajo, lee `CONTEXTO.md` para recuperar el estado.
- Actualiza `CONTEXTO.md` al terminar el bloque y antes de cerrar una respuesta:
  cambios realizados, validaciones, pendientes y siguiente paso concreto.
- Mantén la memoria en español. Distingue resultados comprobados de supuestos.
- No guardes credenciales, tokens ni secretos en la documentación.

## Laptop con poca RAM

- Prioriza terminar con poco consumo, aunque el trabajo tarde más.
- Ejecuta un solo proceso pesado a la vez: pruebas, análisis o compilación.
  Espera a que termine antes de iniciar el siguiente; no uses agentes paralelos.
- Backend: utiliza los scripts npm, que limitan el heap de Node a 512 MiB y
  ejecutan los archivos de prueba en serie (`--test-concurrency=1`). Si ejecutas
  Node directamente, conserva esas opciones.
- Flutter: ejecuta `flutter test --concurrency=1`. No mantengas análisis,
  compilación, servidor de desarrollo y pruebas simultáneos.
- Android: conserva el perfil de bajo consumo de `mobile/android/gradle.properties`:
  un trabajador, sin compilación paralela ni daemons persistentes, Kotlin dentro
  del proceso Gradle y heap Java de 1 GiB.
- Prefiere el teléfono físico o el navegador cuando se pueda; no inicies
  emuladores Android por defecto. Finaliza solo procesos iniciados para la tarea.
- Si falta memoria, reduce primero concurrencia y trabajo innecesario. No
  repitas automáticamente una compilación con límites mayores; revisa memoria
  disponible y el error concreto. Estos límites de heap no limitan toda la RAM
  nativa de un proceso.
