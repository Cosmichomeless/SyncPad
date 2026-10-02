# Issue #14 — Metadata y ownership de notas

## Alcance

La migración `005-notes.sql` crea notas con workspace obligatorio, título,
creador y fechas de creación/modificación. Un índice compuesto permite listar por
workspace y modificación reciente; `ON DELETE CASCADE` evita metadata huérfana al
eliminar un workspace.

El servicio valida títulos y aplica membership en las consultas de creación,
listado, renombrado y borrado. El contenido colaborativo queda fuera de esta
issue y se implementará en la fase de sincronización.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```