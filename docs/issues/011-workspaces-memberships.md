# Issue #11 — Workspaces y memberships

## Alcance

La migración `003-workspaces.sql` crea `syncpad.workspaces` y
`syncpad.memberships`. Cada workspace tiene un creador y la creación inserta una
membership `OWNER` en la misma sentencia transaccional; la clave primaria de
membership impide duplicar la pareja workspace/usuario.

El servicio de dominio valida nombres y limita listado/detalle a usuarios que
sean miembros. Las rutas HTTP se incorporan en #12.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La migración se ejecuta mediante el runner existente después de iniciar
PostgreSQL.