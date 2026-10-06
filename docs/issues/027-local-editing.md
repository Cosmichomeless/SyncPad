# #27 · Edición local desconectada

## Objetivo

Que escribir sea local-first: cada pulsación se aplica al documento Yjs y a
IndexedDB antes de depender del servidor, y la UI avisa de que hay cambios sin
confirmar sin perder texto.

## Diseño

- `applyLocalTextEdit(document, next)` (`frontend/src/lib/note-document.ts`)
  calcula el prefijo y sufijo comunes entre el texto actual y el nuevo y aplica
  **un único splice** (`delete` + `insert`) en una transacción con origen
  `LOCAL_EDIT_ORIGIN`. Antes se reemplazaba todo el `Y.Text` en cada tecla, lo que
  destruye la identidad CRDT de los caracteres y rompe la edición concurrente.
- Los índices de `Y.Text` son unidades UTF-16. El splice nunca parte un par
  sustituto (emoji): si prefijo o sufijo común cae dentro de uno, el tramo
  editado se extiende un carácter.
- El editor ya no exige un WebSocket abierto. Un observador de `doc.on('update')`
  reenvía por el socket **solo** los updates con origen local y solo si está
  `OPEN`; el cambio incremental es pequeño, no el estado completo del documento.
- El `textarea` queda deshabilitado hasta que IndexedDB hidrata el documento (o si
  falla el almacenamiento), para no perder ediciones previas a la hidratación.
- Tras la primera edición local se muestra un aviso accesible
  (`role="status"`): *Cambios locales guardados en este dispositivo; pendientes de
  confirmar con el servidor.* Se limpia al cambiar de nota. La confirmación real
  por el servidor la aporta #28 y los estados visuales finales #29.

## Verificación

- `frontend/tests/local-editing.test.tsx` (8 tests): sin cambio, inserción,
  borrado, reemplazo, origen de la transacción, identidades CRDT estables
  (posiciones relativas), tamaño del update (< 100 bytes al editar 1 carácter en
  5000), Unicode/emoji, convergencia de dos documentos y reapertura exacta con la
  persistencia de #25. RED 8/8 fallos antes de implementar; GREEN 8/8.
- Suite completa del frontend 65/65, lint y typecheck.
- Chromium (`e2e/acceptance/issue-027-local-editing.mjs`): una edición conectada
  llega a una segunda pestaña; sin red se puede escribir, aparece el aviso y,
  tras recargar sin red, el texto se restaura exactamente.

## Límites

- Los cambios hechos sin conexión **no se envían al reconectar todavía**: el
  handshake de estado y los acks son #28. Se conservan localmente.
- El `textarea` controlado no preserva la posición del cursor ante cambios remotos
  (se aborda con el editor enriquecido de #39 y los cursores de #40).
