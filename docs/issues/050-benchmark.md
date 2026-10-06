# #50 · Benchmark de editores concurrentes

## Objetivo

Saber cuántos editores simultáneos aguanta **un solo servidor** de SyncPad antes
de que la edición deje de sentirse inmediata, con un escenario que cualquiera
pueda repetir, y dejar el límite observado por escrito.

## Cómo reproducirlo

```bash
# Postgres de desarrollo (opcional; sin él se usa un almacén en memoria)
docker start syncpad-dev-pg

cd backend
npm run bench                                   # almacén en memoria
BENCH_DATABASE_URL=postgres://syncpad:syncpad@127.0.0.1:55432/syncpad npm run bench
```

`backend/bench/run.mts` lanza el servidor real (`createSyncServer`) en un
**proceso hijo** (`bench/server.mts`) para leer su memoria y CPU sin mezclarlas
con las del generador de carga, abre clientes WebSocket reales con un documento
Yjs cada uno y los hace escribir. Con `BENCH_DATABASE_URL` crea usuario,
espacio y notas reales (el esquema exige las FK) y los borra al terminar.

| Variable | Defecto | Significado |
| --- | --- | --- |
| `BENCH_SWEEP` | `1x5,1x20,1x50,5x20,5x50,10x20,10x50` | escenarios `salas×editores` |
| `BENCH_EDITS` | `100` | ediciones por editor |
| `BENCH_INTERVAL_MS` | `100` | pausa entre ediciones de un editor (10/s, un tecleo rápido) |
| `BENCH_P95_BUDGET_MS` | `250` | presupuesto de latencia para dar un escenario por bueno |

Cada edición inserta un carácter en una posición aleatoria del texto compartido,
de modo que hay conflictos reales entre editores, no solo anexados.

## Qué se mide

- **ack p50/p95/p99**: tiempo desde que el cliente envía el `update` hasta que
  recibe el `ack` (lo que el indicador «Al día» tarda en volver).
- **propagación p95**: del envío al instante en que otro cliente recibe ese mismo
  update.
- **upd/s**: actualizaciones procesadas por segundo.
- **RSS, heap Δ y CPU del servidor** (proceso hijo) y **CPU del generador**.
- **Convergencia**: al terminar, todos los clientes de una sala deben tener
  exactamente el mismo texto; si no, el escenario falla.

Un escenario **pasa** si el p95 de ack ≤ 250 ms, no hay `sync-error`, ni
sockets cortados, ni acks perdidos, y todas las salas convergen.

## Resultados

Máquina: Apple M4 Pro (12 núcleos), 24 GB, macOS, Node v22.16.0, Postgres 16 en
Docker local. Servidor y generador comparten máquina. Los límites de ritmo del
#48 se elevan en el servidor del benchmark (se mide el servidor, no sus
protecciones). Ejecución del 2026-10-06.

### Almacén en memoria (aísla el coste de CRDT + red)

| rooms × editors | updates | upd/s | ack p50 | p95 | p99 | propagation p95 | server RSS | heap Δ | CPU | load gen CPU | pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| 1 × 5 (5) | 500 | 47 | 1 ms | 1 ms | 2 ms | 1 ms | 107 MB | 2 MB | 4% | 3% | ✅ |
| 1 × 20 (20) | 2000 | 187 | 2 ms | 5 ms | 7 ms | 5 ms | 128 MB | 12 MB | 19% | 12% | ✅ |
| 1 × 50 (50) | 5000 | 457 | 10 ms | 240 ms | 459 ms | 239 ms | 138 MB | 6 MB | 70% | 54% | ✅ |
| 5 × 20 (100) | 10000 | 937 | 8 ms | 45 ms | 98 ms | 45 ms | 159 MB | 23 MB | 64% | 38% | ✅ |
| 5 × 50 (250) | 25000 | 956 | 4200 ms | 23851 ms | 25603 ms | 23851 ms | 164 MB | 25 MB | 141% | 103% | ❌ |
| 10 × 20 (200) | 20000 | 1506 | 107 ms | 2762 ms | 3322 ms | 2762 ms | 158 MB | 17 MB | 90% | 53% | ❌ |
| 10 × 50 (500) | 39200 | 1461 | 12381 ms | 38552 ms | 41250 ms | 38804 ms | 179 MB | 30 MB | 201% | 136% | ❌ |

### PostgreSQL (coste real de persistir cada update)

