# Issue #3 — PostgreSQL local

## Alcance

Se añade PostgreSQL 16 mediante Docker Compose con base de datos, usuario,
persistencia local y healthcheck. El backend acepta `DATABASE_URL` y valida que
use el protocolo `postgres:` o `postgresql:`. La conexión se crea explícitamente
con `createDatabasePool`; el servidor HTTP/WebSocket no depende de PostgreSQL para
arrancar mientras no haya una funcionalidad que la necesite.

## Verificación

```sh
docker compose config
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

El contenedor se puede iniciar con `docker compose up -d postgres` y comprobar con
`docker compose ps`. Los datos viven en el volumen `syncpad-postgres`.

## Límites

Las tablas de aplicación y la ejecución repetible de migraciones pertenecen a la
issue #4. Las credenciales del Compose son solo para desarrollo local y no deben
reutilizarse en producción.