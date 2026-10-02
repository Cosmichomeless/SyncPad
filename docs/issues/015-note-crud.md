# Issue #15 — CRUD de notas

## Alcance

El backend expone `POST /workspaces/:id/notes` y `GET
/workspaces/:id/notes` para crear/listar notas, además de `PATCH /notes/:id` para
renombrar y `DELETE /notes/:id` para borrarlas. Las mutaciones requieren CSRF y
todas las operaciones requieren una sesión.

Cada query comprueba membership del usuario en el workspace de la nota. El
listado de un workspace ajeno responde 404 y no revela si contiene notas; borrar
el workspace elimina su metadata de notas mediante la FK en cascada.

## Verificación

```sh
./scripts/check.sh
```

La suite cubre el flujo HTTP completo de crear, listar, renombrar y borrar, además
de acceso no autenticado.