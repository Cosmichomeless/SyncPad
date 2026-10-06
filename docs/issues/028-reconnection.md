# #28 · Reconciliación al reconectar

## Objetivo

Que los cambios hechos sin conexión y los cambios remotos que se perdieron se
fusionen al volver la red: ambos lados conservan sus cambios y repetir el
handshake no duplica contenido.

## Diseño

### Protocolo (aditivo, compatible con clientes antiguos)

| Mensaje | Dirección | Novedad |
| --- | --- | --- |
| `sync-request` | cliente → servidor | `requestId` y `stateVector` (base64) opcionales |
| `sync` | servidor → cliente | devuelve `requestId` y el `stateVector` del servidor; con `stateVector` en la petición solo envía lo que falta |
| `update` | cliente → servidor | `requestId` opcional; con él el servidor responde `ack` |
| `ack` | servidor → cliente | el update correlado ya es **durable** |
| `sync-error` | servidor → cliente | `code` (`persistence-unavailable`, `invalid-message`), `retryable` y `requestId` si aplica |

Sin `requestId` el comportamiento es el de siempre (updates sin ack).

### Servidor (`backend/src/server.ts`)

- Los listeners se registran **antes** de cargar la sala: un handshake enviado
  nada más abrir se encola en lugar de perderse.
- Cada sala tiene una cola serializada: un snapshot nunca adelanta a un
  `append` en curso.
- Un update correlado se valida contra un clon (`assertValidNoteUpdate`), se
  persiste con `append` y **solo entonces** se aplica a la sala, se reenvía a los
  demás clientes y se confirma con `ack`. Si `append` falla se responde
  `sync-error` reintentable y el update no contamina la sala. `append` devolviendo
  `false` (duplicado por hash) cuenta como éxito.
- Sin `syncStore` un update correlado nunca recibe `ack`: se responde
  `sync-error` no reintentable.
- Una carga de sala fallida no se cachea: la siguiente conexión reintenta.

### Cliente (`frontend/src/lib/note-sync.ts`)

`createNoteSync` conserva un único `Y.Doc` entre fallos de transporte:

1. Al abrir el socket envía `sync-request` con el vector de estado local.
2. Solo la respuesta con el mismo `requestId` completa el handshake; un
   `sync` inicial sin correlar se aplica pero no confirma nada.
3. Aplica lo remoto (origen `REMOTE_ORIGIN`) y sube **siempre** el diff respecto
   al vector del servidor. Tras recargar la página no hay forma de saber que el
   servidor ya tiene el estado persistido, así que hace falta un ack igualmente
   (también para cambios que son solo borrados).
4. Una revisión local (`LOCAL_EDIT_ORIGIN`) sube de contador por cada edición.
   Solo el `ack` del upload correspondiente avanza la revisión confirmada; lo
   editado durante el vuelo sigue pendiente y se sube a continuación.
5. Backoff exponencial 500 ms → 10 s, que se reinicia al sincronizar y no al
   abrir el socket; plazos de 10 s para handshake y ack; eventos
   `online`/`offline` cierran o reabren el transporte; `retry()` reconecta ya.
6. Los callbacks de sockets sustituidos se ignoran por identidad. `destroy()`
   cancela timers y listeners pero nunca destruye el documento ni la
   persistencia.
7. Un `sync-error` no reintentable detiene los reintentos automáticos y avisa;
   solo `retry()` lo reanuda.

Estados: `offline`, `reconnecting`, `syncing`, `up-to-date`. **`up-to-date`
exige** handshake correlado, upload confirmado y ninguna edición pendiente.
La UI los muestra como *sin conexión*, *reconectando*, *sincronizando* y *al
día*; la presentación final y la acción de reintento son #29.

## Verificación

- `backend/tests/ws-reconnection.test.ts` (9 tests, RED 8/9 antes de
  implementar): ramas divergentes con borrados convergen, repetir el handshake
  no duplica, un append lento retiene ack/broadcast/snapshots, un append fallido
  no contamina la sala y permite reintentar, un duplicado se confirma, handshake
  durante la carga de la sala, carga fallida que se reporta y se reintenta,
  update correlado sin store, y updates antiguos
  sin `requestId` siguen funcionando. Backend 64/64.
- `shared/src/document.test.ts` (5/5): vector de estado y diffs, incluida la
  conservación de borrados. `scripts/check.sh` ya ejecuta estos tests.
- `frontend/tests/note-sync.test.tsx` (16 tests, RED por módulo inexistente):
  Yjs real y un servidor en memoria; solo WebSocket y eventos de red son dobles.
  Frontend total 81/81, lint, typecheck y build.
- Chromium con dos contextos (`e2e/acceptance/issue-028-reconnection.mjs`): A
  pierde la red y reemplaza texto mientras B edita conectado; al volver, ambos
  muestran exactamente `B: base compartida + sin red` y una recarga completa de
  B conserva ese contenido. Los scripts de #27 y #30 siguen en verde con el nuevo
  texto de estado.

## Límites

- Una edición pendiente de una sesión anterior (antes de recargar) no se
  distingue como «pendiente» hasta el ack; mientras tanto el estado es
  `syncing`/`reconnecting`, nunca `up-to-date`.
- El `textarea` controlado no conserva el cursor ante cambios remotos (#39/#40).
- No hay límites de tamaño ni de ráfagas de reconexión todavía (#47, #48).