| rooms × editors | updates | upd/s | ack p50 | p95 | p99 | propagation p95 | server RSS | heap Δ | CPU | load gen CPU | pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| 1 × 5 (5) | 500 | 47 | 3 ms | 5 ms | 7 ms | 5 ms | 108 MB | 5 MB | 6% | 4% | ✅ |
| 1 × 20 (20) | 2000 | 187 | 5 ms | 20 ms | 30 ms | 20 ms | 115 MB | 6 MB | 26% | 14% | ✅ |
| 1 × 50 (50) | 5000 | 378 | 120 ms | 2165 ms | 2598 ms | 2165 ms | 143 MB | 22 MB | 70% | 52% | ❌ |
| 5 × 20 (100) | 10000 | 926 | 11 ms | 122 ms | 320 ms | 122 ms | 153 MB | 26 MB | 71% | 37% | ✅ |
| 5 × 50 (250) | 25000 | 950 | 3109 ms | 16435 ms | 18534 ms | 16436 ms | 160 MB | 25 MB | 102% | 88% | ❌ |
| 10 × 20 (200) | 20000 | 1168 | 891 ms | 5891 ms | 7078 ms | 5891 ms | 178 MB | 17 MB | 95% | 50% | ❌ |
| 10 × 50 (500) | 48000 | 1630 | 5190 ms | 19484 ms | 21522 ms | 19577 ms | 188 MB | 36 MB | 107% | 99% | ❌ |

## Lectura

- **Hasta ~20 editores en una nota y ~100 repartidos en 5 notas** la edición es
  inmediata: p95 de unos pocos ms a unas decenas en memoria y de ~120 a ~320 ms con
  Postgres en 5×20 (varía entre ejecuciones), con 20–70 % de un núcleo.
- **El primer escalón dudoso son 50 editores en una misma nota**: pasa o no según
  la ejecución (p95 entre ~220 y ~480 ms en memoria; 2–3 s con Postgres). Cada
  update se reenvía a los otros 49 y se valida contra el documento, así que el
  coste crece con el cuadrado de los editores de la sala.
- **Límite observado de un solo servidor: unas 900–1000 actualizaciones/s
  sostenidas** (≈ 100 editores tecleando a 10 pulsaciones/s). Por encima la cola
  del bucle de eventos crece sin parar: las latencias pasan de milisegundos a
  segundos y siguen subiendo mientras dura la carga. Las actualizaciones **no se
  pierden ni divergen** (todos los escenarios convergen y no hay `sync-error`):
  se degrada la latencia, no la corrección.
- La memoria no es el límite: el RSS sube de ~108 MB a ~190 MB con 500 editores.
  El factor limitante es **una sola hebra de CPU** (Node ejecuta las salas en un
  único bucle de eventos).
- **Postgres añade latencia, no capacidad perdida**: el reparto en 5 salas rinde
  igual (~930 upd/s) pero con p95 más alto; cada update es un `INSERT`.

## Salvedades honestas

- **Hay ruido entre ejecuciones.** Repetí 1×50 en memoria cinco veces con la
  configuración por defecto y el p95 salió 219, 240, 279, 361 y 481 ms. Los escenarios
  cercanos al límite deben leerse como un rango, no como un número.
- **En 5×50 y 10×50 el generador de carga también se satura** (≥ 100 % de CPU de
  un núcleo, es un solo proceso de Node). Esas filas son una **cota** de lo que
  el servidor aguanta, no una medida exacta de su techo; las cifras de latencia
  de esas dos filas mezclan ambos cuellos. Las conclusiones de arriba sobre el límite se
  apoyan en 1×50, 5×20 y 10×20, donde el generador consume menos CPU que el servidor.
- Una sola máquina, sin red real entre cliente y servidor: la latencia de un
  usuario real será mayor en esa cuantía, pero la capacidad de proceso no cambia.
- El perfil «10 pulsaciones/s por editor, todos a la vez» es pesimista: una sala
  real tiene mucho menos tecleo simultáneo.

## Qué hacer si se supera el límite

1. **Escalar en vertical** da poco: el servidor usa un núcleo.
2. **Escalar en horizontal exige fijar cada nota a una instancia** (sticky por
   `noteId`), porque la sala vive en memoria; repartir clientes de una misma nota
   entre instancias no converge sin un bus entre ellas. Es trabajo de
   arquitectura, fuera de este alcance (ver #64–#69 para el despliegue).
3. Palancas baratas si hiciera falta: validar el update sin reconstruir el
   documento de prueba completo (coste citado en #35) y agrupar difusiones.
4. Vigilar en producción con las métricas del #49 (`/metrics`) antes de llegar
   aquí: latencia de ack y clientes por sala.

## Verificación

- `npm run bench` y `BENCH_DATABASE_URL=… npm run bench` terminan con código 0 y
  reproducen las tablas de arriba (con la variación indicada).
- `backend/bench/` entra en `tsc` (`"bench/**/*.mts"`) y en `eslint`.
