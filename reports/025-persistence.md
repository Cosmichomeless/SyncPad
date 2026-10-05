---
feature: user-scoped-document-persistence
status: delivered-document-layer
specs: []
plans:
  - plans/issue-025-indexeddb.md
branch: issue/25-indexeddb
commits: 25250df..27d22ac
---

# Persistencia de documentos — Informe de entrega

## What Was Built

Los documentos Yjs visitados se guardan en IndexedDB por usuario y nota.
Al abrir una nota, el editor restaura sus actualizaciones antes de conectar
el WebSocket. Los fallos de apertura, lectura y escritura se notifican en
español y las cargas canceladas no publican contenido de otra selección.

Esta entrega cubre la capa de documento. #25 sigue abierta: la recarga
completa sin red requiere el shell (#26) y la navegación (#30).

## Architecture

`frontend/src/lib/note-persistence.ts` expone `persistNote` y `noteStorageKey`.
Conserva el esquema anterior de updates binarios Yjs, espera el cierre de
transacciones y drena las promesas pendientes antes de cerrar la base. Cada
transacción de escritura se crea sincrónicamente al recibir el update, para
que una lectura de reapertura no adelante escrituras aún no enviadas. La página conserva
su documento y socket por efecto y cancela callbacks tardíos.

### Design Decisions

Elegimos IndexedDB nativo para disponer de un canal real de errores y
confirmar transacciones, no solo el éxito de un request. Las claves son
tuplas JSON sin ambigüedad. Los datos locales se aíslan, no se cifran ni
se borran al logout; el log append-only no tiene compactación todavía.

## Usage

Entrar, crear o abrir una nota y editar conectado. Tras cargar la navegación
online, abrir esa nota con la red bloqueada restaura el contenido guardado.
La edición desconectada y reconexión corresponden a entregas posteriores.

## Verification

19/19 tests del frontend (0 fail, 0 cancelled), lint, typecheck, build de
producción y typecheck posterior al build correctos (código 0). La regresión
se ejecutó primero sin cambiar implementación: 17 pass, 2 fail, código 1,
con contenido vacío en reapertura inmediata/repetida. Ahora se comprueba el
contenido exacto tras 30 ediciones antes de esperar destroy(), cinco reaperturas
rápidas y rechazo de updates malformados; abortos y cancelación siguen cubiertos.
Revisión independiente de especificación anterior (25250df..27d22ac): PASS;
el cambio posterior fue aprobado por revisión independiente de calidad
(`27d22ac..5472766`), con 19/19 tests y sin bloqueos. En Chromium autenticado
se verificaron creación/edición, restauración con red bloqueada y el alert
de almacenamiento denegado. Evidencia detallada en la entrega enlazada.
No se repitió la prueba de navegador para el cambio de reapertura.

## Journey Log

> Notas que informaron el diseño final.

- [pivot] Se sustituyó y-indexeddb porque whenSynced no propagaba fallos de apertura/lectura.
- [lesson] El éxito de un request IndexedDB no garantiza persistencia: la transacción puede abortar después.
- [lesson] La serialización por instancia con pending.then no protege una reapertura: IndexedDB solo ordena las transacciones ya creadas.

## Source Materials

| File | Role | Notes |
| --- | --- | --- |
| [Plan](../plans/issue-025-indexeddb.md) | Implementación | Capa documental |
| [Entrega](../docs/issues/025-indexeddb.md) | Evidencias y límites | Incluye verificación en navegador |
