# Issue #4 — Migraciones de esquema

## Alcance

El backend incluye un runner SQL transaccional. Crea `public.schema_migrations` (siempre cualificada), ordena
los archivos de `backend/migrations/`, aplica los que faltan y registra la versión
solo después de ejecutarla correctamente. Un error revierte la transacción y una
segunda ejecución no repite cambios ya aplicados.

La migración inicial crea el esquema `syncpad`, que será utilizado por las
migraciones de usuarios, workspaces, notas y sincronización.

## Verificación

```sh
docker compose up -d postgres
npm --prefix backend run migrate
npm --prefix backend run migrate
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La primera ejecución aplica una migración y la segunda informa cero migraciones
nuevas. La migración no crea todavía tablas de dominio.

## Corrección posterior: tabla de registro cualificada

La versión inicial creaba `schema_migrations` sin esquema. Con el rol `syncpad`,
cuando la migración 001 ya había creado el esquema `syncpad`, `"$user"` del
`search_path` resolvía a él: la segunda ejecución creaba una segunda tabla vacía y
reaplicaba todas las migraciones (inocuo mientras fueran idempotentes). Ahora el
runner usa `public.schema_migrations` en las tres sentencias y la segunda ejecución
aplica 0. `backend/integration/migrations.int.test.ts` lo comprueba (una sola tabla
de registro y `Applied 0 migration(s)` en reejecuciones). Las bases creadas antes del
arreglo conservan una `syncpad.schema_migrations` sin uso que puede borrarse.
