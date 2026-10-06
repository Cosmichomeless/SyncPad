# #45 · Compactación de actualizaciones antiguas

## Objetivo

Limitar el crecimiento de `syncpad.note_updates` sin cambiar nunca el contenido
de la nota.

## Política

- **Qué se borra**: las filas de `note_updates` con `id <= covers_update_id` del
  snapshot de la nota **y** más antiguas que la ventana de retención. Nada
  posterior al snapshot se toca; sin snapshot, no se borra nada (la subconsulta
  es `NULL`).
- **Ventana de seguridad**: `SYNC_RETENTION_HOURS` (por defecto **168 h = 7
  días**; `0` compacta justo tras cada snapshot). Mientras una actualización está
  dentro de la ventana se conserva su hash, así que un cliente desconectado que
  reenvía un update antiguo sigue siendo un no-op idempotente en `append`
  (#28). Pasada la ventana el reenvío se vuelve a guardar: es inofensivo (Yjs
  aplica de forma idempotente) y el siguiente snapshot lo vuelve a absorber.
- **Cuándo**: justo después de que el servidor escriba un snapshot (#44), por la
  misma cola serializada de la sala y en modo *best effort*. Un fallo se ignora
  y nunca afecta a guardar ni a los `ack`.
- **Por qué no rompe a los clientes desconectados**: la reconciliación (#28) se
  hace contra el estado de la sala, reconstruido desde snapshot + posteriores, no
  contra filas concretas; el snapshot ya contiene lo borrado.

## Verificación

- `backend/tests/sync-store.test.ts` (+3): se borra solo lo cubierto y fuera de
  ventana, se conserva lo reciente y lo posterior al snapshot, el contenido
  reconstruido es idéntico antes y después, idempotente, y expira por tramos; sin
  snapshot no se borra nada; `SYNC_RETENTION_HOURS`.
- `backend/tests/ws-snapshots.test.ts` (+1): la compactación solo se pide tras un
  snapshot realmente escrito.
- Comprobado contra PostgreSQL real: sin snapshot 0 filas, dentro de ventana 0,
  ventana 0 borra las 10 cubiertas y quedan las 2 posteriores, estado idéntico, y
  el reenvío de un update compactado converge sin duplicar contenido.

## Límites

- Misma suposición de un único escritor por nota que #44.
- No hay VACUUM ni borrado de snapshots: el espacio se recupera por el
  autovacuum de PostgreSQL.
