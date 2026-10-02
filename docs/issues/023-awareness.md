# Issue #23 — Awareness efímera

## Alcance

Cada conexión autorizada recibe una identidad de conexión y la sala retransmite
la lista de participantes mediante mensajes `awareness`. Las entradas y salidas
se reflejan en clientes existentes; al cerrar una conexión se elimina su
presencia de memoria.

Awareness no se escribe en PostgreSQL ni en `note_updates`. Un reinicio limpia
toda presencia, mientras que el documento Yjs persistido se recupera por separado.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```