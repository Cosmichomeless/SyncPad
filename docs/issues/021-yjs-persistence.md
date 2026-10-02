# Issue #21 — Persistencia de actualizaciones Yjs

## Alcance

`syncpad.note_updates` guarda cada actualización Yjs como `bytea`, con hash único
por nota y orden estable. Al abrir una sala, el servidor carga y aplica todas las
actualizaciones antes de enviar el estado inicial. Las actualizaciones repetidas
usan `ON CONFLICT DO NOTHING` y no crean filas duplicadas.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La prueba del store verifica orden de carga, bytes persistidos y deduplicación.
La validación con PostgreSQL real requiere iniciar Docker Desktop.