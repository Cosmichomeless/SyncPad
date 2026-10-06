# #44 · Snapshots periódicos de Yjs

## Objetivo

Poder reconstruir una nota sin reproducir todo su historial de actualizaciones,
sin cambiar nunca el estado que se reconstruye.

## Diseño

- **Tabla** `syncpad.note_snapshots` (migración `008`): una fila por nota
  (`note_id` PK, `covers_update_id`, `state`, `update_count`, `created_at`),
  con `ON DELETE CASCADE` como `note_updates`.
- **`note_updates` sigue siendo la fuente de verdad.** El snapshot es un dato
  derivado: se puede borrar y la nota se reconstruye igual (la compactación que
  elimina actualizaciones antiguas es #45).
- **`SyncStore.load`** devuelve `[snapshot, ...actualizaciones con id > covers_update_id]`.
  Un snapshot es en sí un update de Yjs, así que el servidor lo aplica igual
  que cualquier otro: no cambia ni el protocolo ni el cliente.
- **`SyncStore.snapshot(noteId, minUpdates)`** (opcional en la interfaz) parte del
  snapshot anterior más las actualizaciones posteriores **guardadas en base de
  datos** (nunca de la sala en memoria), las aplica sobre un documento de nota
  válido, codifica su estado completo y lo guarda con un `UPSERT` que solo avanza
  (`covers_update_id` creciente). Si el historial no es legible (esquema
  distinto, #35) lanza y no escribe nada.
- **Cuándo**: el servidor (`snapshotEvery`, 100 por defecto) lo pide al cargar la
  sala (historiales largos de un proceso anterior) y cada `snapshotEvery`
  actualizaciones persistidas. Va por la cola serializada de la sala y es *best
  effort*: un fallo se ignora y nunca afecta a guardar ni a los `ack`.

## Verificación

- `backend/tests/sync-store.test.ts` (6): snapshot + actualizaciones posteriores
  da **exactamente** el mismo estado (contenido, vector de estado y bytes del
  estado codificado) que el replay completo; el snapshot conserva el estado en
  que se tomó; los snapshots se encadenan; no se escribe por debajo del umbral ni
  si no hay cambios; un historial ilegible no se snapshotea.
- `backend/tests/ws-snapshots.test.ts` (2): el servidor pide el snapshot al cargar
  y cada N actualizaciones; un snapshot que falla no rompe el guardado.
- `backend/tests/migrations.test.ts` (+1).
- Comprobado además contra PostgreSQL real: migración aplicada, snapshot,
  reconstrucción idéntica y cascada al borrar la nota.

## Límites

- Se asume **un único escritor por nota** (una sala en memoria con cola
  serializada). Con varias instancias del servidor, un `id` menor confirmado
  después de uno mayor ya leído quedaría fuera del corte; habría que serializar
  con un bloqueo asesor de PostgreSQL antes de escalar horizontalmente.
- Los `bigserial` se leen como `number`: exacto hasta 2^53.
- El snapshot lee las actualizaciones posteriores al anterior; su coste es
  proporcional a ese tramo, no al historial entero.
