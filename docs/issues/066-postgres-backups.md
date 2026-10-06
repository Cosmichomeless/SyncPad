# #66 · PostgreSQL gestionado, migraciones y copias

## Objetivo

Que la base de datos del despliegue sea la de Neon (decisión de #64), que las migraciones se
apliquen solas al arrancar y que exista una copia que se haya restaurado de verdad.

## Qué se hace

- **Conexión estable con Neon**: `createDatabasePool` registra un manejador `error` en el
  pool. Neon corta las conexiones inactivas y, sin él, ese evento tumbaba el proceso
  (`backend/src/database.ts`, prueba `backend/tests/database.test.ts`).
- **Migraciones**: ya las aplica el entrypoint (`node dist/migrate.js`) antes de escuchar,
  con el libro `public.schema_migrations`; no hay cambios.
- **`scripts/backup.sh`**: volcado SQL del esquema `syncpad` y del libro de migraciones,
  con permisos 600, en `backups/` (ignorado por Git y Docker).
- **`scripts/restore.sh`**: reproduce el volcado en una base vacía y se niega si el esquema
  `syncpad` ya existe.
- **`scripts/pg.sh`**: ejecuta `pg_dump`/`psql` en un contenedor de la misma versión mayor
  que el servidor, porque `pg_dump` 17 genera SQL que PostgreSQL 16 no acepta.
- **Datos que sobreviven a un reinicio**: ya los cubrían las pruebas de reinicio de
  `ws-persistence`; la nueva prueba añade la restauración en otra base.

## Cómo se verifica

```sh
DATABASE_URL=postgres://syncpad:syncpad@127.0.0.1:55432/syncpad npm --prefix backend run test:integration
```

`backup-restore.int.test.ts` (2 pruebas): una nota con dos updates y un snapshot se vuelca,
se restaura en una base nueva y un servidor arrancado sobre ella entrega el mismo texto; un
fichero que no es un volcado no se confunde con uno bueno. Suite completa: 18 pruebas.

## Límites

- Los scripts necesitan Docker en la máquina que los ejecuta.
- La restauración contra Neon real no se ha ejecutado (no hay cuenta aún); se probó contra
  PostgreSQL 16 local, la misma versión mayor. Los pasos manuales están en
  [`deployment.md`](../deployment.md).
- No hay copias automáticas: el plan es manual (antes de migrar y una vez por semana).
