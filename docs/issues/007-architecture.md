# Issue #7 — Arquitectura y puesta en marcha

## Alcance

`docs/architecture.md` documenta la separación entre frontend, backend, contratos
compartidos, PostgreSQL, IndexedDB, Yjs y presencia WebSocket. Incluye un diagrama
Mermaid, una tabla de persistencia y el flujo para iniciar el proyecto desde cero.

También deja explícitos los límites de la base actual: no hay autenticación,
autorización, sincronización de documentos ni presencia implementadas todavía.

## Verificación

```sh
test -f docs/architecture.md
test -f docs/issues/001-frontend.md
test -f docs/issues/002-backend.md
test -f docs/issues/003-postgresql.md
test -f docs/issues/004-migrations.md
test -f docs/issues/005-contracts.md
test -f docs/issues/006-environment.md
./scripts/check.sh
```

La documentación se mantiene alineada con el alcance cerrado de #1–#6 y enlaza
el trabajo futuro por milestone.