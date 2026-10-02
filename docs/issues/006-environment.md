# Issue #6 — Entorno y scripts locales

## Alcance

`.env.example` documenta las variables del frontend, backend, CORS y PostgreSQL
sin incluir secretos reales. Los archivos `.env` quedan excluidos por Git.

`scripts/start-backend-local.sh` carga `.env`, inicia PostgreSQL con Compose,
aplica migraciones y arranca el backend. `scripts/check.sh` ejecuta la batería de
tests, lint, typecheck y build de backend y frontend.

## Verificación

```sh
git check-ignore .env
sh -n scripts/start-backend-local.sh scripts/check.sh
./scripts/check.sh
```

El arranque completo requiere Docker Desktop activo y un `.env` creado desde la
plantilla. Los valores incluidos son únicamente para desarrollo local.