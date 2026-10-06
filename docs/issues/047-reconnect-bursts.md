# #47 · Ráfagas de reconexión y clientes obsoletos

## Objetivo

Que el servidor limite el trabajo que acepta por conexión, libere las conexiones
muertas y haga converger a un cliente con estado antiguo enviándole solo lo que
le falta.

## Qué hace el servidor

| Mecanismo | Comportamiento |
| --- | --- |
| Heartbeat | Cada `heartbeatMs` (30 s por defecto) se envía un `ping` a cada socket. Si no llegó un `pong` desde el ping anterior se hace `terminate()`: la sala se libera y se difunde la presencia actualizada. El intervalo es `unref` y se limpia en `close()`. |
| Límite de mensajes | Cubo de fichas por conexión (`messagesPerSecond` = 100, `messageBurst` = 200). Pasado el límite no se encola ningún trabajo: se envía `sync-error` `rate-limited` (`retryable: true`) y se cierra con `1008`. Las demás conexiones de la sala no se ven afectadas. |
| Carga de la sala | Una ráfaga de conexiones simultáneas a una nota comparte una única carga del historial (`store.load` se llama una vez). |
| Cliente obsoleto | El `sync` de respuesta es `encodeNoteStateSince(doc, vectorDelCliente)`: un cliente al día recibe un diff vacío y uno con una edición de retraso recibe solo esa edición. |

Los valores por defecto son holgados a propósito: las posiciones de cursor y la
presencia son frecuentes y un uso honesto queda muy por debajo. Se pueden
sobrescribir con `createSyncServer({ limits })`; #48 los hará configurables por
entorno junto con el resto de límites.

## Cliente

`rate-limited` es reintentable, así que `createNoteSync` lo trata como un fallo
de transporte (`failTransport`): cierra, espera con retroceso exponencial y
reconecta. Los cambios locales siguen pendientes hasta recibir el `ack`.

## Verificación

`backend/tests/ws-bursts.test.ts` (5):

1. Un cliente que no responde a los ping (`autoPong: false`) es terminado por el
   heartbeat (el test falla si se desactiva el heartbeat).
2. Un cliente sano sobrevive a muchas rondas de heartbeat.
3. Una ráfaga por encima del límite recibe `rate-limited` + cierre `1008` sin
   afectar a otro cliente de la sala.
4. 40 clientes conectando a la vez: `store.load` se llama una sola vez y todos
   convergen al mismo texto.
5. Un cliente al día recibe un diff vacío (< 50 bytes) y uno con una edición de
   retraso recibe < 200 bytes sobre una nota de 5 000 caracteres, y converge.

## Límites

- El límite es por conexión, no por usuario ni por IP: un atacante que abra
  muchas conexiones no queda limitado aquí (máximo de clientes por sala y de
  conexiones: #48).
- El heartbeat detecta conexiones muertas con una latencia de hasta dos
  intervalos.
