# Issue #4 — Migraciones de esquema

## Alcance

El backend incluye un runner SQL transaccional. Crea `schema_migrations`, ordena
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