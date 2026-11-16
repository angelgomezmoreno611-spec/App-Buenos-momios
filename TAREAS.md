# Tareas en curso

Objetivo: que los tickets (3 escalonados + La soñadora) se llenen a diario.
Estados: ⏳ pendiente · 🔧 en proceso · ✅ hecho · ⏸️ en espera.

| # | Tarea | Estado | Detalle |
|---|---|---|---|
| 1 | `discover` analiza solo partidos del día de la próxima tanda | ✅ hecho y subido | Antes repartía ~82 análisis/día entre varios días. Ahora: de 19:00 en adelante analiza solo los de mañana (hora de Mazatlán). Prueba nueva, 75/75. |
| 2 | Ligas validadas en over 1.5 como respaldo (solo over 1.5) | ✅ hecho y subido | 10 ligas solo de respaldo: Bélgica, Liga MX, Escocia (3), Finlandia, Polonia, Grecia, Irlanda y 3. Liga. Prueba: nunca entran como over 2.5. 76/76. Los CSV nuevos se descargan en el próximo job `csv` (martes o viernes). |
| 3 | Forma calculada por nosotros con resultados guardados de API-Football | ✅ hecho y subido · ⏳ juntando historial | `featuresFromHistory`: mismos datos que el backtest (temporada casa/fuera + últimos 5), sin consultas. generate la usa en partidos sin análisis; discover no gasta cuota en ellos. Hoy: 0 de 88 partidos (solo 63 resultados guardados). Empieza a rendir cuando cada equipo tenga 5 partidos guardados (~5-6 semanas). 79/79. |
| 4 | Plan de pago de API-Football | ⏸️ en espera | Solo si 1-3 no alcanzan. Revisar precio antes. |

## Bitácora

- 2026-11-16: creada la lista. Empezando la tarea 1.
- 2026-11-16: tarea 1 terminada (código y prueba). Empezando la tarea 2.
- 2026-11-16: tarea 2 terminada. Tareas 1 y 2 subidas a GitHub (Vercel despliega solo). Empezando la tarea 3.
- 2026-11-16: tarea 3 terminada y subida. Revisar a partir del 2026-12-07 cuántos partidos ya tienen forma propia; con eso decidir la tarea 4.
