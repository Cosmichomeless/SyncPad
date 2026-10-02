# Issue #20 — Sincronización Yjs por WebSocket

## Alcance

Las salas autorizadas mantienen un documento Yjs en memoria y usan un protocolo
JSON pequeño: `sync-request` puede incluir state vector, `sync` devuelve la
actualización faltante y `update` retransmite cambios incrementales a los demás
clientes de la sala.

Las actualizaciones se aplican al documento antes de retransmitirse, por lo que
dos clientes pueden converger sin sobrescribir el estado existente. La memoria
del proceso es temporal; la persistencia tras reinicio pertenece a #21.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```