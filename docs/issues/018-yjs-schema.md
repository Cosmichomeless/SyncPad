# Issue #18 — Esquema versionado de documentos Yjs

## Alcance

`shared/src/document.ts` define la versión `DOCUMENT_SCHEMA_VERSION = 1` y una
estructura determinista para notas: mapa `note` con `schemaVersion` y texto
compartido `content`. El título permanece en metadata relacional.

El helper valida la versión antes y después de aplicar actualizaciones, de modo
que futuras migraciones puedan rechazar documentos incompatibles explícitamente.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
```

La prueba crea dos documentos independientes, intercambia el estado Yjs y
comprueba convergencia de estructura, versión y contenido.