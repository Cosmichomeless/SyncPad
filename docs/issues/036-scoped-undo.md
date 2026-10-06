# #36 · Deshacer y rehacer acotados a las ediciones propias

## Objetivo

Que Ctrl/Cmd+Z deshaga lo que escribió **este** cliente y nunca revierta lo que
han escrito otros participantes, ni el contenido recibido del servidor o
restaurado de IndexedDB.

## Diseño

- `createEditorDocument` crea un `Y.UndoManager` sobre el `Y.Text` con
  `trackedOrigins = { LOCAL_EDIT_ORIGIN }`. Solo las transacciones que produce
  `applyLocalTextEdit` (lo que escribe el usuario) entran en la pila.
  Las actualizaciones remotas (`REMOTE_ORIGIN`) y las restauradas de IndexedDB
  no se registran y, por tanto, no se pueden deshacer.
- Teclas consecutivas separadas por menos de **500 ms** forman un único paso
  (`captureTimeout`), como en un editor normal.
- Deshacer y rehacer son actualizaciones Yjs ordinarias: `isLocalChange(origin)`
  las trata como trabajo local nuevo, de modo que quedan **pendientes** hasta el
  `ack` del servidor y viajan como cualquier otra edición. Antes de este
  cambio `createNoteSync` solo contaba `LOCAL_EDIT_ORIGIN`; un undo no se habría
  subido.
- Una edición nueva tras un undo vacía la pila de rehacer (comportamiento
  estándar de `UndoManager`).
- Interfaz: el `textarea` está controlado, así que su historial nativo no sirve.
  `onKeyDown` intercepta Ctrl/Cmd+Z (deshacer), Ctrl/Cmd+Shift+Z y Ctrl+Y
  (rehacer), y un listener nativo de `beforeinput` atiende `historyUndo` /
  `historyRedo` (menú Edición y gestos móviles). Con la nota bloqueada
  (`readOnly` o `disabled`: borrada, esquema incompatible, sin cargar) no hacen
  nada.

## Verificación

- `frontend/tests/undo-redo.test.tsx` (8): deshacer/rehacer, deshacer un
  borrado, pila vacía, la edición remota sobrevive en cualquier posición, una
  edición remota posterior no entra en mi historial, contenido restaurado no es
  deshacible, undo/redo convergen en todas las réplicas, edición nueva vacía el
  rehacer.
- `frontend/tests/note-sync.test.tsx` (+1): un undo queda pendiente hasta el
  `ack` y llega al servidor.
- `e2e/tests/undo-redo.spec.ts` (Playwright, dos clientes): A y B escriben,
  Ctrl/Cmd+Z en A quita solo lo de A y B lo ve, Ctrl/Cmd+Shift+Z lo devuelve y
  agotar el historial de A deja exactamente el texto de B.

## Límites

- La pila vive en memoria: tras recargar la página no se puede deshacer lo
  escrito antes (el contenido recargado es «restaurado»).
- El historial es por pestaña; dos pestañas del mismo usuario son dos réplicas
  con pilas independientes.
- Deshacer tras un borrado ajeno de la misma zona puede no tener efecto visible:
  los elementos ya eliminados por otro no se resucitan.
