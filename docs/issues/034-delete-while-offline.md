# #34 · Borrado de una nota mientras otro cliente está sin red

## Objetivo

Definir y probar qué ocurre cuando una nota se borra en el servidor mientras un
cliente tiene cambios locales sin sincronizar: sin recrear la nota por error,
sin perder en silencio el trabajo del usuario y sin dejarlo en un bucle de
reconexión.

## Política

1. **El borrado es final.** `DELETE /notes/:id` elimina la fila y, por
   `ON DELETE CASCADE` (migración 007), todos sus `note_updates`. Ningún cliente
   puede recrear una nota con el mismo id: el servidor solo crea notas por
   `POST /workspaces/:id/notes`.
2. **Colaboradores conectados.** Tras borrar, el servidor retira la sala de
   memoria, envía `sync-error` con código `note-deleted` (`retryable: false`) y
   cierra cada socket con el código WebSocket `4404`.
3. **Cliente que vuelve de estar sin red.** Su reconexión recibe un `403` en el
   upgrade, deliberadamente indistinguible de una pérdida de acceso (no se
   filtra si el id existió). Si el socket se cierra antes de abrir y el
   navegador está online, el cliente hace una sonda HTTP
   (`GET /workspaces/:wid/notes`): nota ausente o `403/404` ⇒ borrada; error de
   red u otra respuesta ⇒ desconocido y se sigue reintentando con backoff.
4. **Copia local.** Al detectar el borrado, `createNoteSync` entra en estado
   terminal (`onGone`), deja de reintentar y no toca el documento. La interfaz
   muestra la nota en solo lectura con un aviso, indica si había cambios que
   nunca llegaron al servidor y ofrece **Descargar copia (.txt)** y
   **Descartar copia local**.
5. **Recuperable tras recargar.** Las notas visitadas que desaparecen de la
   lista del servidor pasan al almacén `orphans` de `syncpad.offline-metadata.v1`
   (versión 2 de la base) y aparecen en «Eliminadas en el servidor» hasta que se
   descartan. Cerrar sesión limpia también ese almacén.

## Verificación

- `backend/tests/ws-note-deletion.test.ts` (4): clientes vivos reciben
  `note-deleted` y cierre `4404`; el cliente offline recibe `403` y sus updates
  no reviven; un `DELETE` con CSRF inválido no toca la sala; doble borrado
  `204` → `404`. `backend/tests/migrations.test.ts` comprueba el `CASCADE`.
- `frontend/tests/note-sync.test.tsx` (+6): `note-deleted`, cierre `4404`, sonda
  `gone`, sonda `unknown`/fallida sigue reintentando, sin sonda tras abrir con
  éxito ni estando offline.
- `frontend/tests/offline-metadata.test.tsx` (+3) y `note-persistence.test.tsx`
  (+1): huérfanos, `discardOrphan`, `deleteLocalNote`.
- `e2e/tests/delete-while-offline.spec.ts` (2, Playwright): A sin red escribe, B
  borra, A vuelve online ⇒ aviso, texto intacto en solo lectura, descarga igual
  al texto local, recarga conserva la copia, descartar la elimina; y un cliente
  conectado ve el borrado en directo.

## Límites

- No hay papelera ni restauración en servidor: la copia local es la única
  recuperación y vive solo en ese dispositivo/navegador.
- Un `403` por pérdida de acceso a un workspace se trata igual que un borrado
  (sonda ⇒ «gone»); la copia local se conserva en ambos casos.
- Si el cliente nunca vuelve a conectarse, la nota sigue pareciendo editable
  hasta que haya red; los cambios offline se mantienen en IndexedDB.
