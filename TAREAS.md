# Tareas en curso

Objetivo: que los tickets (3 escalonados + La soñadora) se llenen a diario.
Estados: ⏳ pendiente · 🔧 en proceso · ✅ hecho · ⏸️ en espera.

| # | Tarea | Estado | Detalle |
|---|---|---|---|
| 1 | `discover` analiza solo partidos del día de la próxima tanda | ✅ hecho y subido | Antes repartía ~82 análisis/día entre varios días. Ahora: de 19:00 en adelante analiza solo los de mañana (hora de Mazatlán). Prueba nueva, 75/75. |
| 2 | Ligas validadas en over 1.5 como respaldo (solo over 1.5) | ✅ hecho y subido | 10 ligas solo de respaldo: Bélgica, Liga MX, Escocia (3), Finlandia, Polonia, Grecia, Irlanda y 3. Liga. Prueba: nunca entran como over 2.5. 76/76. Los CSV nuevos se descargan en el próximo job `csv` (martes o viernes). |
| 3 | Forma calculada por nosotros con resultados guardados de API-Football | ✅ hecho y subido · ⏳ juntando historial | `featuresFromHistory`: mismos datos que el backtest (temporada casa/fuera + últimos 5), sin consultas. generate la usa en partidos sin análisis; discover no gasta cuota en ellos. Hoy: 0 de 88 partidos (solo 63 resultados guardados). Empieza a rendir cuando cada equipo tenga 5 partidos guardados (~5-6 semanas). 79/79. |
| 5 | Re-validar las 9 ligas CSV sin usar con el criterio nuevo (0.62 / respaldo 0.79) | ✅ hecho y subido | 24 438 partidos descargados una vez. Over 2.5: ninguna pasa (todas <62%) → bloqueadas también por API-Football (antes entraban sin validar). Over 1.5: 2. Bundesliga pasa (80.3%) → respaldo por CSV, sin cuota; Austria (80.1%) → respaldo por API-Football. Las otras 7 ya no gastan consultas en discover. 80/80. |
| 6 | Football Charts como fuente (98 ligas, 200 consultas/día gratis, uso personal con atribución) | ✅ en producción · ⏳ primera carga hoy 20:08 | 22 ligas validadas (15 en over 2.5, 19 en over 1.5). Clave en Vercel, migraciones 013/014 aplicadas, código subido. El primer intento falló por partidos repetidos (29 de 9277) y gastó la cuota del día; corregido (sin repetidos, freno a 5 consultas, no sigue sin catálogo). La cuota vuelve a las 17:00 y el cron de las 20:08 hace la primera carga. 87/87. |
| 7 | Resultados internacionales (CC0) para validar partidos de selecciones | ⏳ pendiente | Para fechas FIFA como esta semana. |
| 8 | Tickets de hasta 7 días (umbral 0.67), aviso diario 23:45 y tickets nuevos al resolverse todos; arreglar aviso de ticket ganado | ✅ en producción · ⏳ instalar APK v6 | Causa del aviso: ningún teléfono registrado (`devices` vacía). La app ahora activa los avisos sola. 016, código y APK v6 publicados. Backend 95/95, app 19/19. |
| 9 | Medir el efecto de las bajas (bsd_absences) en los goles y, si sirve, meterlas al modelo | ⏳ juntando datos | Se guardan desde el 2026-11-22; revisar en febrero 2027. El ajuste por contexto de copa (ida/vuelta/final) se midió y no se usa (inestable). |
| 4 | Plan de pago de API-Football | ⏸️ en espera | Solo si 1-3 no alcanzan. Revisar precio antes. |

## Bitácora

- 2026-11-16: creada la lista. Empezando la tarea 1.
- 2026-11-16: tarea 1 terminada (código y prueba). Empezando la tarea 2.
- 2026-11-16: tarea 2 terminada. Tareas 1 y 2 subidas a GitHub (Vercel despliega solo). Empezando la tarea 3.
- 2026-11-16: tarea 3 terminada y subida. Revisar a partir del 2026-12-07 cuántos partidos ya tienen forma propia; con eso decidir la tarea 4.
- 2026-11-16: corrección: las ligas de API-Football ya se usan todas; lo que suma es pasar ligas a CSV (sin cuota). Empezando la tarea 5: descarga única del historial para backtest.
- 2026-11-16: tarea 5 terminada. Resultado: +1 liga de respaldo gratis (2. Bundesliga), menos partidos malos en over 2.5 y más cuota libre para otras ligas.
- 2026-11-16: tarea 6: clave de Football Charts recibida (200/día confirmada). Descargadas 2 temporadas de 58 ligas (116 consultas) y medidas: pasan 22. Conectándola a producción.
- 2026-11-16: tarea 6 programada y probada. El sistema pidió permiso para agregar la clave a Vercel; en espera de la confirmación del usuario.
- 2026-11-16: Football Charts en producción. Error inicial (HTTP 500 por ids repetidos) agotó la cuota del día; corregido. Revisar mañana que `fc_sync` tenga las 22 ligas.
- 2026-11-20: tarea 8 (tandas de varios días y avisos diarios), código y pruebas listos.
