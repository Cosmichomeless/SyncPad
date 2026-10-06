# #48 · Límites de tamaño y carga

## Objetivo

Que ningún cliente (ni una nota enorme) pueda agotar memoria o CPU del proceso
de sincronización, y que cuando un límite se activa quede una señal clara en los
logs y el cliente reciba un error que sabe tratar.

## Límites

Todos son opcionales y se configuran por entorno (`.env.example`); un valor
inválido impide arrancar y el error nombra la variable.

| Límite | Variable | Defecto | Al superarlo |
| --- | --- | --- | --- |
| Heartbeat | `SYNC_HEARTBEAT_MS` | 30 000 (0 = desactivado) | Se termina el socket que no responde (#47). |
| Mensajes por segundo y conexión | `SYNC_MESSAGES_PER_SECOND` | 100 | `sync-error` `rate-limited` (reintentable) y cierre `1008` (#47). |
| Ráfaga de mensajes | `SYNC_MESSAGE_BURST` | 200 | Ídem. |
| Presencia por segundo | `SYNC_AWARENESS_PER_SECOND` | 20 (ráfaga ×2) | Los mensajes de presencia sobrantes se descartan; el socket sigue abierto. |
| Tamaño de mensaje | `SYNC_MAX_MESSAGE_BYTES` | 1 048 576 | `ws` cierra la conexión con `1009` antes de reservar el mensaje. |
| Tamaño de nota | `SYNC_MAX_NOTE_CHARS` | 500 000 caracteres | `sync-error` `note-too-large` (no reintentable); no se guarda ni se difunde nada. |
| Clientes por sala | `SYNC_MAX_CLIENTS_PER_ROOM` | 50 | `sync-error` `room-full` (reintentable) y cierre `1013`. |

Decisiones:

- **La presencia se descarta, no se castiga.** Es efímera y frecuente; perder una
  posición de cursor no daña a nadie, y cortar el socket sí.
- **Solo se rechaza el crecimiento.** Un update que deja la nota por encima del
  límite pero no la agranda (p. ej. un borrado) se acepta, de modo que una nota
  que supera un límite bajado después siempre puede reducirse.
- **El tamaño de nota se mide sobre el resultado** (`assertValidNoteUpdate`
  devuelve la longitud del texto resultante), no sobre el tamaño del update, que
  no dice nada del documento final.

## Señal en logs

Cada límite que se activa genera una línea JSON `sync limit hit` (nivel `warn`)
y suma en `syncpad_limit_hits_total{limit}` (ver #49). `createSyncServer`
también acepta un hook `onLimit(event)` para tests o integraciones:

```json
{"limit":"note-size","noteId":"…","chars":500001,"max":500000,"ts":"…","level":"warn","msg":"sync limit hit"}
```

Los eventos son `rate`, `awareness-rate`, `note-size` y `room-full`.

## Cliente

`rate-limited` y `room-full` son reintentables: `createNoteSync` los trata como
fallo de transporte (cierra, espera con retroceso y reconecta). `note-too-large`
no es reintentable y, al venir con el `requestId` de la subida, se muestra como
rechazo del servidor; los cambios siguen guardados en el dispositivo.

## Verificación

- `backend/tests/limits.test.ts` (4): valores por defecto, sobrescritura por
  entorno, errores que nombran la variable y token bucket con reloj falso.
- `backend/tests/ws-limits.test.ts` (5): nota demasiado grande rechazada y no
  almacenada (con su evento), acortar nunca se rechaza, sala llena (`1013`) y
  recuperación al salir alguien, presencia descartada sin cerrar el socket,
  mensaje sobredimensionado (`1009`).
- `backend/tests/ws-bursts.test.ts` (5): límites de #47.

## Límites conocidos

- Los límites son por conexión y por sala, no por usuario ni por IP: quien abra
  muchas conexiones a notas distintas no queda limitado aquí (eso es trabajo de
  un proxy inverso; ver runbook de #64–#69).
- La comprobación de tamaño aplica el update a una copia del documento, O(tamaño
  de la nota) por update. Con el techo de 500 000 caracteres queda acotado;
  #50 medirá el coste real.
