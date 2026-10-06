# #49 · Métricas de sincronización y logs estructurados

## Objetivo

Poder responder desde fuera del proceso a: ¿cuántos clientes hay?, ¿se
reconectan?, ¿qué errores damos?, ¿cuánto tarda en guardarse un cambio?, ¿qué
tamaño tienen las notas?, sin que ningún log o métrica contenga datos privados.

## Logs

`backend/src/logger.ts`: una línea JSON por evento en la salida estándar
(`{…campos, ts, level, msg}`; `ts`, `level` y `msg` van al final para que un
campo no pueda sobrescribirlos). Un fallo al escribir nunca rompe al llamador.

| `msg` | Nivel | Campos |
| --- | --- | --- |
| `SyncPad listening` | info | `port` |
| `ws connected` | info | `roomId`, `connectionId`, `userId`, `reconnect`, `clients` |
| `ws closed` | info | `roomId`, `connectionId`, `code`, `durationMs` |
| `sync error sent` | warn | `roomId`, `connectionId`, `code`, `retryable` |
| `sync limit hit` | warn | `limit` + los datos del límite (#48) |

`roomId` es el id de la nota y `connectionId` un UUID por conexión: permiten
seguir una sesión sin tocar su contenido. **No se registra** el texto de la
nota, el email, la cookie ni el token de métricas; el tipo `LogFields` solo
admite escalares y un test comprueba que ninguno de esos valores aparece en las
líneas emitidas.

## Métricas

`backend/src/metrics.ts` implementa contadores, gauges e histogramas en memoria y
los publica en formato de texto Prometheus. Las etiquetas son solo `code`,
`limit` y `outcome`: nunca ids de nota o usuario (cardinalidad acotada y sin
datos privados).

| Métrica | Tipo | Significado |
| --- | --- | --- |
| `syncpad_connections_total` | contador | conexiones aceptadas en una sala |
| `syncpad_connections_current` | gauge | sockets abiertos |
| `syncpad_rooms_current` | gauge | salas en memoria |
| `syncpad_reconnects_total` | contador | conexión de un usuario a una nota < 5 min después de perder otra |
| `syncpad_connection_closes_total{code}` | contador | cierres por código WebSocket |
| `syncpad_sync_errors_total{code}` | contador | `sync-error` enviados, por código |
| `syncpad_limit_hits_total{limit}` | contador | límites activados (#48) |
| `syncpad_updates_total{outcome}` | contador | `accepted`, `rejected`, `failed`, `invalid`, `incompatible` |
| `syncpad_update_persist_ms` | histograma | ms desde recibir un update hasta guardarlo (retraso de sincronización) |
| `syncpad_note_chars` | histograma | longitud de la nota tras cada update aceptado |

## Exposición

`GET /metrics` solo existe si se define `METRICS_TOKEN`, y exige
`Authorization: Bearer <token>` (comparación en tiempo constante). Sin token o
con un token incorrecto responde **404**, igual que una ruta inexistente, de
modo que un despliegue por defecto no expone nada. Alternativa para producción:
no publicar `/metrics` en el proxy inverso y raspar solo desde la red interna.

## Verificación

`backend/tests/observability.test.ts` (4): logs con sala/conexión y sin
contenido, email ni token; contadores de conexiones, reconexión, errores y
updates; histograma y gauges en el texto de `/metrics`; endpoint oculto sin
token o con token erróneo; formato y campos reservados del logger.

## Límites

- Las métricas viven en memoria de un proceso: se reinician con él y con varias
  instancias cada una expone las suyas (hoy hay una sola; ver #64).
- «Reconexión» es una heurística (mismo usuario y nota dentro de 5 minutos): una
  segunda pestaña abierta justo después de cerrar la primera también cuenta.
- El retraso mide el tiempo en el servidor (validación + guardado), no la
  latencia de red del cliente.
