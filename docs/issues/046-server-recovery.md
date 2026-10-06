# #46 · Recuperación tras una interrupción del servidor

## Objetivo

Comprobar que un reinicio del servidor de sincronización durante la edición no
pierde cambios persistidos y que los clientes reconectan solos y convergen sin
duplicados.

## Qué se prueba

`frontend/tests/server-recovery.test.tsx` ejecuta clientes **reales**
(`createNoteSync`, con el reconector, el handshake de vectores de estado y los
`ack`) contra el servidor **real** (`createSyncServer`) por WebSocket (`ws`). El
servidor se detiene y se vuelve a arrancar en el mismo puerto con el mismo
almacén, igual que PostgreSQL sobrevive a un reinicio del proceso:

1. **Reinicio durante la edición**: A edita y el servidor cae antes de que esa
   edición esté necesariamente confirmada; B edita durante la caída (A añade al
   final, B al principio). Tras volver el servidor, ambos clientes convergen en
   `B-base-A`: cada edición aparece **exactamente una vez**, sin errores
   permanentes, y un cliente nuevo que llega después recibe la nota completa
   desde el almacén (los cambios persistidos reaparecen).
2. **Dos reinicios seguidos** (dos rondas de edición cada una): ambos clientes
   acaban en `uno dos tres`, es decir, la primera recuperación no deja estado
   obsoleto que rompa la segunda.

Se repitió 5 veces seguidas sin fallos.

## Cobertura relacionada

- Persistencia + reinicio con socket crudo: `backend/tests/restart-convergence.test.ts`.
- Reconexión y ráfagas con servidor simulado: `frontend/tests/note-sync.test.tsx`
  y `backend/tests/ws-reconnection.test.ts`.
- Snapshots y compactación (#44/#45): la carga tras un reinicio los usa
  de forma transparente (`load` devuelve snapshot + posteriores).

## Límites

- El almacén es en memoria (una copia fiel del contrato `SyncStore`); la
  integración con PostgreSQL real y WebSocket llegará con #57.
- El cierre del servidor es ordenado (`1001`); la caída abrupta de red se cubre
  en los tests de reconexión.
